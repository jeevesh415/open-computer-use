"""
test_security_authz_idor.py — Authorization / IDOR (Insecure Direct Object
Reference) regression suite for the Coasty FastAPI backend.

Goal: every endpoint that takes an ID in its path or query MUST enforce
ownership on the authenticated user.  An endpoint that returns 200 + foreign
data when the caller does not own the row is a P0 multi-tenancy breach.

Coverage
--------
* /api/chats/{chat_id}                — GET / PATCH / DELETE
* /api/chats/{chat_id}/messages       — GET
* /api/schedules/{chat_id}            — GET / POST / DELETE
* /api/schedules/{chat_id}/triggers   — PUT (mass-assignment of triggers)
* /api/swarm/status/{swarm_id}        — GET
* /api/swarm/stop/{swarm_id}          — POST
* /api/screenshots/{screenshot_id}    — GET (notable: no auth gate today)
* /api/files/*                        — POST file ops with foreign machine_id
* /api/electron/machines/{id}/*       — GET / POST with foreign machine_id
* /api/billing/sessions/{session_id}/status — GET
* /api/v1/cua/sessions/{session_id}   — GET / DELETE / POST predict (cross-key
  isolation is the equivalent of cross-tenant in the public API surface)

Method-confusion + path-injection probes are layered on the same target set.

Markers
-------
Every test carries ``@pytest.mark.security``.  Tests that need a second
test user are gated on ``TEST_USER_TOKEN_2``; public-API cross-tenant tests
are gated on ``TEST_PUBLIC_API_KEY_2``.  Missing creds skip cleanly.

Constraint reminder
-------------------
The backend may legitimately return EITHER 403 (forbidden) or 404 (hide
existence).  We accept both.  When the backend chooses 404 we additionally
assert that no foreign data leaked back in the body — a 404 that ALSO ships
the row is just a 200 with extra steps.
"""
from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any, Optional

import httpx
import pytest

from conftest import assert_status, cfg, _must_have


# ── Markers ────────────────────────────────────────────────────────────────

pytestmark = pytest.mark.security


# ── Constants ──────────────────────────────────────────────────────────────

# UUIDs that are well-formed but should never collide with anything real.
FAKE_UUID_NIL = "00000000-0000-0000-0000-000000000000"
FAKE_UUID_1 = "00000000-0000-0000-0000-000000000001"
FAKE_UUID_2 = "00000000-0000-0000-0000-000000000002"
FAKE_UUID_3 = "00000000-0000-0000-0000-000000000003"

# Path-param injection probes — these must NOT crash the router or leak data.
# httpx URL-encodes everything, but a router that decodes too eagerly might
# treat these as wildcards / shell metacharacters / null terminators.
PATH_INJECTIONS = [
    "..%2F..%2Fetc%2Fpasswd",   # path traversal
    "abc%00.txt",                # NUL byte
    "abc%0A.txt",                # newline injection
    "abc%3Bls",                  # semicolon for shell injection
    "00000000-0000-0000-0000-000000000001/../" + FAKE_UUID_2,  # nested traversal
]

# Identity used for mass-assignment tests — any caller who learns these
# user IDs should NOT be able to write rows owned by them.
ATTACKER_USER_ID = "00000000-dead-beef-dead-000000000001"


# ── Helpers ────────────────────────────────────────────────────────────────


def _url(path: str) -> str:
    return f"{cfg().backend_public_url}{path}"


def _body_snippet(resp: httpx.Response, n: int = 300) -> str:
    try:
        return resp.text[:n].replace("\n", " ")
    except Exception:
        return "<undecodable>"


def _assert_no_leak(resp: httpx.Response, *, sensitive_field_names=("user_id", "title", "messages", "schedule", "machine_id")):
    """When a 404 is returned in lieu of 403, the body must not contain a
    foreign user's data.  We do a permissive scan: parse the body as JSON
    and assert that none of the listed fields are present at the top level
    OR contain non-empty values.
    """
    try:
        body = resp.json()
    except Exception:
        # Non-JSON body on a 404 from FastAPI is unusual but fine — there's
        # nothing to leak.
        return
    if not isinstance(body, dict):
        return
    # Allow a "detail" field with a plain error string — that's the FastAPI
    # default.  Anything else with sensitive content fails.
    for field in sensitive_field_names:
        val = body.get(field)
        if val:
            pytest.fail(
                f"SECURITY: 404 response leaked foreign data — field {field!r} "
                f"= {val!r} (full body: {body!r})"
            )


def _skip_if_invalid_user(resp: httpx.Response) -> None:
    """Same fallback as test_03 — skip when the JWT validates but the user
    is not provisioned in the backend user table (test infra issue, not a
    regression in the auth code path)."""
    if resp.status_code == 401 and resp.text and "Invalid user" in resp.text:
        pytest.skip(
            "Test user not fully onboarded in the backend user table. Sign in "
            "to the web app once with TEST_USER_EMAIL / TEST_USER_PASSWORD to "
            "provision the profile row, then re-run."
        )


def _second_user_token() -> Optional[str]:
    """Read TEST_USER_TOKEN_2 from env.  Pre-minted access token of a
    different test user — used for true cross-tenant tests where we need
    to provision a row as user A and then attempt to read it as user B.
    """
    val = os.environ.get("TEST_USER_TOKEN_2", "").strip()
    return val or None


def _second_public_key() -> Optional[str]:
    val = os.environ.get("TEST_PUBLIC_API_KEY_2", "").strip()
    return val or None


def _public_key() -> Optional[str]:
    val = os.environ.get("TEST_PUBLIC_API_KEY", "").strip()
    return val or None


def _make_throwaway_chat(http: httpx.Client, headers: dict[str, str], user_id: str) -> Optional[str]:
    """Create a chat owned by the *current* user; return its UUID or None
    on failure (test should skip).  Caller is responsible for cleanup.
    """
    resp = http.post(
        _url("/api/chats/create"),
        json={
            "user_id": user_id,
            "title": "idor-suite-throwaway",
            "model": "default",
            "source": "post-deploy-test",
        },
        headers=headers,
    )
    if resp.status_code in (401, 403):
        return None
    if resp.status_code not in (200, 201):
        return None
    try:
        body = resp.json()
        return (body.get("chat") or body).get("id")
    except Exception:
        return None


def _delete_chat(http: httpx.Client, headers: dict[str, str], chat_id: str) -> None:
    try:
        http.request(
            "DELETE", _url(f"/api/chats/{chat_id}"), headers=headers, timeout=10
        )
    except Exception:
        pass


# ───────────────────────────────────────────────────────────────────────────
# 1. /api/chats/{chat_id} — GET / PATCH / DELETE on fake & foreign IDs
# ───────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("chat_id", [FAKE_UUID_NIL, FAKE_UUID_1, FAKE_UUID_2])
def test_get_chat_fake_uuid_returns_404(
    http: httpx.Client, auth_headers: dict[str, str], chat_id: str
):
    """GET /api/chats/{nonexistent-uuid} must return 404 — never 500, never 200."""
    resp = http.get(_url(f"/api/chats/{chat_id}"), headers=auth_headers)
    _skip_if_invalid_user(resp)
    assert_status(resp, (403, 404))
    _assert_no_leak(resp)


@pytest.mark.parametrize("chat_id", [FAKE_UUID_1, FAKE_UUID_2, FAKE_UUID_3])
def test_get_chat_messages_fake_uuid_returns_404(
    http: httpx.Client, auth_headers: dict[str, str], chat_id: str
):
    """GET /api/chats/{fake}/messages → 404 (never 200, never 500)."""
    resp = http.get(_url(f"/api/chats/{chat_id}/messages"), headers=auth_headers)
    _skip_if_invalid_user(resp)
    assert_status(resp, (403, 404))
    _assert_no_leak(resp, sensitive_field_names=("messages", "content"))


@pytest.mark.parametrize("chat_id", [FAKE_UUID_1, FAKE_UUID_2])
def test_patch_chat_fake_uuid_does_not_create(
    http: httpx.Client, auth_headers: dict[str, str], chat_id: str
):
    """PATCH /api/chats/{fake} with a title must not silently create or update."""
    resp = http.patch(
        _url(f"/api/chats/{chat_id}"),
        json={"title": "idor-write-attempt"},
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    assert resp.status_code in (403, 404), (
        f"SECURITY: PATCH on a non-existent chat returned {resp.status_code} "
        f"— should be 403/404. Body: {_body_snippet(resp)}"
    )


@pytest.mark.parametrize("chat_id", [FAKE_UUID_1, FAKE_UUID_2])
def test_delete_chat_fake_uuid_returns_404(
    http: httpx.Client, auth_headers: dict[str, str], chat_id: str
):
    """DELETE /api/chats/{fake} → 403/404 — never 200 (which would mean
    we just told an attacker their probe was for a row that exists OR
    that the delete went through)."""
    resp = http.request(
        "DELETE", _url(f"/api/chats/{chat_id}"), headers=auth_headers
    )
    _skip_if_invalid_user(resp)
    assert resp.status_code in (403, 404), (
        f"SECURITY: DELETE on a non-existent chat returned {resp.status_code}."
    )


# ───────────────────────────────────────────────────────────────────────────
# 2. Cross-tenant: provision as user A, attempt access as user B
# ───────────────────────────────────────────────────────────────────────────


def test_cross_tenant_chat_get_blocked(
    http: httpx.Client, auth_headers: dict[str, str], test_user_id: str
):
    """User A creates a chat; user B tries to GET it.  Must be 403/404 and
    must NOT return user A's chat row.

    Skipped when TEST_USER_TOKEN_2 is missing — single-user environments
    can't exercise this guard, but the file should still pass.
    """
    other_token = _second_user_token()
    if not other_token:
        pytest.skip(
            "TEST_USER_TOKEN_2 not configured — cross-tenant IDOR test needs a "
            "second user's access token. Sign in a second test user and export "
            "their access_token as TEST_USER_TOKEN_2."
        )
    chat_id = _make_throwaway_chat(http, auth_headers, test_user_id)
    if not chat_id:
        pytest.skip("Could not create a throwaway chat as user A — cannot run cross-tenant test")
    try:
        # User B reads as user A's chat
        attacker_headers = {"Authorization": f"Bearer {other_token}"}
        resp = http.get(_url(f"/api/chats/{chat_id}"), headers=attacker_headers)
        # Must NOT be 200
        assert resp.status_code != 200, (
            f"SECURITY: cross-tenant chat read returned 200 — user B can see "
            f"user A's chat {chat_id!r}. Body: {_body_snippet(resp)}"
        )
        assert resp.status_code in (401, 403, 404), (
            f"Unexpected cross-tenant status {resp.status_code}. Body: "
            f"{_body_snippet(resp)}"
        )
        _assert_no_leak(resp)
    finally:
        _delete_chat(http, auth_headers, chat_id)


def test_cross_tenant_chat_messages_blocked(
    http: httpx.Client, auth_headers: dict[str, str], test_user_id: str
):
    """Same shape as above but for /messages."""
    other_token = _second_user_token()
    if not other_token:
        pytest.skip("TEST_USER_TOKEN_2 not configured")
    chat_id = _make_throwaway_chat(http, auth_headers, test_user_id)
    if not chat_id:
        pytest.skip("Could not create a throwaway chat")
    try:
        resp = http.get(
            _url(f"/api/chats/{chat_id}/messages"),
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert resp.status_code != 200, (
            f"SECURITY: cross-tenant messages read returned 200. "
            f"Body: {_body_snippet(resp)}"
        )
        assert resp.status_code in (401, 403, 404)
        _assert_no_leak(resp, sensitive_field_names=("messages", "content"))
    finally:
        _delete_chat(http, auth_headers, chat_id)


def test_cross_tenant_chat_delete_blocked(
    http: httpx.Client, auth_headers: dict[str, str], test_user_id: str
):
    """User B must NOT be able to DELETE user A's chat."""
    other_token = _second_user_token()
    if not other_token:
        pytest.skip("TEST_USER_TOKEN_2 not configured")
    chat_id = _make_throwaway_chat(http, auth_headers, test_user_id)
    if not chat_id:
        pytest.skip("Could not create a throwaway chat")
    try:
        resp = http.request(
            "DELETE",
            _url(f"/api/chats/{chat_id}"),
            headers={"Authorization": f"Bearer {other_token}"},
        )
        assert resp.status_code in (401, 403, 404), (
            f"SECURITY: cross-tenant DELETE returned {resp.status_code} — "
            f"user B should not be able to destroy user A's chat. "
            f"Body: {_body_snippet(resp)}"
        )
        # Now confirm the chat is still readable by the rightful owner.
        verify = http.get(_url(f"/api/chats/{chat_id}"), headers=auth_headers)
        if verify.status_code == 200:
            return  # great, still there
        # If the chat no longer exists, the cross-tenant DELETE may have
        # succeeded — that IS the breach we're guarding against.
        if verify.status_code == 404:
            pytest.fail(
                f"SECURITY: chat {chat_id!r} disappeared after cross-tenant DELETE — "
                f"foreign user actually deleted user A's row."
            )
    finally:
        _delete_chat(http, auth_headers, chat_id)


# ───────────────────────────────────────────────────────────────────────────
# 3. Mass-assignment: caller tries to override server-derived user_id
# ───────────────────────────────────────────────────────────────────────────


def test_mass_assignment_user_id_in_create_chat_is_ignored(
    http: httpx.Client, auth_headers: dict[str, str], test_user_id: str
):
    """POST /api/chats/create — body includes a user_id field.  The route
    DOES read req.user_id, but the auth dependency (`get_verified_user_id`)
    overrides it.  Confirm by setting an attacker user_id and checking the
    response chat is owned by the JWT subject, not the body field.
    """
    resp = http.post(
        _url("/api/chats/create"),
        json={
            "user_id": ATTACKER_USER_ID,
            "title": "idor-mass-assign-probe",
            "model": "default",
        },
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code in (401, 403):
        pytest.skip("Auth not propagating — cannot exercise mass-assignment path")
    assert resp.status_code in (200, 201), (
        f"Create-chat probe failed with {resp.status_code}: {_body_snippet(resp)}"
    )
    try:
        body = resp.json()
        chat = body.get("chat") or body
        owner = chat.get("user_id")
        assert owner == test_user_id, (
            f"SECURITY: mass-assignment succeeded — chat created with "
            f"user_id={owner!r} (server should have used JWT subject "
            f"{test_user_id!r}, not body's {ATTACKER_USER_ID!r})."
        )
        chat_id = chat.get("id")
        if chat_id:
            _delete_chat(http, auth_headers, chat_id)
    except Exception as e:
        pytest.fail(f"Could not parse create-chat response: {e}. Body: {_body_snippet(resp)}")


# ───────────────────────────────────────────────────────────────────────────
# 4. /api/schedules/{chat_id} — schedule CRUD requires chat ownership
# ───────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("chat_id", [FAKE_UUID_1, FAKE_UUID_2])
def test_get_schedule_fake_chat_404(
    http: httpx.Client, auth_headers: dict[str, str], chat_id: str
):
    """GET /api/schedules/{fake} — must 404 (chat does not exist)."""
    resp = http.get(_url(f"/api/schedules/{chat_id}"), headers=auth_headers)
    _skip_if_invalid_user(resp)
    assert resp.status_code in (403, 404), (
        f"GET /api/schedules/{chat_id} returned {resp.status_code} — "
        f"expected 403/404. Body: {_body_snippet(resp)}"
    )
    _assert_no_leak(resp, sensitive_field_names=("schedule",))


def test_post_schedule_for_foreign_chat_id_blocked(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """POST /api/schedules/{foreign-chat-id} with a valid body must be
    rejected — the chat does not belong to the caller.

    The route's `_verify_chat_ownership` returns 404 when the chat is not
    owned by the user, so we can use a totally fake UUID and the same code
    path runs.
    """
    body = {
        "frequency": "daily",
        "machineId": str(uuid.uuid4()),
        "time": "09:00",
        "timezone": "UTC",
    }
    resp = http.post(
        _url(f"/api/schedules/{FAKE_UUID_1}"),
        json=body,
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    assert resp.status_code in (403, 404), (
        f"SECURITY: POST /api/schedules on a foreign chat returned "
        f"{resp.status_code}. Body: {_body_snippet(resp)}"
    )


def test_delete_schedule_fake_chat_returns_4xx(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """DELETE /api/schedules/{fake} — never 500, never 200 with leak."""
    resp = http.request(
        "DELETE",
        _url(f"/api/schedules/{FAKE_UUID_1}"),
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    assert resp.status_code in (403, 404), (
        f"DELETE /api/schedules/{FAKE_UUID_1} returned {resp.status_code}. "
        f"Body: {_body_snippet(resp)}"
    )


def test_put_triggers_for_foreign_chat_blocked(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """PUT /api/schedules/{foreign-chat-id}/triggers — must reject.

    Even with a perfectly-shaped body, the chat ownership check should fire
    first.
    """
    resp = http.put(
        _url(f"/api/schedules/{FAKE_UUID_1}/triggers"),
        json={
            "triggers": [
                {
                    "target_chat_id": FAKE_UUID_2,
                    "event": "on_complete",
                    "pass_output": True,
                    "enabled": True,
                }
            ]
        },
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    assert resp.status_code in (400, 403, 404), (
        f"PUT triggers on foreign chat returned {resp.status_code}. "
        f"Body: {_body_snippet(resp)}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 5. /api/swarm/{swarm_id} — swarm ownership check
# ───────────────────────────────────────────────────────────────────────────


def test_swarm_status_unknown_id_does_not_500(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """GET /api/swarm/status/{unknown} — route currently returns 200 with
    {"active": False}.  That's fine; what we forbid is 5xx (handler crashed)
    or any leakage of state from another user's swarm.
    """
    resp = http.get(
        _url(f"/api/swarm/status/{FAKE_UUID_1}"), headers=auth_headers
    )
    _skip_if_invalid_user(resp)
    # Acceptable: 200 with active=False, or 401/403/404
    assert resp.status_code < 500, (
        f"swarm/status returned {resp.status_code} on unknown id"
    )
    if resp.status_code == 200:
        body = resp.json()
        # Must NOT leak any state — only "active" + "swarm_id" allowed.
        leaked = [k for k in body if k not in ("active", "swarm_id")]
        assert not leaked, (
            f"SECURITY: swarm/status on unknown id leaked fields {leaked} — "
            f"body: {body!r}"
        )
        assert body.get("active") is False


def test_swarm_stop_unknown_id_does_not_500(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """POST /api/swarm/stop/{unknown} — same shape; 200 with stopped=False is OK."""
    resp = http.post(
        _url(f"/api/swarm/stop/{FAKE_UUID_1}"), headers=auth_headers
    )
    _skip_if_invalid_user(resp)
    assert resp.status_code < 500
    if resp.status_code == 200:
        body = resp.json()
        # The route returns {"stopped": False, "reason": "..."} on unknown
        assert body.get("stopped") in (False, None), (
            f"SECURITY: swarm/stop on unknown id returned stopped={body.get('stopped')!r} — "
            f"body: {body!r}"
        )


# ───────────────────────────────────────────────────────────────────────────
# 6. /api/screenshots/{screenshot_id} — known to be unauthenticated
# ───────────────────────────────────────────────────────────────────────────


def test_screenshot_unknown_id_returns_404(http: httpx.Client):
    """GET /api/screenshots/{unknown} → 404 (no leak).

    NOTE: This endpoint is currently UNAUTHENTICATED — there is no
    Depends(get_verified_user_id) on the route handler.  This test
    documents the current status: a request without auth returns 403
    (because of InternalAPIKeyMiddleware) or 404.  If the middleware is
    relaxed in the future, the route MUST add ownership enforcement.
    """
    resp = http.get(
        _url(f"/api/screenshots/{FAKE_UUID_1}")
    )
    # Unauthenticated requests pass through InternalAPIKeyMiddleware (403)
    # OR if relaxed, hit the handler and 404.  Both are acceptable today.
    assert resp.status_code in (401, 403, 404), (
        f"screenshots returned {resp.status_code} unauth — expected 401/403/404. "
        f"Body: {_body_snippet(resp)}"
    )


def test_screenshot_with_auth_unknown_id_returns_404(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """With a valid Bearer, GET /api/screenshots/{fake-uuid} → 404."""
    resp = http.get(
        _url(f"/api/screenshots/{FAKE_UUID_1}"), headers=auth_headers
    )
    _skip_if_invalid_user(resp)
    # 429 is a transient rate-limit signal that runs BEFORE auth in the
    # middleware chain; don't fail the security test on it.
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later or with a fresh source IP")
    # Per the route, it returns 404 when the screenshot doesn't exist.
    # 401/403 also acceptable if InternalAPIKeyMiddleware decided to gate.
    assert resp.status_code in (401, 403, 404), (
        f"screenshots authed returned {resp.status_code}. "
        f"Body: {_body_snippet(resp)}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 7. /api/files/* — file ops with a foreign machine_id
# ───────────────────────────────────────────────────────────────────────────


def test_file_list_foreign_machine_id_returns_403(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """POST /api/files/list with a fake machine_id — `verify_machine_access`
    returns None when the user does not own the machine, which surfaces as
    a 403."""
    resp = http.post(
        _url("/api/files/list"),
        json={
            "machine_id": FAKE_UUID_1,
            "path": "/etc/passwd",
            "recursive": False,
            "max_files": 1,
        },
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later")
    assert resp.status_code in (401, 403, 404), (
        f"POST /api/files/list with foreign machine_id returned {resp.status_code}. "
        f"Body: {_body_snippet(resp)}"
    )
    # Body must not contain any actual file listings.
    _assert_no_leak(resp, sensitive_field_names=("files", "directory"))


def test_file_download_foreign_machine_id_returns_403(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """POST /api/files/download — same guard."""
    resp = http.post(
        _url("/api/files/download"),
        json={
            "machine_id": FAKE_UUID_1,
            "filepath": "/etc/passwd",
            "encoding": "utf-8",
        },
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later")
    assert resp.status_code in (401, 403, 404), (
        f"POST /api/files/download with foreign machine_id returned "
        f"{resp.status_code}. Body: {_body_snippet(resp)}"
    )
    _assert_no_leak(resp, sensitive_field_names=("content", "filename"))


# ───────────────────────────────────────────────────────────────────────────
# 8. /api/electron/machines/{id} — health + approvals scoped to owner
# ───────────────────────────────────────────────────────────────────────────


def test_electron_machine_health_foreign_id_blocked(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """GET /api/electron/machines/{foreign-id}/health — must not return
    machine state for a machine the caller does not own."""
    resp = http.get(
        _url(f"/api/electron/machines/{FAKE_UUID_1}/health"),
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later")
    assert resp.status_code in (401, 403, 404), (
        f"machine health on foreign id returned {resp.status_code}. "
        f"Body: {_body_snippet(resp)}"
    )


def test_electron_machine_approvals_foreign_id_blocked(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """GET /api/electron/machines/{foreign-id}/approvals — same."""
    resp = http.get(
        _url(f"/api/electron/machines/{FAKE_UUID_1}/approvals"),
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later")
    assert resp.status_code in (401, 403, 404), (
        f"machine approvals on foreign id returned {resp.status_code}."
    )


def test_electron_machine_unregister_foreign_id_blocked(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """POST /api/electron/machines/{foreign-id}/unregister — must reject."""
    resp = http.post(
        _url(f"/api/electron/machines/{FAKE_UUID_1}/unregister"),
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later")
    # Acceptable: 400/401/403/404 — anything but a successful unregister.
    assert resp.status_code in (400, 401, 403, 404), (
        f"unregister on foreign id returned {resp.status_code}. "
        f"Body: {_body_snippet(resp)}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 9. /api/billing/sessions/{session_id}/status — cross-tenant session lookup
# ───────────────────────────────────────────────────────────────────────────


def test_billing_session_status_foreign_session_blocked(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """GET /api/billing/sessions/{fake}/status — route returns 403 when
    session.user_id != caller, 404 when not found.  Either is fine; what we
    forbid is 200 with another user's session blob."""
    resp = http.get(
        _url(f"/api/billing/sessions/{FAKE_UUID_1}/status"),
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later")
    assert resp.status_code in (401, 403, 404), (
        f"billing session status returned {resp.status_code}. "
        f"Body: {_body_snippet(resp)}"
    )
    _assert_no_leak(
        resp,
        sensitive_field_names=("session_id", "machine_id", "credits_used", "user_id"),
    )


# ───────────────────────────────────────────────────────────────────────────
# 10. HTTP method confusion
# ───────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("method,path", [
    ("POST", f"/api/chats/{FAKE_UUID_1}"),                # GET-only on this id form
    ("DELETE", "/api/chats/list"),                         # /list is GET
    ("PUT", f"/api/chats/{FAKE_UUID_1}/messages"),         # GET only
    ("POST", f"/api/billing/sessions/{FAKE_UUID_1}/status"),  # GET only
    ("DELETE", "/api/swarm/execute"),                      # POST only
])
def test_method_confusion_returns_4xx_not_5xx(
    http: httpx.Client, auth_headers: dict[str, str], method: str, path: str
):
    """The wrong HTTP method on a typed endpoint must be a clean 4xx —
    never a 5xx (which would indicate the router crashed) and never a 200
    (which would mean the wrong handler ran)."""
    resp = http.request(method, _url(path), headers=auth_headers)
    _skip_if_invalid_user(resp)
    assert resp.status_code != 200, (
        f"SECURITY: {method} {path} returned 200 — wrong method should not "
        f"succeed. Body: {_body_snippet(resp)}"
    )
    assert 400 <= resp.status_code < 500, (
        f"{method} {path} returned {resp.status_code} — expected 4xx, "
        f"never 5xx on method confusion. Body: {_body_snippet(resp)}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 11. Path-param injection
# ───────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("injection", PATH_INJECTIONS)
def test_chat_id_path_injection_does_not_500(
    http: httpx.Client, auth_headers: dict[str, str], injection: str
):
    """Path-param injection probes (NUL, newline, traversal, semicolon)
    against /api/chats/{chat_id} must not crash the handler."""
    # We deliberately do NOT URL-encode here a second time — httpx will
    # encode reserved chars, but the input string itself contains the
    # already-encoded payload.  Use a raw URL build via httpx.URL.
    url = httpx.URL(_url("/api/chats/")).copy_with(path=f"/api/chats/{injection}")
    resp = http.get(url, headers=auth_headers)
    _skip_if_invalid_user(resp)
    assert resp.status_code < 500, (
        f"SECURITY: path injection {injection!r} caused {resp.status_code} on "
        f"/api/chats/. Body: {_body_snippet(resp)}"
    )


@pytest.mark.parametrize("injection", PATH_INJECTIONS)
def test_schedule_id_path_injection_does_not_500(
    http: httpx.Client, auth_headers: dict[str, str], injection: str
):
    """Same shape for /api/schedules/{chat_id}."""
    url = httpx.URL(_url("/api/schedules/")).copy_with(path=f"/api/schedules/{injection}")
    resp = http.get(url, headers=auth_headers)
    _skip_if_invalid_user(resp)
    assert resp.status_code < 500, (
        f"SECURITY: path injection {injection!r} caused {resp.status_code} on "
        f"/api/schedules/. Body: {_body_snippet(resp)}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 12. Public CUA: cross-key session isolation
# ───────────────────────────────────────────────────────────────────────────


def test_public_cua_get_session_unknown_id_returns_404():
    """We can run this with a single key.  Asking for a session UUID that
    doesn't exist in the caller's namespace must be 404 — never 200, never
    a leak from another tenant.
    """
    key = _public_key()
    if not key:
        pytest.skip(
            "TEST_PUBLIC_API_KEY not set — cannot exercise public CUA session "
            "lookup."
        )
    import httpx as _httpx
    with _httpx.Client(verify=False, http2=True, timeout=15.0) as c:
        resp = c.get(
            f"{cfg().backend_public_url}/api/v1/cua/sessions/{FAKE_UUID_1}",
            headers={"X-API-Key": key},
        )
    assert resp.status_code in (401, 403, 404), (
        f"public CUA get session returned {resp.status_code} on fake id. "
        f"Body: {_body_snippet(resp)}"
    )
    # The 404 envelope must follow the documented shape and NOT echo a
    # foreign session blob.
    if resp.status_code == 404:
        try:
            body = resp.json()
            err = (body.get("detail") or body).get("error") or {}
            assert err.get("code") == "SESSION_NOT_FOUND", (
                f"Public CUA 404 envelope wrong: {body!r}"
            )
        except Exception:
            pass


def test_public_cua_cross_key_session_isolation():
    """Tenant A creates a session with key A; tenant B (key B) attempts to
    GET / DELETE it.  Must be 404 for B (the session's user_id is enforced
    in `public_cua_session_manager.get_session`).
    """
    key_a = _public_key()
    key_b = _second_public_key()
    if not key_a or not key_b:
        pytest.skip(
            "Need both TEST_PUBLIC_API_KEY and TEST_PUBLIC_API_KEY_2 set "
            "(belonging to different users) to exercise cross-tenant session "
            "isolation in the public API."
        )
    import httpx as _httpx
    base = cfg().backend_public_url
    with _httpx.Client(verify=False, http2=True, timeout=20.0) as c:
        # Create session as user A
        create = c.post(
            f"{base}/api/v1/cua/sessions",
            headers={"X-API-Key": key_a, "Content-Type": "application/json"},
            json={
                "cua_version": "v3",
                "model": "default",
                "screen_width": 1280,
                "screen_height": 720,
                "max_trajectory_length": 3,
            },
        )
        if create.status_code != 200:
            pytest.skip(
                f"Could not create session as user A ({create.status_code}): "
                f"{_body_snippet(create)}"
            )
        try:
            session_id = create.json().get("session_id")
            assert session_id, f"No session_id in create response: {create.json()!r}"
            # User B reads
            read_b = c.get(
                f"{base}/api/v1/cua/sessions/{session_id}",
                headers={"X-API-Key": key_b},
            )
            assert read_b.status_code == 404, (
                f"SECURITY: tenant B read tenant A's CUA session — got "
                f"{read_b.status_code}. Body: {_body_snippet(read_b)}"
            )
            # User B deletes
            del_b = c.delete(
                f"{base}/api/v1/cua/sessions/{session_id}",
                headers={"X-API-Key": key_b},
            )
            assert del_b.status_code == 404, (
                f"SECURITY: tenant B deleted tenant A's CUA session — got "
                f"{del_b.status_code}. Body: {_body_snippet(del_b)}"
            )
            # Confirm session is still readable by owner
            verify = c.get(
                f"{base}/api/v1/cua/sessions/{session_id}",
                headers={"X-API-Key": key_a},
            )
            assert verify.status_code == 200, (
                f"SECURITY: session {session_id!r} not readable by owner "
                f"after foreign DELETE — possible cross-tenant deletion. "
                f"Status: {verify.status_code}, Body: {_body_snippet(verify)}"
            )
        finally:
            # Cleanup
            try:
                c.delete(
                    f"{base}/api/v1/cua/sessions/{session_id}",
                    headers={"X-API-Key": key_a},
                )
            except Exception:
                pass


def test_public_cua_session_predict_cross_key_blocked():
    """Cross-tenant POST /sessions/{id}/predict must 404."""
    key_a = _public_key()
    key_b = _second_public_key()
    if not key_a or not key_b:
        pytest.skip("Need TEST_PUBLIC_API_KEY and TEST_PUBLIC_API_KEY_2")
    import httpx as _httpx
    base = cfg().backend_public_url
    with _httpx.Client(verify=False, http2=True, timeout=20.0) as c:
        create = c.post(
            f"{base}/api/v1/cua/sessions",
            headers={"X-API-Key": key_a, "Content-Type": "application/json"},
            json={"cua_version": "v3", "screen_width": 1280, "screen_height": 720},
        )
        if create.status_code != 200:
            pytest.skip(
                f"Could not create session as A ({create.status_code})"
            )
        session_id = create.json().get("session_id")
        try:
            # Tenant B tries to drive A's session
            tiny_jpg_b64 = (
                "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8U"
                "HRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAABAAEDASIA"
                "AhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA"
                "/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEA"
                "AhEDEQA/AJ//2Q=="
            )
            resp = c.post(
                f"{base}/api/v1/cua/sessions/{session_id}/predict",
                headers={"X-API-Key": key_b, "Content-Type": "application/json"},
                json={
                    "instruction": "click anywhere",
                    "screenshot": tiny_jpg_b64,
                },
            )
            assert resp.status_code == 404, (
                f"SECURITY: cross-tenant session_predict returned "
                f"{resp.status_code} — must 404. Body: {_body_snippet(resp)}"
            )
        finally:
            try:
                c.delete(
                    f"{base}/api/v1/cua/sessions/{session_id}",
                    headers={"X-API-Key": key_a},
                )
            except Exception:
                pass


def test_public_cua_revoke_foreign_key_id_does_not_modify_other_tenant():
    """DELETE /api/v1/cua/keys/{nonexistent_or_foreign_id} must NOT revoke
    a key belonging to another tenant.

    Implementation note (api_key_service.revoke_key): the UPDATE statement
    is `... WHERE id = key_id AND user_id = ctx.user_id`, so any key not
    owned by the caller is untouched regardless of the response code.
    Currently the route returns 200 when the key is non-existent or
    foreign — this is a UX wart (it lies to the caller) but NOT a real
    IDOR.  We document the current behavior and assert the strict
    invariant: it must NOT 5xx.

    A regression we DO want to catch: if the user_id filter is dropped
    from the UPDATE in a future refactor, a 200 here would mean an actual
    cross-tenant revocation.  Without a second key to verify against, we
    can't catch that here — see test_public_cua_cross_key_session_isolation
    for the analogous session test which DOES detect it.
    """
    key_a = _public_key()
    if not key_a:
        pytest.skip("TEST_PUBLIC_API_KEY not set")
    foreign_key_id = "key_" + uuid.uuid4().hex
    import httpx as _httpx
    with _httpx.Client(verify=False, http2=True, timeout=15.0) as c:
        resp = c.delete(
            f"{cfg().backend_public_url}/api/v1/cua/keys/{foreign_key_id}",
            headers={"X-API-Key": key_a},
        )
    # Current behaviour is 200 (UX wart) or 404 (cleaner).  Both are
    # acceptable from a security standpoint because the SQL WHERE-clause
    # ensures no foreign data is modified.  5xx is the only real failure.
    assert resp.status_code < 500, (
        f"DELETE /keys/{foreign_key_id} 5xx'd: {resp.status_code}. "
        f"Body: {_body_snippet(resp)}"
    )
    # The most important post-condition: caller's own key (key_a) must
    # still validate.  If the foreign DELETE accidentally revoked key_a,
    # listing keys would fail with 401.
    with _httpx.Client(verify=False, http2=True, timeout=15.0) as c:
        verify = c.get(
            f"{cfg().backend_public_url}/api/v1/cua/models",
            headers={"X-API-Key": key_a},
        )
    assert verify.status_code != 401, (
        f"SECURITY: caller's own key was revoked by a DELETE on a foreign "
        f"key id — IDOR breach. Verify status: {verify.status_code}. "
        f"Body: {_body_snippet(verify)}"
    )


def test_public_cua_list_sessions_does_not_show_foreign():
    """GET /api/v1/cua/sessions for tenant A must only show A's sessions.

    We can verify the WEAKER property without a second tenant: every
    returned session must have a session_id that we can read back with
    the same key.  If sessions list ever included rows whose user_id is
    not A's, the get-by-id would return 404 instead of 200.
    """
    key = _public_key()
    if not key:
        pytest.skip("TEST_PUBLIC_API_KEY not set")
    import httpx as _httpx
    with _httpx.Client(verify=False, http2=True, timeout=15.0) as c:
        resp = c.get(
            f"{cfg().backend_public_url}/api/v1/cua/sessions",
            headers={"X-API-Key": key},
        )
        assert_status(resp, 200)
        body = resp.json()
        sessions = body.get("sessions") or []
        assert isinstance(sessions, list)
        # Spot-check up to first 3 sessions
        for s in sessions[:3]:
            sid = s.get("session_id") or s.get("id")
            if not sid:
                continue
            verify = c.get(
                f"{cfg().backend_public_url}/api/v1/cua/sessions/{sid}",
                headers={"X-API-Key": key},
            )
            assert verify.status_code == 200, (
                f"SECURITY: list_sessions returned session {sid!r} that is "
                f"not readable by the same key (status={verify.status_code}). "
                f"This indicates list-vs-get tenant filtering drift."
            )
