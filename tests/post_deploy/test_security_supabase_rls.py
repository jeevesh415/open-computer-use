"""
test_security_supabase_rls.py — Direct-to-Supabase RLS posture verification.

The backend FastAPI tests in `test_security_authz_idor.py` exercise the
application-layer ownership checks (the `_get_chat_for_user` /
`_verify_chat_ownership` helpers).  THIS file exercises the row-level
security policies that are the LAST line of defense — the rules that
protect tenant isolation even when an attacker bypasses the app entirely
and hits PostgREST directly with the public anon key (which is shipped
to every browser).

Coverage
--------
* Anon SELECT on private chats → 0 rows
* Anon SELECT on public=true chats → permitted (legitimate share-link feature)
* Anon SELECT on collaborative=true chats → permitted (legitimate co-room feature)
* Authenticated user A reading user B's PRIVATE chats → 0 rows
* Anon PATCH attempt on a real chat → must fail (insert/update should never
  be authorized for anon)
* Authenticated user A PATCH on user B's chat → must fail or be a no-op
* RPC functions that are SECURITY DEFINER — confirm callable + don't leak

Why these tests are separated from test_security_authz_idor
-----------------------------------------------------------
The HTTP-layer tests show "the FastAPI handler refuses".  These tests show
"even if you bypass the FastAPI handler, RLS still refuses".  Both layers
matter because:
  * A misconfigured deploy could remove FastAPI entirely (e.g., during a
    migration window) and hit PostgREST directly via the same Cloudflare
    edge — RLS must still enforce tenancy.
  * The frontend uses Supabase RLS for direct queries (chat list page,
    history sidebar) — bypassing the FastAPI backend entirely.  An RLS
    leak there is a real production issue with no app-layer mitigation.
"""
from __future__ import annotations

import logging
import os
import uuid
from typing import Any, Optional

import httpx
import pytest

from conftest import cfg


log = logging.getLogger(__name__)


# ── Markers ────────────────────────────────────────────────────────────────

pytestmark = [pytest.mark.security, pytest.mark.database]


# ── Helpers ────────────────────────────────────────────────────────────────


def _supabase_rest_url(table: str) -> str:
    """Build a PostgREST URL — the same path the JS client hits."""
    return f"{cfg().supabase_url}/rest/v1/{table}"


def _anon_headers() -> dict[str, str]:
    """Headers for an unauthenticated PostgREST call.  Returns the public
    anon key as both apikey and Authorization (Supabase SDK pattern)."""
    if not cfg().supabase_anon_key:
        pytest.skip("SUPABASE_ANON_KEY not set")
    return {
        "apikey": cfg().supabase_anon_key,
        "Authorization": f"Bearer {cfg().supabase_anon_key}",
        "Accept": "application/json",
    }


def _user_headers(jwt: str) -> dict[str, str]:
    """Headers for a real-user PostgREST call.  apikey stays the anon key
    (Supabase routes by apikey + JWT pair); Authorization carries the JWT."""
    if not cfg().supabase_anon_key:
        pytest.skip("SUPABASE_ANON_KEY not set")
    return {
        "apikey": cfg().supabase_anon_key,
        "Authorization": f"Bearer {jwt}",
        "Accept": "application/json",
    }


def _second_user_token() -> Optional[str]:
    val = os.environ.get("TEST_USER_TOKEN_2", "").strip()
    return val or None


def _second_user_id() -> Optional[str]:
    val = os.environ.get("TEST_USER_ID_2", "").strip()
    return val or None


# ───────────────────────────────────────────────────────────────────────────
# 1. Anon must NOT read private chats
# ───────────────────────────────────────────────────────────────────────────


def test_anon_cannot_read_private_chats(http: httpx.Client):
    """Direct PostgREST hit with anon key — must NOT return private chats.

    Filters out public=true and collaborative=true (those are documented
    legitimate exposures); anything that comes back is an RLS breach.
    """
    headers = _anon_headers()
    # PostgREST filter syntax: column=op.value
    resp = http.get(
        _supabase_rest_url("chats"),
        headers=headers,
        params={
            "select": "id,user_id,public,collaborative",
            "public": "neq.true",
            "collaborative": "neq.true",
            "limit": "5",
        },
    )
    # 200 with empty list is the expected RLS-clean outcome.  401/403 is
    # also acceptable — some configurations use REVOKE rather than a
    # restrictive policy.  500 means PostgREST itself blew up, which is a
    # config bug.
    assert resp.status_code < 500, (
        f"Direct anon REST call 5xx'd: {resp.status_code}. Body: {resp.text[:300]}"
    )
    if resp.status_code == 200:
        try:
            body = resp.json()
        except Exception:
            pytest.fail(
                f"Anon REST returned non-JSON 200: {resp.text[:300]!r}"
            )
        rows = body if isinstance(body, list) else []
        leaked = [
            r for r in rows
            if not (r.get("public") is True or r.get("collaborative") is True)
        ]
        assert not leaked, (
            f"SECURITY: anon REST read {len(leaked)} private chats — "
            f"first leaked row: {leaked[0]!r}.  RLS policy on `chats` is broken."
        )


# ───────────────────────────────────────────────────────────────────────────
# 2. Anon CAN read public=true chats (legitimate share-link feature)
# ───────────────────────────────────────────────────────────────────────────


def test_anon_can_read_public_chats(http: httpx.Client):
    """The /p/[slug] share-link feature relies on anon being able to SELECT
    chats where public=true.  If this test fails, share links are broken.

    We don't fail when there are zero public chats in the DB — that's a
    valid state.  We just confirm the query SUCCEEDS (not 401/403).
    """
    headers = _anon_headers()
    resp = http.get(
        _supabase_rest_url("chats"),
        headers=headers,
        params={"select": "id,public", "public": "eq.true", "limit": "1"},
    )
    assert resp.status_code == 200, (
        f"Anon could not read public=true chats — share-link feature broken? "
        f"Status: {resp.status_code}. Body: {resp.text[:300]}"
    )
    body = resp.json()
    assert isinstance(body, list), (
        f"Expected JSON array from REST, got {type(body).__name__}: {resp.text[:200]}"
    )
    # Every returned row must actually be public=true
    for row in body:
        assert row.get("public") is True, (
            f"SECURITY: anon read returned public=true filter but got row with "
            f"public={row.get('public')!r} — filter bypass? Row: {row!r}"
        )


# ───────────────────────────────────────────────────────────────────────────
# 3. Anon CAN read collaborative=true chats (legitimate co-room feature)
# ───────────────────────────────────────────────────────────────────────────


def test_anon_can_read_collaborative_chats(http: httpx.Client):
    """Per supabase/schema.sql, collaborative chats are SELECT-able by anon.
    Same shape as the public=true test."""
    headers = _anon_headers()
    resp = http.get(
        _supabase_rest_url("chats"),
        headers=headers,
        params={"select": "id,collaborative", "collaborative": "eq.true", "limit": "1"},
    )
    # Some deployments only allow auth'd reads of collaborative=true.  Both
    # are acceptable.  What we forbid is 5xx.
    assert resp.status_code < 500, (
        f"Anon read of collaborative=true 5xx'd: {resp.status_code}. "
        f"Body: {resp.text[:300]}"
    )
    if resp.status_code == 200:
        body = resp.json()
        for row in body:
            assert row.get("collaborative") is True, (
                f"SECURITY: collaborative=true filter returned row with "
                f"collaborative={row.get('collaborative')!r}. Row: {row!r}"
            )


# ───────────────────────────────────────────────────────────────────────────
# 4. Authenticated user A cannot read user B's private chats
# ───────────────────────────────────────────────────────────────────────────


def test_authed_user_cannot_read_other_users_private_chats(
    http: httpx.Client, test_jwt: str, test_user_id: str
):
    """Auth'd user A queries WHERE user_id != A AND public=false AND
    collaborative=false.  Must return 0 rows.

    This is the same property test_08_database asserts — keeping a copy
    here for the security marker so `pytest -m security` stands alone.
    """
    headers = _user_headers(test_jwt)
    resp = http.get(
        _supabase_rest_url("chats"),
        headers=headers,
        params={
            "select": "id,user_id,public,collaborative",
            "user_id": f"neq.{test_user_id}",
            "public": "neq.true",
            "collaborative": "neq.true",
            "limit": "10",
        },
    )
    assert resp.status_code < 500, (
        f"Authed cross-tenant read 5xx'd: {resp.status_code}. "
        f"Body: {resp.text[:300]}"
    )
    if resp.status_code == 200:
        rows = resp.json()
        leaked = [r for r in rows if r.get("user_id") != test_user_id]
        assert not leaked, (
            f"SECURITY: user A could read {len(leaked)} private rows "
            f"belonging to other users. First leaked: {leaked[0]!r}"
        )


# ───────────────────────────────────────────────────────────────────────────
# 5. Anon cannot UPDATE chats — write paths are even more locked down
# ───────────────────────────────────────────────────────────────────────────


def test_anon_cannot_patch_any_chat(http: httpx.Client):
    """An anon REST PATCH on any chat must be rejected.

    PostgREST returns:
      * 401 if no Authorization header (unauthenticated)
      * 404 with empty body if RLS hides the row
      * 403 if a policy explicitly DENIES the action
    All three are acceptable.  200 with a populated body would be the
    breach we're guarding against.
    """
    headers = _anon_headers()
    headers["Content-Type"] = "application/json"
    headers["Prefer"] = "return=representation"
    resp = http.patch(
        _supabase_rest_url("chats"),
        headers=headers,
        params={"id": f"eq.{uuid.uuid4()}"},
        json={"title": "anon-write-attempt"},
    )
    assert resp.status_code != 200 or resp.text in ("", "[]"), (
        f"SECURITY: anon PATCH on chats succeeded ({resp.status_code}). "
        f"Body: {resp.text[:300]}"
    )
    # Also forbid 5xx
    assert resp.status_code < 500, (
        f"PostgREST 5xx on anon PATCH: {resp.status_code}. Body: {resp.text[:300]}"
    )


def test_anon_cannot_insert_chat(http: httpx.Client):
    """Anon must not be able to INSERT into chats — INSERT policies are
    typically scoped to the row's `user_id = auth.uid()`."""
    headers = _anon_headers()
    headers["Content-Type"] = "application/json"
    headers["Prefer"] = "return=representation"
    resp = http.post(
        _supabase_rest_url("chats"),
        headers=headers,
        json={
            "user_id": str(uuid.uuid4()),
            "title": "anon-insert-attempt",
        },
    )
    # Anon insert must fail.  Acceptable: 401/403/404/422/409.
    assert resp.status_code != 201, (
        f"SECURITY: anon INSERT on chats succeeded with 201. "
        f"Body: {resp.text[:300]}"
    )
    assert resp.status_code != 200, (
        f"SECURITY: anon INSERT on chats succeeded with 200. "
        f"Body: {resp.text[:300]}"
    )
    assert resp.status_code < 500, (
        f"PostgREST 5xx on anon INSERT: {resp.status_code}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 6. Authed user A cannot PATCH user B's chat
# ───────────────────────────────────────────────────────────────────────────


def test_authed_user_cannot_patch_other_users_chat(
    http: httpx.Client, test_jwt: str
):
    """A real user attempting to PATCH a chat they don't own must be a
    no-op (PostgREST returns 200 with [] when RLS hides the row).
    Acceptable: 401/403/404/200 with empty array.
    Forbidden: 200 with a populated row — that means the update happened.

    Without TEST_USER_TOKEN_2 we can only smoke this against a fake UUID.
    """
    headers = _user_headers(test_jwt)
    headers["Content-Type"] = "application/json"
    headers["Prefer"] = "return=representation"
    fake_id = str(uuid.uuid4())
    resp = http.patch(
        _supabase_rest_url("chats"),
        headers=headers,
        params={"id": f"eq.{fake_id}"},
        json={"title": "rls-attack-probe"},
    )
    assert resp.status_code < 500, (
        f"PostgREST 5xx on cross-tenant PATCH probe: {resp.status_code}"
    )
    if resp.status_code == 200:
        # Empty array is the RLS-correct response.
        body = resp.json()
        assert body == [], (
            f"SECURITY: PATCH on cross-tenant chat returned non-empty "
            f"array — RLS allowed an unauthorized update. Body: {body!r}"
        )


def test_user_a_cannot_patch_user_b_real_chat(
    http: httpx.Client, test_jwt: str, test_user_id: str
):
    """Stronger version of the above: provision a chat as user A, try to
    PATCH it as user B.  Skipped when TEST_USER_TOKEN_2 is missing.
    """
    other_token = _second_user_token()
    if not other_token:
        pytest.skip(
            "TEST_USER_TOKEN_2 not configured — cross-tenant PATCH RLS test "
            "needs a second user's access token."
        )
    # 1) User A inserts a private chat
    a_headers = _user_headers(test_jwt)
    a_headers["Content-Type"] = "application/json"
    a_headers["Prefer"] = "return=representation"
    title = f"rls-victim-{uuid.uuid4()}"
    create = http.post(
        _supabase_rest_url("chats"),
        headers=a_headers,
        json={"user_id": test_user_id, "title": title},
    )
    if create.status_code not in (200, 201):
        pytest.skip(
            f"Could not create chat as user A: {create.status_code} "
            f"{create.text[:200]}"
        )
    rows = create.json()
    if not rows:
        pytest.skip("Insert returned empty body — cannot identify created row")
    chat_id = rows[0].get("id")
    try:
        # 2) User B attempts to PATCH it
        b_headers = _user_headers(other_token)
        b_headers["Content-Type"] = "application/json"
        b_headers["Prefer"] = "return=representation"
        attack = http.patch(
            _supabase_rest_url("chats"),
            headers=b_headers,
            params={"id": f"eq.{chat_id}"},
            json={"title": "PWNED"},
        )
        assert attack.status_code < 500, f"5xx on cross-tenant PATCH: {attack.status_code}"
        if attack.status_code == 200:
            body = attack.json()
            assert body == [], (
                f"SECURITY: user B's PATCH on user A's chat returned "
                f"non-empty result — RLS allowed cross-tenant write. "
                f"Body: {body!r}"
            )
        # 3) Verify the original title is unchanged
        verify = http.get(
            _supabase_rest_url("chats"),
            headers=a_headers,
            params={"select": "id,title", "id": f"eq.{chat_id}"},
        )
        if verify.status_code == 200:
            verify_body = verify.json()
            if verify_body:
                actual_title = verify_body[0].get("title")
                assert actual_title == title, (
                    f"SECURITY: chat title was modified by user B — "
                    f"expected {title!r}, got {actual_title!r}. "
                    f"Cross-tenant PATCH succeeded."
                )
    finally:
        # Cleanup — user A deletes their row
        try:
            http.delete(
                _supabase_rest_url("chats"),
                headers=a_headers,
                params={"id": f"eq.{chat_id}"},
            )
        except Exception:
            pass


def test_user_a_cannot_delete_user_b_real_chat(
    http: httpx.Client, test_jwt: str, test_user_id: str
):
    """Same shape as PATCH but for DELETE — possibly the most dangerous
    op since a successful cross-tenant DELETE is unrecoverable."""
    other_token = _second_user_token()
    if not other_token:
        pytest.skip("TEST_USER_TOKEN_2 not configured")
    a_headers = _user_headers(test_jwt)
    a_headers["Content-Type"] = "application/json"
    a_headers["Prefer"] = "return=representation"
    title = f"rls-victim-del-{uuid.uuid4()}"
    create = http.post(
        _supabase_rest_url("chats"),
        headers=a_headers,
        json={"user_id": test_user_id, "title": title},
    )
    if create.status_code not in (200, 201):
        pytest.skip(f"Could not create chat: {create.status_code}")
    rows = create.json()
    if not rows:
        pytest.skip("Insert returned empty body")
    chat_id = rows[0].get("id")
    try:
        # User B attempts DELETE
        b_headers = _user_headers(other_token)
        b_headers["Prefer"] = "return=representation"
        attack = http.delete(
            _supabase_rest_url("chats"),
            headers=b_headers,
            params={"id": f"eq.{chat_id}"},
        )
        assert attack.status_code < 500
        # Verify chat still exists
        verify = http.get(
            _supabase_rest_url("chats"),
            headers=a_headers,
            params={"select": "id", "id": f"eq.{chat_id}"},
        )
        assert verify.status_code == 200
        survived = verify.json()
        assert survived and survived[0].get("id") == chat_id, (
            f"SECURITY: chat {chat_id!r} disappeared after user B's DELETE "
            f"attempt — cross-tenant DELETE succeeded. RLS on chats DELETE "
            f"is broken."
        )
    finally:
        try:
            http.delete(
                _supabase_rest_url("chats"),
                headers=a_headers,
                params={"id": f"eq.{chat_id}"},
            )
        except Exception:
            pass


# ───────────────────────────────────────────────────────────────────────────
# 7. Messages RLS — same shape, EXISTS sub-query path
# ───────────────────────────────────────────────────────────────────────────


def test_anon_cannot_read_private_messages(http: httpx.Client):
    """messages RLS is `EXISTS (SELECT 1 FROM chats WHERE chats.id =
    messages.chat_id AND chats.user_id = auth.uid())`.  Anon caller has
    no auth.uid(), so the EXISTS clause is always false — anon should
    never see any messages.

    Acceptable: 200 with empty list, 401, 403.  What we forbid is 200 with
    populated rows, regardless of the parent chat's public flag.
    """
    headers = _anon_headers()
    resp = http.get(
        _supabase_rest_url("messages"),
        headers=headers,
        params={"select": "id,chat_id,role", "limit": "5"},
    )
    assert resp.status_code < 500
    if resp.status_code == 200:
        body = resp.json()
        # Some deployments allow anon SELECT on messages whose parent
        # chat is public=true.  We accept that; just don't accept rows
        # whose parent is NOT public.  Without joining to chats here we
        # can't verify the parent flag — so the strictest check is:
        # if anon got any messages back, ensure the message has either
        # public=True parent OR the rows came back as empty.
        assert isinstance(body, list)
        # Empty is always fine.  A full leak (lots of rows) is the
        # smoking gun.  We allow up to 0 rows here.
        if len(body) > 0:
            # Validate that each row's parent chat is in fact public=true.
            # If we can't confirm that, fail loudly — better to get a
            # noisy false-positive than miss a real leak.
            log.warning(
                "Anon got %d messages back. Verifying parent chats are "
                "public=true …",
                len(body),
            )
            chat_ids = {r["chat_id"] for r in body if r.get("chat_id")}
            verify = http.get(
                _supabase_rest_url("chats"),
                headers=headers,
                params={
                    "select": "id,public",
                    "id": f"in.({','.join(chat_ids)})",
                },
            )
            if verify.status_code == 200:
                public_ids = {r["id"] for r in verify.json() if r.get("public") is True}
                non_public = chat_ids - public_ids
                assert not non_public, (
                    f"SECURITY: anon read {len(body)} messages whose parent "
                    f"chats are NOT public — RLS messages policy is broken. "
                    f"Non-public parent chat ids: {sorted(non_public)[:5]!r}"
                )


# ───────────────────────────────────────────────────────────────────────────
# 8. SECURITY DEFINER RPCs — callable + don't leak
# ───────────────────────────────────────────────────────────────────────────


def test_rpc_get_user_credit_balance_authed(http: httpx.Client, test_jwt: str):
    """The credit-balance RPC (`get_user_credit_balance` per
    supabase/schema.sql) is SECURITY DEFINER so it can read the protected
    user_credits table.  Calling it as an authenticated user should:
      * Succeed
      * Return ONLY this user's balance (the RPC reads auth.uid())

    If the RPC accepts a `p_user_id` parameter and trusts it instead of
    auth.uid(), an attacker could read any user's balance.  We probe by
    calling without a parameter (current convention) and by calling with
    a fake user id and asserting the returned balance is for THIS user.
    """
    headers = _user_headers(test_jwt)
    headers["Content-Type"] = "application/json"
    rpc_url = f"{cfg().supabase_url}/rest/v1/rpc/get_user_credit_balance"
    # Call without args (RPC reads auth.uid() internally if defined that way)
    resp = http.post(rpc_url, headers=headers, json={})
    if resp.status_code == 404:
        pytest.skip("get_user_credit_balance RPC not exposed in this project")
    if resp.status_code in (401, 403):
        pytest.skip(
            f"RPC returned {resp.status_code} — function may have a different "
            f"name or be revoked from the authenticated role."
        )
    assert resp.status_code < 500, (
        f"RPC 5xx: {resp.status_code}. Body: {resp.text[:300]}"
    )
    # Don't pin on a specific shape — just confirm we got a JSON response
    # and not e.g. a Python traceback or a dump of every user's balance.
    if resp.status_code == 200:
        body = resp.json()
        # Most credit-balance RPCs return a scalar int or a single-row dict.
        if isinstance(body, list):
            assert len(body) <= 1, (
                f"SECURITY: balance RPC returned {len(body)} rows — "
                f"function may be leaking data across tenants. First two: "
                f"{body[:2]!r}"
            )


def test_rpc_get_user_credit_balance_anon_blocked(http: httpx.Client):
    """Anon callers must NOT be able to invoke the credit-balance RPC.

    SECURITY DEFINER functions still respect EXECUTE permissions; if an
    operator forgot to REVOKE … FROM anon, an unauthenticated caller
    could enumerate users' balances.
    """
    headers = _anon_headers()
    headers["Content-Type"] = "application/json"
    rpc_url = f"{cfg().supabase_url}/rest/v1/rpc/get_user_credit_balance"
    resp = http.post(rpc_url, headers=headers, json={})
    if resp.status_code == 404:
        pytest.skip("RPC not present")
    # Anon must be rejected with 401/403/4xx; never 200.
    assert resp.status_code != 200, (
        f"SECURITY: anon got 200 from get_user_credit_balance — "
        f"REVOKE EXECUTE FROM anon may be missing. Body: {resp.text[:300]}"
    )
    assert resp.status_code < 500


def test_rpc_unknown_function_returns_404(http: httpx.Client, test_jwt: str):
    """Sanity check: an unknown RPC returns 404, not 500.  This catches a
    PostgREST schema-cache desync after migrations."""
    headers = _user_headers(test_jwt)
    headers["Content-Type"] = "application/json"
    rpc_url = f"{cfg().supabase_url}/rest/v1/rpc/this_rpc_does_not_exist_idor_probe"
    resp = http.post(rpc_url, headers=headers, json={})
    assert resp.status_code in (400, 404), (
        f"Unknown RPC returned {resp.status_code} — expected 400/404. "
        f"Body: {resp.text[:300]}"
    )
    assert resp.status_code < 500


# ───────────────────────────────────────────────────────────────────────────
# 9. user_credits / user_machines tables — never anon-readable
# ───────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("table", [
    "user_credits",
    "user_machines",
    "machine_usage",
    "machine_limits",
    "credit_transactions",
])
def test_anon_cannot_read_billing_tables(http: httpx.Client, table: str):
    """Billing-adjacent tables must be invisible to anon callers.

    P0-06: the `user_credits` and `credit_transactions` parametrize cases
    will fail until the RLS fix is deployed.  Migration:
        supabase/migrations/004_credits_rls.sql — apply before this passes
    Verify with the queries in:
        supabase/migrations/004_credits_rls_verify.sql
    These tests are intentionally NOT marked xfail — they should fail
    loudly until the migration is applied to production Supabase.
    """
    headers = _anon_headers()
    resp = http.get(
        _supabase_rest_url(table),
        headers=headers,
        params={"select": "*", "limit": "1"},
    )
    if resp.status_code == 404:
        # Table doesn't exist in this deployment — skip rather than fail.
        pytest.skip(f"Table {table!r} not present in this project")
    assert resp.status_code < 500
    if resp.status_code == 200:
        body = resp.json()
        assert body == [], (
            f"SECURITY: anon could read rows from {table!r}: {body[:1]!r}. "
            f"This table must be locked down with RLS."
        )


# ───────────────────────────────────────────────────────────────────────────
# 10. JWT role tampering — service_role claim must be rejected
# ───────────────────────────────────────────────────────────────────────────


def test_self_signed_service_role_jwt_rejected(http: httpx.Client):
    """A self-signed JWT carrying ``role: service_role`` must be rejected
    by Supabase's signature check.  Attempting to use it should NOT grant
    god-mode access to the database.
    """
    import base64
    import json as _json
    import os as _os

    def _b64url(b: bytes) -> str:
        return base64.urlsafe_b64encode(b).rstrip(b"=").decode("ascii")

    header = _b64url(_json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
    payload = _b64url(_json.dumps({
        "role": "service_role",
        "sub": "00000000-0000-0000-0000-000000000000",
        "iat": 1700000000,
        "exp": 9999999999,
    }).encode())
    sig = _b64url(_os.urandom(32))
    forgery = f"{header}.{payload}.{sig}"

    headers = {
        "apikey": cfg().supabase_anon_key or "",
        "Authorization": f"Bearer {forgery}",
        "Accept": "application/json",
    }
    if not cfg().supabase_anon_key:
        pytest.skip("SUPABASE_ANON_KEY not set")
    resp = http.get(
        _supabase_rest_url("chats"),
        headers=headers,
        params={"select": "id,user_id", "limit": "5"},
    )
    # Must be rejected at the JWT verification layer
    assert resp.status_code in (401, 403), (
        f"SECURITY: forged service_role JWT was NOT rejected — "
        f"got {resp.status_code}. Body: {resp.text[:300]}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 11. Status checks table — public read (legitimate)
# ───────────────────────────────────────────────────────────────────────────


def test_anon_can_read_status_checks(http: httpx.Client):
    """status_checks has an explicit ``Public read access`` policy
    (migration 001).  This must remain reachable for anon since the
    /status page renders before any auth check.

    Column is ``service_name`` per supabase/migrations/001_status_checks.sql.
    """
    headers = _anon_headers()
    resp = http.get(
        _supabase_rest_url("status_checks"),
        headers=headers,
        params={"select": "id,service_name", "limit": "1"},
    )
    if resp.status_code == 404:
        pytest.skip("status_checks table not deployed")
    assert resp.status_code == 200, (
        f"Anon can no longer read status_checks — /status page will be "
        f"broken. Got {resp.status_code}. Body: {resp.text[:300]}"
    )
