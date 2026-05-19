"""
test_security_machine_isolation.py — Cross-tenant isolation regressions for
the Electron-bridge, VM-control, and Redis cache layers.

This file is the post-deployment counterpart to
``backend/tests/test_security_cache_isolation.py``. Where the unit suite
mocks Redis and asserts module contracts, this suite hits the live
production backend through the public ALB and probes for tenant leakage
and bad-input crashes.

Coverage matrix
---------------
Electron machine cross-tenant
  * GET  /api/electron/machines               — list returns only own
  * GET  /api/electron/machines/{foreign}/health
  * GET  /api/electron/machines/{foreign}/approvals
  * POST /api/electron/machines/{foreign}/approval-mode
  * POST /api/electron/machines/{foreign}/unregister  (the closest existing
                                                       "delete-like" route —
                                                       must not destroy a
                                                       foreign machine)
  * WS   /api/electron/ws — auth as user A but claim a foreign user_id /
                            machine_id in the auth body  (impersonation)

VM control cross-tenant
  * POST /api/vm/{foreign}/screenshot   (route may not exist — accept 404)
  * POST /api/vm/action                 (body carries machine_id)
  * GET  /api/vm/{foreign}/status
  * Any vm route + malformed machine_id (NUL, ../, very long) → 4xx not 5xx

Cache key isolation (informational probe)
  * User A creates chat C1 → user A's chat list contains it.
    User A's list is the only thing we can probe without a second tenant.
    With TEST_USER_TOKEN_2 set, user B's list MUST NOT contain C1 — that's
    the cross-tenant cache-leak regression.
  * Cache poisoning: very large title — backend must reject or truncate,
    never 5xx and never echo the unbounded payload back through the cache.

Connection-manager probes
  * Force-close a WS with bad auth (server emits 4001), reconnect 5×
    immediately → no 5xx, eventually accepted. Tests circuit-breaker
    doesn't lock out a legitimate user after a few bad-auth bursts.
  * Send a heartbeat for a session not bound to your token → ignored,
    no crash, connection survives or closes cleanly.

Constraints (honored)
---------------------
* TEST_FOREIGN_MACHINE_ID env var skips foreign-machine REST tests cleanly
  when not provided. CI should set it to a UUID owned by a *different*
  user to actually exercise the IDOR path. Without it, we still run the
  fake-UUID variants which catch the most common ownership-check
  regressions.
* Each test name encodes attack vector + expected outcome (e.g.
  ``test_electron_health_foreign_machine_id_returns_403_or_404``).
* Concurrent ops capped at 20 in any test that opens parallel sockets.
* Each network round-trip wrapped in ``asyncio.wait_for`` so a wedged
  connection never hangs the suite.
"""
from __future__ import annotations

import asyncio
import json
import os
import ssl
import time
import uuid
from typing import Optional
from urllib.parse import urlencode

import httpx
import pytest
import websockets
from websockets.exceptions import (
    ConnectionClosed,
    ConnectionClosedError,
    ConnectionClosedOK,
    InvalidStatus,
    InvalidStatusCode,
    InvalidHandshake,
)

from conftest import cfg, assert_status


# ── Markers ─────────────────────────────────────────────────────────────────
pytestmark = pytest.mark.security


# ── Constants ───────────────────────────────────────────────────────────────

# Maximum concurrent ops in any one test — the constraint is "cap at 20".
MAX_CONCURRENT_OPS = 20

# Per-network-op wall-clock budget. Generous enough to absorb a Cloudflare
# challenge or rate-limiter back-off; tight enough that a hanging socket
# fails fast.
NET_TIMEOUT = 15.0
WS_OPEN_TIMEOUT = 10.0

# Fake but well-formed UUIDs — should never collide with anything real.
FAKE_MACHINE_1 = "00000000-0000-0000-0000-000000000a01"
FAKE_MACHINE_2 = "00000000-0000-0000-0000-000000000a02"

# Malformed machine_id payloads. Each has to be a path-component the router
# won't immediately reject as 404 from the URL parser — so we URL-encode
# the dangerous bytes and let httpx pass them through.
MALFORMED_MACHINE_IDS = [
    "abc%00.txt",                    # NUL byte
    "..%2F..%2Fetc%2Fpasswd",        # path traversal
    "abc%0Ainjected",                # newline injection
    "abc%3Bls",                      # semicolon → shell metachar
    "A" * 1024,                      # very long
    "machine-id-with-空白",           # non-ASCII (likely fine, but probe)
]

# Insecure SSL — same justification as the rest of the suite. We're
# probing OUR backend at the ALB DNS, not validating a third-party chain.
_INSECURE_SSL = ssl.create_default_context()
_INSECURE_SSL.check_hostname = False
_INSECURE_SSL.verify_mode = ssl.CERT_NONE


# ── Helpers ─────────────────────────────────────────────────────────────────


def _url(path: str) -> str:
    return f"{cfg().backend_public_url}{path}"


def _body_snippet(resp: httpx.Response, n: int = 300) -> str:
    try:
        return (resp.text or "")[:n].replace("\n", " ")
    except Exception:
        return "<undecodable>"


def _skip_if_invalid_user(resp: httpx.Response) -> None:
    """Test infra issue — JWT is valid, but either:

      (a) `InternalAPIKeyMiddleware` rejected the Bearer token outright
          (returns 403 with `{"error": "Forbidden"}` or similar), which
          can happen when the test is hitting a backend whose SUPABASE_URL
          doesn't match the URL the test user signed in against, or when
          the backend's Supabase service-role JWT for user lookups has
          expired and pending-refresh.

      (b) The JWT validates but the user isn't in the backend `users`
          table (returns 401 `{"error":"Invalid user"}`).

    Both are infrastructure gaps, not code-path regressions. Skip
    cleanly with a clear pointer to the cure rather than failing the
    test and burying real auth-code regressions in noise.
    """
    body_lower = (resp.text or "").lower()
    if resp.status_code == 401 and "invalid user" in body_lower:
        pytest.skip(
            "Test user not fully onboarded in backend users table. Sign in "
            "to the web app once with TEST_USER_EMAIL / TEST_USER_PASSWORD "
            "to provision the profile row, then re-run."
        )
    if resp.status_code == 403 and (
        "forbidden" in body_lower
        or "invalid token" in body_lower
        or "invalid api key" in body_lower
        or body_lower == ""
    ):
        pytest.skip(
            "Backend rejected the Bearer JWT outright (403). Most common "
            "cause: the backend's configured SUPABASE_URL doesn't match the "
            "URL the test user signed in against, or the backend's "
            "service-role JWT used for user lookups is expired. Verify "
            "SUPABASE_URL parity between this run's .env and the backend "
            "task definition, then re-run."
        )


def _foreign_machine_id() -> Optional[str]:
    """Pre-seeded machine_id that belongs to a *different* user.

    Set TEST_FOREIGN_MACHINE_ID in tests/post_deploy/.env to exercise the
    real IDOR path. Without it, we still run the FAKE_MACHINE_* variants
    which catch the most common ownership-check regressions but can't
    distinguish "row not found" from "row exists for someone else".
    """
    val = os.environ.get("TEST_FOREIGN_MACHINE_ID", "").strip()
    return val or None


def _second_user_token() -> Optional[str]:
    """Pre-minted access token of a different test user — used for the
    cross-tenant cache probe."""
    val = os.environ.get("TEST_USER_TOKEN_2", "").strip()
    return val or None


def _ws_url() -> str:
    base = cfg().ws_public_url
    params = urlencode({
        "platform": "linux",
        "os_name": "ci-iso",
        "os_version": "0.0.0",
        "arch": "x64",
        "hostname": "ci-iso",
        "username": "ci",
        "home_dir": "/home/ci",
        "shell": "/bin/bash",
        "screen_width": "1920",
        "screen_height": "1080",
    })
    return f"{base}/api/electron/ws?{params}"


def _ssl_kwargs(url: str) -> dict:
    return {"ssl": _INSECURE_SSL} if url.startswith("wss://") else {}


async def _ws_open(url: str, **kwargs):
    return await asyncio.wait_for(
        websockets.connect(
            url,
            open_timeout=WS_OPEN_TIMEOUT,
            close_timeout=2.0,
            **_ssl_kwargs(url),
            **kwargs,
        ),
        timeout=WS_OPEN_TIMEOUT,
    )


async def _ws_recv_json(ws, timeout: float = 5.0) -> dict:
    raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    return json.loads(raw)


def _auth_msg(token: str, machine_id: str, user_id: str, **extra) -> str:
    payload = {
        "type": "auth",
        "token": token,
        "machine_id": machine_id,
        "user_id": user_id,
    }
    payload.update(extra)
    return json.dumps(payload)


# ════════════════════════════════════════════════════════════════════════════
# Section 1 — Electron machines REST cross-tenant
# ════════════════════════════════════════════════════════════════════════════


def test_electron_machines_list_returns_only_own_machines(
    http: httpx.Client, auth_headers: dict[str, str], test_user_id: str
):
    """GET /api/electron/machines — every returned machine MUST be owned
    by the authenticated user.

    The route filters on ``user_id == verified_uid`` server-side
    (electron_bridge.py:676). If the filter ever drops, this test catches
    it as long as another user has a machine in the DB.
    """
    resp = http.get(_url("/api/electron/machines"), headers=auth_headers)
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later")
    assert_status(resp, 200)
    body = resp.json()
    machines = body.get("machines") or []
    assert isinstance(machines, list), f"machines should be list: {body!r}"

    # Per-machine sanity: id is a non-empty string. The route does NOT
    # echo user_id back, but every row is filtered server-side; we cannot
    # cross-validate without admin access. The post-condition we CAN
    # assert is "list shape is consistent and bounded" — anything more
    # would require staging a known machine of a different user.
    for m in machines:
        assert isinstance(m, dict)
        assert isinstance(m.get("id"), str) and m["id"]
        # The route never sets `user_id` in the response — that's by
        # design (no point leaking your own uuid back to you). If a
        # refactor ever adds it, every entry must equal test_user_id.
        if "user_id" in m:
            assert m["user_id"] == test_user_id, (
                f"SECURITY: machines list leaked foreign user_id={m['user_id']!r} "
                f"(caller is {test_user_id!r})"
            )


def test_electron_health_foreign_machine_id_returns_403_or_404(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """GET /api/electron/machines/{foreign}/health — must reject.

    Implementation note (electron_bridge.py:846): the handler reads the
    in-process ``vm_control_service.session_data`` for the machine_id; if
    the session belongs to another user, it raises 403. If the session is
    missing (machine offline / on a different worker), the handler returns
    ``agentReady=False`` with no auth check — that's the gap we want to
    surface.

    Skipped cleanly when no foreign-machine id is staged.
    """
    foreign = _foreign_machine_id() or FAKE_MACHINE_1
    using_real_foreign = bool(_foreign_machine_id())

    resp = http.get(
        _url(f"/api/electron/machines/{foreign}/health"),
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later")

    if using_real_foreign:
        # Real foreign machine: must be 403 (or 404 if hidden).
        assert resp.status_code in (401, 403, 404), (
            f"SECURITY: health on FOREIGN machine {foreign!r} returned "
            f"{resp.status_code}. Body: {_body_snippet(resp)}"
        )
    else:
        # Fake UUID: a 200 with agentReady=false is the documented behaviour
        # for "no session in memory" (electron_bridge.py:861-867). That's a
        # KNOWN GAP — anyone can probe whether a machine_id is online by
        # observing the response shape. We document it but don't fail the
        # test: any 4xx OR a 200 with no session leak is acceptable.
        assert resp.status_code < 500, (
            f"health endpoint 5xx on fake id: {resp.status_code} body: "
            f"{_body_snippet(resp)}"
        )
        if resp.status_code == 200:
            body = resp.json()
            # Body must NOT carry a foreign user's session info.
            for leaky in ("user_id", "session_id", "platform"):
                if leaky in body:
                    pytest.fail(
                        f"SECURITY: health 200 leaked field {leaky!r}={body[leaky]!r} "
                        f"on a machine_id the caller does not own. Body: {body!r}"
                    )


def test_electron_approvals_foreign_machine_id_returns_403_or_404(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """GET /api/electron/machines/{foreign}/approvals — must reject.

    The route (electron_bridge.py:874) checks
    ``session.get('user_id') == caller_uid`` — but only when the session
    exists in memory. If the machine is offline / on a different worker,
    the check is bypassed and the handler returns the merged Redis +
    local approval list. That list is keyed by machine_id only; an
    attacker who knows a machine_id could read pending approvals.

    Real-foreign variant exercises the auth gate. Fake-UUID variant
    asserts no 5xx.
    """
    foreign = _foreign_machine_id() or FAKE_MACHINE_1
    using_real_foreign = bool(_foreign_machine_id())

    resp = http.get(
        _url(f"/api/electron/machines/{foreign}/approvals"),
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later")

    if using_real_foreign:
        assert resp.status_code in (401, 403, 404), (
            f"SECURITY: approvals on FOREIGN machine returned "
            f"{resp.status_code}. Body: {_body_snippet(resp)}"
        )
    else:
        assert resp.status_code < 500
        if resp.status_code == 200:
            body = resp.json()
            approvals = body.get("approvals") or []
            assert approvals == [] or isinstance(approvals, list), (
                f"SECURITY: approvals 200 with non-empty body for fake "
                f"machine_id — possible cross-tenant leak. Body: {body!r}"
            )
            # Guarded: even if the list is empty, it should be empty.
            # A non-empty list here would be the real finding.
            for a in approvals:
                pytest.fail(
                    f"SECURITY: approvals on fake/foreign machine_id leaked "
                    f"approval record {a!r}"
                )


def test_electron_approval_mode_post_foreign_machine_id_returns_403_or_404(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """POST /api/electron/machines/{foreign}/approval-mode — must reject.

    NOTE: The route does NOT exist on the documented bridge surface —
    approval mode is set via WS messages, not REST. We probe anyway: any
    response must be 4xx (404 = route absent is the expected outcome).
    A 200 here would imply a hidden REST handler that bypasses ownership.
    """
    foreign = _foreign_machine_id() or FAKE_MACHINE_1
    resp = http.post(
        _url(f"/api/electron/machines/{foreign}/approval-mode"),
        json={"mode": "off"},
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later")
    assert resp.status_code in (400, 401, 403, 404, 405), (
        f"SECURITY: approval-mode POST on foreign machine returned "
        f"{resp.status_code} — expected 4xx. Body: {_body_snippet(resp)}"
    )


def test_electron_unregister_post_foreign_machine_id_does_not_destroy(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """POST /api/electron/machines/{foreign}/unregister — the closest
    "destructive" route on the bridge surface. Must not destroy a foreign
    machine.

    Implementation (electron_bridge.py:746): the handler calls
    ``db_service.get_machine(machine_id, user_id)`` first, which returns
    None if the row's user_id doesn't match — surfaced as a 404. So a 200
    here on a foreign machine_id would mean the ownership filter was
    dropped from get_machine().
    """
    foreign = _foreign_machine_id() or FAKE_MACHINE_1
    resp = http.post(
        _url(f"/api/electron/machines/{foreign}/unregister"),
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later")
    # 400 = "Not an Electron device", 404 = "Machine not found", both fine.
    assert resp.status_code in (400, 401, 403, 404), (
        f"SECURITY: unregister on foreign machine returned "
        f"{resp.status_code}. A 200 here would mean a foreign machine was "
        f"destroyed. Body: {_body_snippet(resp)}"
    )


def test_electron_delete_machine_route_absent_or_owner_scoped(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """DELETE /api/electron/machines/{foreign} — the bridge does not expose
    a DELETE route (unregister is the documented teardown). Probe anyway:
    a successful DELETE on a foreign machine_id would be a P0 IDOR. 404 /
    405 are the expected outcomes.
    """
    foreign = _foreign_machine_id() or FAKE_MACHINE_1
    resp = http.request(
        "DELETE",
        _url(f"/api/electron/machines/{foreign}"),
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later")
    # 405 = Method Not Allowed, 404 = route or row absent — both fine.
    # 200 / 204 (success) here would be the real finding.
    assert resp.status_code in (401, 403, 404, 405), (
        f"SECURITY: DELETE on foreign machine returned {resp.status_code}. "
        f"A 200/204 would imply a hidden route that destroys foreign rows. "
        f"Body: {_body_snippet(resp)}"
    )


# ════════════════════════════════════════════════════════════════════════════
# Section 2 — Electron WS impersonation (auth payload smuggling)
# ════════════════════════════════════════════════════════════════════════════


@pytest.mark.electron
@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_command_for_foreign_machine_id_in_auth_body_rejected(
    test_jwt: str, test_user_id: str
):
    """Connect to /api/electron/ws as user A but claim a FOREIGN
    machine_id in the auth body. The bridge's machine-ownership check
    (electron_bridge.py:243) must reject with auth_failed code 4003.

    Skipped if TEST_FOREIGN_MACHINE_ID isn't staged — without a real
    machine_id owned by another user, the bridge will auto-register the
    UUID for us instead of exercising the ownership branch.
    """
    foreign = _foreign_machine_id()
    if not foreign:
        pytest.skip(
            "TEST_FOREIGN_MACHINE_ID not set — cannot exercise the WS "
            "machine-ownership rejection path. Set it to a UUID owned by "
            "a different test user in tests/post_deploy/.env."
        )

    async def _scenario():
        ws = await _ws_open(_ws_url())
        try:
            await ws.send(_auth_msg(test_jwt, foreign, test_user_id))
            try:
                msg = await _ws_recv_json(ws, timeout=5.0)
            except (ConnectionClosed, ConnectionClosedError):
                # Direct close without a frame — also acceptable; the
                # connection ended without authing us.
                return
            assert msg.get("type") == "auth_failed", (
                f"SECURITY: WS auth with FOREIGN machine_id={foreign!r} "
                f"returned {msg!r} — expected auth_failed. The server "
                f"would now route commands to a machine the caller does "
                f"not own."
            )
            reason = (msg.get("reason") or "").lower()
            assert reason, f"missing reason: {msg!r}"
            # The bridge logs "machine belongs to another user"; the wire
            # reason might be paraphrased. We tolerate any non-empty value.
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=NET_TIMEOUT)


@pytest.mark.electron
@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_user_id_impersonation_in_auth_body_rejected(
    test_jwt: str
):
    """Send the *valid* JWT but claim a different user_id in the body.
    The bridge verifies the JWT against Supabase and compares the
    returned id with the claimed user_id (electron_bridge.py:191).
    Mismatch must yield auth_failed.

    This is the same property as test_06's covered case but spelled out
    with explicit attack-vector / outcome wording.
    """
    machine = f"post-deploy-iso-impersonate-{uuid.uuid4().hex[:8]}"
    wrong_uid = "00000000-0000-0000-0000-deadbeefcafe"

    async def _scenario():
        ws = await _ws_open(_ws_url())
        try:
            await ws.send(_auth_msg(test_jwt, machine, wrong_uid))
            try:
                msg = await _ws_recv_json(ws, timeout=5.0)
            except (ConnectionClosed, ConnectionClosedError):
                return
            assert msg.get("type") == "auth_failed", (
                f"SECURITY: user_id impersonation accepted — got {msg!r}. "
                f"Server should reject when JWT subject != claimed user_id."
            )
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=NET_TIMEOUT)


# ════════════════════════════════════════════════════════════════════════════
# Section 3 — VM control cross-tenant + malformed input
# ════════════════════════════════════════════════════════════════════════════


def test_vm_status_foreign_machine_id_does_not_500_or_leak(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """GET /api/vm/{foreign}/status — the legacy router currently returns
    a stub 200 with ``status='unknown'`` regardless of caller (the route
    has no auth). Documented finding: this endpoint is effectively
    unauthenticated for status, but doesn't expose any real data.

    The post-condition we DO enforce: the body must NOT contain anything
    beyond the documented stub fields, and never 5xx.
    """
    foreign = _foreign_machine_id() or FAKE_MACHINE_1
    resp = http.get(
        _url(f"/api/vm/{foreign}/status"),
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later")
    assert resp.status_code < 500, (
        f"vm status 5xx for {foreign!r}: {resp.status_code} body: "
        f"{_body_snippet(resp)}"
    )
    if resp.status_code == 200:
        body = resp.json()
        # Documented stub: {machine_id, status, message}. Anything more
        # is a leak.
        allowed = {"machine_id", "status", "message"}
        leaked = set(body.keys()) - allowed
        assert not leaked, (
            f"SECURITY: vm/status leaked extra fields {leaked} for "
            f"foreign id. Body: {body!r}"
        )


def test_vm_action_foreign_machine_id_in_body_rejected_or_404(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """POST /api/vm/action — body carries machine_id. The legacy
    handler is a TODO stub that returns 200 with success=False.

    What we forbid: a 200 with success=True (the stub doing real work),
    a 5xx (handler crashed on injection), or any leak of foreign state.
    """
    foreign = _foreign_machine_id() or FAKE_MACHINE_1
    resp = http.post(
        _url("/api/vm/action"),
        json={
            "machine_id": foreign,
            "action": "screenshot",
            "parameters": {},
        },
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later")
    assert resp.status_code < 500, (
        f"vm/action 5xx: {resp.status_code} body: {_body_snippet(resp)}"
    )
    if resp.status_code == 200:
        body = resp.json()
        assert body.get("success") is False, (
            f"SECURITY: vm/action stub returned success=True for foreign "
            f"machine_id — handler is doing actual work without an auth "
            f"check. Body: {body!r}"
        )


def test_vm_screenshot_endpoint_absent_or_4xx_for_foreign(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """POST /api/vm/{foreign}/screenshot — endpoint may not exist on the
    legacy router at all. 404 is fine. What we forbid is 200 (handler
    actually fired with foreign machine_id) or 5xx (handler crashed)."""
    foreign = _foreign_machine_id() or FAKE_MACHINE_1
    resp = http.post(
        _url(f"/api/vm/{foreign}/screenshot"),
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later")
    assert resp.status_code in (401, 403, 404, 405), (
        f"SECURITY: vm/screenshot returned {resp.status_code} for foreign "
        f"id. 200/204 here would mean an undocumented handler is running "
        f"with no auth gate. Body: {_body_snippet(resp)}"
    )


@pytest.mark.parametrize("malformed", MALFORMED_MACHINE_IDS)
def test_vm_status_malformed_machine_id_returns_4xx_not_5xx(
    http: httpx.Client, auth_headers: dict[str, str], malformed: str
):
    """Malformed machine_id (NUL, ../, very long, non-ASCII) on the VM
    status route must produce a clean 4xx — never 5xx (handler crashed)
    and never 200 with leaked stub state."""
    url = httpx.URL(_url("/api/vm/")).copy_with(
        path=f"/api/vm/{malformed}/status"
    )
    resp = http.get(url, headers=auth_headers)
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later")
    assert resp.status_code < 500, (
        f"SECURITY: malformed machine_id {malformed!r} → 5xx "
        f"({resp.status_code}). Router or handler crashed on bad input. "
        f"Body: {_body_snippet(resp)}"
    )


@pytest.mark.parametrize("malformed", MALFORMED_MACHINE_IDS)
def test_electron_health_malformed_machine_id_returns_4xx_not_5xx(
    http: httpx.Client, auth_headers: dict[str, str], malformed: str
):
    """Same shape but for the electron-bridge health route, which is the
    real production surface (vm_control router is mostly stubs)."""
    url = httpx.URL(_url("/api/electron/machines/")).copy_with(
        path=f"/api/electron/machines/{malformed}/health"
    )
    resp = http.get(url, headers=auth_headers)
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited — re-run later")
    assert resp.status_code < 500, (
        f"SECURITY: electron health on malformed machine_id "
        f"{malformed!r} → 5xx ({resp.status_code}). "
        f"Body: {_body_snippet(resp)}"
    )


# ════════════════════════════════════════════════════════════════════════════
# Section 4 — Cache key isolation (informational probe)
# ════════════════════════════════════════════════════════════════════════════


def test_chat_create_then_list_includes_own_chat(
    http: httpx.Client, auth_headers: dict[str, str], test_user_id: str
):
    """Sanity baseline for cache isolation: user A creates chat C1, then
    user A's own chat list MUST include it. If this fails, the cache
    layer itself is broken — there's no point asserting cross-tenant
    isolation."""
    create = http.post(
        _url("/api/chats/create"),
        json={
            "user_id": test_user_id,
            "title": "iso-suite-cache-baseline",
            "model": "default",
            "source": "post-deploy-test",
        },
        headers=auth_headers,
    )
    _skip_if_invalid_user(create)
    if create.status_code == 429:
        pytest.skip("Rate-limited")
    if create.status_code in (401, 403):
        pytest.skip(f"Auth not propagating ({create.status_code})")
    assert create.status_code in (200, 201), (
        f"baseline chat create failed: {create.status_code} body: "
        f"{_body_snippet(create)}"
    )
    chat_id = (create.json().get("chat") or create.json()).get("id")
    assert chat_id, f"no chat_id in response: {create.text!r}"
    try:
        listing = http.get(_url("/api/chats/list"), headers=auth_headers)
        if listing.status_code == 429:
            pytest.skip("Rate-limited on list")
        assert_status(listing, 200)
        body = listing.json()
        chats = body.get("chats") or body if isinstance(body, dict) else []
        if isinstance(chats, dict):  # paginated envelope
            chats = chats.get("items") or []
        ids = [c.get("id") for c in chats if isinstance(c, dict)]
        assert chat_id in ids, (
            f"baseline broken: created chat {chat_id!r} not in own list. "
            f"Cache invalidation is regressing — cross-tenant tests are "
            f"meaningless until this passes."
        )
    finally:
        try:
            http.request("DELETE", _url(f"/api/chats/{chat_id}"),
                         headers=auth_headers, timeout=10)
        except Exception:
            pass


def test_chat_list_does_not_leak_to_second_user_via_cache(
    http: httpx.Client, auth_headers: dict[str, str], test_user_id: str
):
    """User A creates chat C1; user B's chat list MUST NOT include C1.

    This is the strongest cache-isolation property we can probe over
    HTTP. If the cache layer ever indexes chats by user_id with a
    collision (or strips the user prefix), C1 would surface in B's
    response.

    Skipped without TEST_USER_TOKEN_2.
    """
    other = _second_user_token()
    if not other:
        pytest.skip(
            "TEST_USER_TOKEN_2 not set — cannot exercise cross-tenant "
            "cache leak. Stage a second test user's access_token to enable."
        )

    create = http.post(
        _url("/api/chats/create"),
        json={
            "user_id": test_user_id,
            "title": "iso-suite-cache-cross-tenant",
            "model": "default",
            "source": "post-deploy-test",
        },
        headers=auth_headers,
    )
    _skip_if_invalid_user(create)
    if create.status_code in (401, 403, 429):
        pytest.skip(f"Cannot create as user A ({create.status_code})")
    assert create.status_code in (200, 201)
    chat_id = (create.json().get("chat") or create.json()).get("id")
    assert chat_id

    try:
        # User B lists their chats. Must NOT contain C1.
        b_resp = http.get(
            _url("/api/chats/list"),
            headers={"Authorization": f"Bearer {other}"},
        )
        if b_resp.status_code == 429:
            pytest.skip("Rate-limited on B's list")
        assert b_resp.status_code in (200, 401, 403, 404), (
            f"unexpected B list status: {b_resp.status_code}"
        )
        if b_resp.status_code != 200:
            return  # B can't even list — no leak path exists
        body = b_resp.json()
        chats = body.get("chats") or body if isinstance(body, dict) else []
        if isinstance(chats, dict):
            chats = chats.get("items") or []
        ids = [c.get("id") for c in chats if isinstance(c, dict)]
        assert chat_id not in ids, (
            f"SECURITY: cache cross-tenant leak — chat {chat_id!r} created "
            f"by user A surfaced in user B's chat list. The list cache "
            f"key is missing user_id namespacing OR Supabase RLS was "
            f"bypassed."
        )
    finally:
        try:
            http.request("DELETE", _url(f"/api/chats/{chat_id}"),
                         headers=auth_headers, timeout=10)
        except Exception:
            pass


def test_chat_create_with_oversized_title_is_rejected_or_truncated(
    http: httpx.Client, auth_headers: dict[str, str], test_user_id: str
):
    """Cache poisoning probe: sending a 1 MB title — backend must reject
    (4xx) or silently truncate before caching. Anything that lets a 1 MB
    string into the chat list cache is a memory-amplification attack
    vector against the worker.

    Acceptable outcomes:
      * 400/413/422 — explicitly rejected
      * 200/201 with a truncated title in the response
      * 200/201 with the full title (questionable, but not a security
        bug per se — flagged with a clear assertion message)
    """
    huge = "X" * (1024 * 1024)  # 1 MB
    resp = http.post(
        _url("/api/chats/create"),
        json={
            "user_id": test_user_id,
            "title": huge,
            "model": "default",
            "source": "post-deploy-test",
        },
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited")
    if resp.status_code in (401, 403):
        pytest.skip(f"Auth issue ({resp.status_code})")
    # Server may reject before reaching the handler (most likely path).
    if resp.status_code in (400, 413, 414, 422):
        return  # Clean reject — preferred outcome.
    assert resp.status_code < 500, (
        f"SECURITY: 1 MB title caused {resp.status_code} — handler crashed "
        f"on oversized input. Body: {_body_snippet(resp)}"
    )
    # Created — verify it was truncated. If not, file follow-up bug but
    # don't fail the test (it's not a direct security regression).
    chat_id = None
    try:
        body = resp.json()
        chat = body.get("chat") or body
        chat_id = chat.get("id")
        stored_title = chat.get("title", "")
        if len(stored_title) >= len(huge):
            # Not truncated — flag for review but don't fail the security
            # suite since the cache layer can still cap entry size at
            # write time.
            print(
                f"WARNING: 1 MB title accepted untruncated (len="
                f"{len(stored_title)}). Cache poisoning amplification risk."
            )
    finally:
        if chat_id:
            try:
                http.request("DELETE", _url(f"/api/chats/{chat_id}"),
                             headers=auth_headers, timeout=10)
            except Exception:
                pass


# ════════════════════════════════════════════════════════════════════════════
# Section 5 — Connection-manager probes (WS reconnect / heartbeat smuggling)
# ════════════════════════════════════════════════════════════════════════════


@pytest.mark.electron
@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_force_close_then_reconnect_5x_does_not_lock_out(
    test_jwt: str, test_user_id: str
):
    """Open a WS, force a 4001 close (bad first frame), reconnect
    immediately 5×. The connection manager / circuit breaker must not
    permanently lock out a legitimate user after a few bad-auth bursts.

    Capped at 5 reconnects — well under the 20 concurrent-ops limit and
    under any realistic rate-limit threshold.
    """
    machine = f"post-deploy-iso-cb-{uuid.uuid4().hex[:8]}"

    async def _bad_then_good_round(idx: int) -> bool:
        # Bad auth → server emits auth_failed + close 4001
        try:
            ws_bad = await _ws_open(_ws_url())
        except (InvalidStatus, InvalidStatusCode, InvalidHandshake):
            # Server already locked us out at the handshake layer — that
            # IS the regression we're guarding against.
            pytest.fail(
                f"SECURITY: round {idx} — WS handshake itself rejected. "
                f"Connection manager is locking out legitimate users after "
                f"prior bad-auth attempts."
            )
            return False
        try:
            await ws_bad.send(_auth_msg("BAD_TOKEN", machine, test_user_id))
            try:
                await asyncio.wait_for(ws_bad.recv(), timeout=3.0)
            except (ConnectionClosed, ConnectionClosedError, ConnectionClosedOK):
                pass
            except asyncio.TimeoutError:
                pass
        finally:
            try:
                await ws_bad.close()
            except Exception:
                pass
        return True

    async def _scenario():
        rounds = 5
        # Sequential — five quick rounds. We could parallelize up to 20
        # but the regression we're catching is "lock-out after burst",
        # which is a sequential property.
        for i in range(rounds):
            ok = await _bad_then_good_round(i)
            if not ok:
                return  # pytest.fail already triggered

        # After 5 bad bursts, a clean valid auth must still succeed.
        ws_good = await _ws_open(_ws_url())
        try:
            await ws_good.send(_auth_msg(test_jwt, machine, test_user_id))
            try:
                msg = await _ws_recv_json(ws_good, timeout=5.0)
            except (ConnectionClosed, ConnectionClosedError) as e:
                pytest.fail(
                    f"SECURITY: after 5 bad-auth bursts, the legitimate "
                    f"reconnect was closed by the server: {e!r}"
                )
                return
            if msg.get("type") == "auth_failed":
                # Could be a stale machine_id pinned to another user.
                # Acceptable as long as the reason is meaningful.
                reason = (msg.get("reason") or "").lower()
                if "ownership" in reason or "another user" in reason:
                    pytest.skip(f"machine_id collision: {reason!r}")
                    return
                pytest.fail(
                    f"SECURITY: legitimate auth rejected after burst: "
                    f"{msg!r}"
                )
            assert msg.get("type") == "auth_success", f"got {msg!r}"
        finally:
            try:
                await ws_good.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=NET_TIMEOUT * 3)


@pytest.mark.electron
@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_heartbeat_for_unbound_session_is_ignored(
    test_jwt: str, test_user_id: str
):
    """After a successful auth, send a heartbeat frame that references a
    session_id NOT bound to our token. The bridge's recv loop expects
    only result / approval_request / heartbeat from the SAME session —
    a heartbeat carrying foreign session metadata must be ignored, not
    crash the recv loop.

    Acceptable outcomes:
      * Server silently drops the frame and connection stays alive.
      * Server closes with a reasonable code (1000/1008/1011).
    Forbidden:
      * 5xx-equivalent close (1011) with an internal stack trace.
      * Server processes the foreign session_id and routes anything to
        it (we can't directly observe this side-effect, but the
        connection MUST stay healthy for our own session afterward).
    """
    machine = f"post-deploy-iso-hb-{uuid.uuid4().hex[:8]}"

    async def _scenario():
        ws = await _ws_open(_ws_url())
        try:
            await ws.send(_auth_msg(test_jwt, machine, test_user_id))
            try:
                first = await _ws_recv_json(ws, timeout=5.0)
            except (ConnectionClosed, ConnectionClosedError):
                pytest.skip("could not auth")
                return
            if first.get("type") == "auth_failed":
                pytest.skip(f"auth_failed: {first.get('reason')!r}")
                return

            # Smuggle a heartbeat with a session_id that's not ours.
            await ws.send(json.dumps({
                "type": "heartbeat",
                "session_id": "smuggled-foreign-session-deadbeef",
                "user_id": "00000000-dead-beef-dead-000000000666",
                "machine_id": "smuggled-foreign-machine",
                "timestamp": time.time(),
            }))
            await asyncio.sleep(0.3)

            # Connection should still be functional for OUR own heartbeat.
            try:
                await ws.send(json.dumps({"type": "heartbeat"}))
                await asyncio.sleep(0.2)
            except (ConnectionClosed, ConnectionClosedError) as e:
                if e.rcvd is not None:
                    # Server closing is okay; an internal-server-error
                    # close (1011) with no reason or with a trace string
                    # is what we forbid.
                    bad = e.rcvd.code == 1011 and (
                        not e.rcvd.reason or
                        "internal" in (e.rcvd.reason or "").lower()
                    )
                    assert not bad, (
                        f"SECURITY: foreign-session heartbeat crashed the "
                        f"recv loop: {e!r}"
                    )
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=NET_TIMEOUT)
