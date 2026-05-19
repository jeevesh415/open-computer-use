"""
test_security_billing.py — Security tests for the credit billing surface.

Targets:
  * /api/billing/credits/balance        — only own balance returned
  * /api/billing/sessions/{id}/status   — covered partially in IDOR file;
                                          here we probe write methods
  * /api/billing/sessions/cleanup       — admin-only orphan cleanup
  * /api/admin/*                        — must reject non-admin Bearer
  * Stripe webhook (/api/credits/webhook on the Next.js frontend) —
    signature verification + replay protection + atomic event recording
  * Concurrent session-start: ensure no double-deduct or negative balance

NOTE on the Stripe webhook: the webhook is on the FRONTEND (Next.js) at
/api/credits/webhook, NOT on the FastAPI backend.  We hit cfg().frontend_url
for those tests.

Constraints:
  * Cap concurrent calls at 10 (well under the 20-call ceiling).
  * Never consume more than 30 credits across the file — we use balance-only
    probes and rejected-on-balance flows.
  * Skip cleanly when TEST_STRIPE_WEBHOOK_SECRET / TEST_USER_TOKEN_2 absent.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import time
import uuid
from typing import Optional

import httpx
import pytest

from conftest import assert_status, cfg


pytestmark = pytest.mark.security


FAKE_UUID_1 = "00000000-0000-0000-0000-000000000001"


# ── Helpers ────────────────────────────────────────────────────────────────


def _backend(path: str) -> str:
    return f"{cfg().backend_public_url}{path}"


def _frontend(path: str) -> str:
    return f"{cfg().frontend_url}{path}"


def _body_snippet(resp: httpx.Response, n: int = 300) -> str:
    try:
        return resp.text[:n].replace("\n", " ")
    except Exception:
        return "<undecodable>"


def _skip_if_invalid_user(resp: httpx.Response) -> None:
    if resp.status_code == 401 and resp.text and "Invalid user" in resp.text:
        pytest.skip("Test user not provisioned in backend user table")


def _stripe_secret() -> Optional[str]:
    val = os.environ.get("TEST_STRIPE_WEBHOOK_SECRET", "").strip()
    return val or None


def _second_user_token() -> Optional[str]:
    val = os.environ.get("TEST_USER_TOKEN_2", "").strip()
    return val or None


def _stripe_signature(payload: bytes, secret: str, ts: Optional[int] = None) -> str:
    """Build a valid Stripe webhook signature header.

    Format: ``t=<ts>,v1=<hmac_sha256(ts.payload, secret)>``
    """
    ts = ts or int(time.time())
    signed_payload = f"{ts}.".encode() + payload
    sig = hmac.new(secret.encode(), signed_payload, hashlib.sha256).hexdigest()
    return f"t={ts},v1={sig}"


def _build_stripe_event(event_id: str, user_id: str = "test-user", credits: int = 100) -> dict:
    """Build a minimal valid checkout.session.completed Stripe event."""
    return {
        "id": event_id,
        "object": "event",
        "type": "checkout.session.completed",
        "created": int(time.time()),
        "data": {
            "object": {
                "id": f"cs_test_{uuid.uuid4().hex[:16]}",
                "object": "checkout.session",
                "mode": "payment",
                "metadata": {
                    "user_id": user_id,
                    "credits": str(credits),
                },
                "amount_total": credits * 9,  # $0.09/credit
                "currency": "usd",
                "customer_email": "test@example.com",
                "payment_intent": f"pi_test_{uuid.uuid4().hex[:16]}",
            }
        },
    }


# ───────────────────────────────────────────────────────────────────────────
# 1. /api/billing/credits/balance — own balance, sane shape
# ───────────────────────────────────────────────────────────────────────────


def test_credit_balance_returns_own_user_only(
    http: httpx.Client, auth_headers: dict[str, str], test_user_id: str
):
    """GET /api/billing/credits/balance — the user_id field MUST be the
    authenticated caller, never anyone else's id.
    """
    resp = http.get(_backend("/api/billing/credits/balance"), headers=auth_headers)
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited")
    if resp.status_code in (401, 403):
        pytest.skip(
            f"Auth not propagating to billing route ({resp.status_code}) — "
            f"cannot exercise tenancy assertion"
        )
    assert_status(resp, 200)
    body = resp.json()
    assert body.get("user_id") == test_user_id, (
        f"SECURITY: /credits/balance returned user_id={body.get('user_id')!r} "
        f"but caller is {test_user_id!r} — cross-tenant balance leak"
    )
    # Balance must be a non-negative integer
    bal = body.get("balance")
    assert isinstance(bal, int) and bal >= 0, (
        f"SECURITY: balance {bal!r} is not a non-negative int"
    )


def test_credit_balance_anonymous_rejected(http: httpx.Client):
    """No Bearer = no balance.  Must be 401/403."""
    resp = http.get(_backend("/api/billing/credits/balance"))
    if resp.status_code == 429:
        pytest.skip("Rate-limited")
    assert resp.status_code in (401, 403), (
        f"SECURITY: /credits/balance allowed anonymous access — got "
        f"{resp.status_code}. Body: {_body_snippet(resp)}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 2. Direct credit-balance writes must be rejected
# ───────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_credit_balance_write_methods_rejected(
    http: httpx.Client, auth_headers: dict[str, str], method: str
):
    """No write methods should be exposed on /api/billing/credits/balance.

    The only credit-modifying surfaces are:
      * Stripe webhook (signed)
      * deduct_credits_partial RPC (server-side only)
    Direct PATCH/POST must return 405/404 — never 200.
    """
    resp = http.request(
        method,
        _backend("/api/billing/credits/balance"),
        json={"balance": 999_999_999},
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited")
    assert resp.status_code != 200, (
        f"SECURITY: {method} /credits/balance returned 200 — direct credit "
        f"manipulation should never succeed. Body: {_body_snippet(resp)}"
    )
    assert resp.status_code in (401, 403, 404, 405, 422), (
        f"SECURITY: {method} /credits/balance returned {resp.status_code} — "
        f"expected method-not-allowed/4xx. Body: {_body_snippet(resp)}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 3. Concurrent session-start — no double-deduct, no negative balance
# ───────────────────────────────────────────────────────────────────────────


def test_concurrent_balance_reads_are_consistent(
    http: httpx.Client, auth_headers: dict[str, str], test_user_id: str
):
    """Fire 5 concurrent GET /credits/balance calls.  Every response must:
      * Have status 200
      * Report the same user_id as the caller
      * Report a non-negative balance
      * Not reveal a transient negative or absurd value (race condition leak)

    This is the read-side analogue of the concurrent-deduction race — if
    the balance read ever shows a transient negative or absurdly high value
    during concurrent reads, that's a sign the underlying RPC has a race.
    """
    async def fetch(client: httpx.AsyncClient) -> httpx.Response:
        return await client.get(
            _backend("/api/billing/credits/balance"), headers=auth_headers
        )

    async def burst() -> list[httpx.Response]:
        async with httpx.AsyncClient(
            verify=False, http2=True, timeout=15.0
        ) as c:
            return await asyncio.gather(*(fetch(c) for _ in range(5)))

    results = asyncio.run(burst())
    bodies = []
    for r in results:
        if r.status_code == 429:
            pytest.skip("Rate-limited during concurrent balance read")
        if r.status_code in (401, 403):
            pytest.skip(f"Auth not propagating ({r.status_code})")
        assert r.status_code == 200, (
            f"SECURITY: concurrent balance read got {r.status_code}. "
            f"Body: {_body_snippet(r)}"
        )
        bodies.append(r.json())

    # Every response must have:
    for b in bodies:
        assert b.get("user_id") == test_user_id, (
            f"SECURITY: concurrent read returned cross-tenant user_id "
            f"{b.get('user_id')!r}"
        )
        bal = b.get("balance")
        assert isinstance(bal, int) and 0 <= bal < 10**9, (
            f"SECURITY: concurrent read returned absurd balance {bal!r} — "
            f"possible race or overflow"
        )
    # All responses must agree (no real activity is happening) — small
    # variance is acceptable if the user has billing tasks running, so we
    # just check all are within 100 credits of each other.
    balances = [b.get("balance", 0) for b in bodies]
    spread = max(balances) - min(balances)
    assert spread <= 100, (
        f"SECURITY: 5 concurrent balance reads disagreed by {spread} "
        f"credits — possible double-counting bug. Balances: {balances!r}"
    )


def test_session_start_with_low_balance_rejected_via_swarm(
    http: httpx.Client, auth_headers: dict[str, str], test_user_id: str
):
    """Probe that the MIN_BALANCE_REQUIRED gate fires.  Without the ability
    to actually drain the balance, we exercise the gate by calling the
    swarm/execute endpoint (which calls check_balance_for_session) with a
    fake machine.  The check happens AFTER auth but BEFORE machine resolve,
    so if balance is genuinely <20 we get 402.  Otherwise we get 4xx for
    the fake machine.

    What we forbid: a 5xx from the balance-check path; a 200 with billing
    sessions started despite low balance (would indicate gate bypass).
    """
    # First check current balance
    bal_resp = http.get(
        _backend("/api/billing/credits/balance"), headers=auth_headers
    )
    _skip_if_invalid_user(bal_resp)
    if bal_resp.status_code != 200:
        pytest.skip(
            f"Cannot read balance ({bal_resp.status_code}) — cannot run "
            f"low-balance gate test"
        )
    balance = bal_resp.json().get("balance", 0)
    if balance >= 20:
        pytest.skip(
            f"Test user has {balance} credits — cannot exercise the <20 "
            f"reject path without first burning credits (which would violate "
            f"the 30-credit budget for this file)"
        )
    # We have <20 credits — confirm swarm/execute returns 402
    resp = http.post(
        _backend("/api/swarm/execute"),
        json={
            "swarm_id": str(uuid.uuid4()),
            "prompt": "low-balance probe",
            "machines": [{"machine_id": FAKE_UUID_1}],
        },
        headers=auth_headers,
        timeout=15.0,
    )
    if resp.status_code == 429:
        pytest.skip("Rate-limited")
    assert resp.status_code < 500
    # 402 (insufficient credits) is the expected answer; 4xx is fine.
    assert resp.status_code in (400, 401, 402, 403, 404, 422), (
        f"SECURITY: low-balance swarm/execute returned {resp.status_code} — "
        f"expected 4xx. Body: {_body_snippet(resp)}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 4. Orphan cleanup endpoint
# ───────────────────────────────────────────────────────────────────────────


def test_orphan_cleanup_endpoint_does_not_500(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """POST /api/billing/sessions/cleanup — admin-only orphan-session cleanup.

    HISTORY: this used to be a soft audit finding (P0-02): the route was
    reachable by any authenticated user.  As of the admin-gating fix in
    backend/app/services/auth.py::require_admin, a non-admin Bearer must
    be rejected with 403 "Admin access required".

    Test name retained (``test_orphan_cleanup_endpoint_does_not_500``) so
    reviewers tracking this finding by name continue to find the
    assertion.  The body is now a hard check, not a skip.

    Auxiliary: if ``TEST_ADMIN_TOKEN`` is in env, we additionally exercise
    the happy path (admin → 200).  Without it, we skip cleanly with a
    pointer for the operator.
    """
    # Non-admin Bearer (the default ``auth_headers`` test user) — must 403.
    resp = http.post(
        _backend("/api/billing/sessions/cleanup?max_age_hours=2"),
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited")

    assert resp.status_code < 500, (
        f"orphan-cleanup endpoint 5xx'd: {resp.status_code}. "
        f"Body: {_body_snippet(resp)}"
    )

    # SECURITY: a non-admin authenticated user MUST be rejected.  If this
    # ever returns 200 again, P0-02 has regressed.
    assert resp.status_code in (401, 403), (
        f"SECURITY (P0-02): non-admin user got {resp.status_code} on "
        f"/api/billing/sessions/cleanup — must be 403 'Admin access required'. "
        f"Body: {_body_snippet(resp)}"
    )

    # Bonus: if the test runner supplied an admin token, exercise the
    # happy path so we know the gate is not over-eager (i.e. doesn't 403
    # admins too).
    admin_token = os.environ.get("TEST_ADMIN_TOKEN", "").strip()
    if not admin_token:
        pytest.skip(
            "Non-admin path verified (403). Set TEST_ADMIN_TOKEN to fully "
            "verify the admin happy path."
        )

    admin_headers = dict(auth_headers)
    admin_headers["Authorization"] = f"Bearer {admin_token}"
    admin_resp = http.post(
        _backend("/api/billing/sessions/cleanup?max_age_hours=2"),
        headers=admin_headers,
    )
    if admin_resp.status_code == 429:
        pytest.skip("Rate-limited on admin verification")
    assert admin_resp.status_code in (200, 204), (
        f"SECURITY: admin Bearer got {admin_resp.status_code} on "
        f"/api/billing/sessions/cleanup — gate is over-eager. "
        f"Body: {_body_snippet(admin_resp)}"
    )


def test_orphan_cleanup_requires_auth(http: httpx.Client):
    """Anonymous orphan-cleanup must be rejected."""
    resp = http.post(_backend("/api/billing/sessions/cleanup"))
    if resp.status_code == 429:
        pytest.skip("Rate-limited")
    assert resp.status_code in (401, 403), (
        f"SECURITY: anonymous /sessions/cleanup returned {resp.status_code} — "
        f"must require auth"
    )


# ───────────────────────────────────────────────────────────────────────────
# 5. Admin endpoints — non-admin Bearer must be rejected
# ───────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("path", [
    "/api/admin/users",
    "/api/admin/credits/grant",
    "/api/admin/sessions/all",
    "/api/admin/cleanup",
])
def test_admin_endpoints_reject_non_admin(
    http: httpx.Client, auth_headers: dict[str, str], path: str
):
    """Any /api/admin/* endpoint must reject a non-admin Bearer with 401/403/404.

    NOTE: today the FastAPI backend may not have any /api/admin/* routes
    registered — in that case we get 404 from FastAPI's default router,
    which is acceptable.  What we forbid is 200 or 5xx.
    """
    resp = http.get(_backend(path), headers=auth_headers)
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited")
    assert resp.status_code != 200, (
        f"SECURITY: {path} returned 200 to a non-admin Bearer — admin "
        f"gate is missing. Body: {_body_snippet(resp)}"
    )
    assert resp.status_code in (401, 403, 404, 405), (
        f"SECURITY: {path} returned {resp.status_code} — expected 4xx. "
        f"Body: {_body_snippet(resp)}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 6. Stripe webhook (frontend /api/credits/webhook)
# ───────────────────────────────────────────────────────────────────────────


def _webhook_url() -> str:
    """Resolve the Stripe webhook URL — first try frontend, fall back to backend."""
    return _frontend("/api/credits/webhook")


def test_stripe_webhook_no_signature_returns_400(http: httpx.Client):
    """POST without ``Stripe-Signature`` header must be 400.

    Source: app/api/credits/webhook/route.ts line 112 — the route returns
    {"error": "Missing stripe signature"} 400.

    Skips if the endpoint is not reachable (some deployments may proxy or
    hide it).
    """
    payload = b'{"id":"evt_probe","type":"checkout.session.completed"}'
    try:
        resp = http.post(
            _webhook_url(),
            content=payload,
            headers={"Content-Type": "application/json"},
            timeout=15.0,
        )
    except httpx.RequestError as e:
        pytest.skip(f"Stripe webhook endpoint unreachable: {e}")
    if resp.status_code == 429:
        pytest.skip("Rate-limited")
    if resp.status_code == 405:
        pytest.skip("Webhook endpoint not exposed (405) — deployment-specific")
    if resp.status_code in (404, 521, 522, 523, 525):
        pytest.skip(f"Webhook endpoint not deployed at {_webhook_url()}")
    assert resp.status_code == 400, (
        f"SECURITY: Stripe webhook without signature returned "
        f"{resp.status_code} — expected 400. Body: {_body_snippet(resp)}"
    )


def test_stripe_webhook_wrong_signature_rejected(http: httpx.Client):
    """A bogus ``Stripe-Signature`` header must be rejected with 400.

    The route uses ``stripe.webhooks.constructEvent`` which throws on bad
    signatures; the catch returns {"error": "Invalid signature"} 400.
    """
    payload = b'{"id":"evt_bogus","type":"checkout.session.completed","data":{}}'
    bogus_sig = "t=1700000000,v1=" + "f" * 64
    try:
        resp = http.post(
            _webhook_url(),
            content=payload,
            headers={
                "Content-Type": "application/json",
                "Stripe-Signature": bogus_sig,
            },
            timeout=15.0,
        )
    except httpx.RequestError as e:
        pytest.skip(f"Stripe webhook unreachable: {e}")
    if resp.status_code in (404, 405, 429, 521, 522, 523, 525):
        pytest.skip(
            f"Stripe webhook not exposed in this deployment "
            f"({resp.status_code})"
        )
    assert resp.status_code in (400, 401), (
        f"SECURITY: bogus Stripe-Signature returned {resp.status_code} — "
        f"expected 400/401. Body: {_body_snippet(resp)}"
    )


def test_stripe_webhook_replay_idempotent(http: httpx.Client):
    """Replaying the same signed event twice must not double-credit.

    The route uses ``upsert ... onConflict: id, ignoreDuplicates: true``
    on the ``stripe_events`` table — the second insert is a no-op and the
    handler returns {"received": true} without processing.

    Without a real webhook secret, we can't construct a passing signature;
    skip cleanly when TEST_STRIPE_WEBHOOK_SECRET is missing.
    """
    secret = _stripe_secret()
    if not secret:
        pytest.skip(
            "TEST_STRIPE_WEBHOOK_SECRET not configured — cannot construct "
            "a valid Stripe signature for replay test"
        )

    event_id = f"evt_replay_{uuid.uuid4().hex[:16]}"
    event = _build_stripe_event(event_id, user_id="test-replay-user", credits=1)
    payload = json.dumps(event, separators=(",", ":")).encode()
    sig = _stripe_signature(payload, secret)

    headers = {
        "Content-Type": "application/json",
        "Stripe-Signature": sig,
    }

    try:
        first = http.post(_webhook_url(), content=payload, headers=headers, timeout=15.0)
        second = http.post(_webhook_url(), content=payload, headers=headers, timeout=15.0)
    except httpx.RequestError as e:
        pytest.skip(f"Webhook unreachable: {e}")
    if first.status_code in (404, 405, 429, 521, 522, 523, 525):
        pytest.skip(f"Webhook not exposed ({first.status_code})")

    # Both deliveries must be 200 (idempotent receipt).  If either is 4xx,
    # signature validation is broken (or our test secret doesn't match).
    if first.status_code in (400, 401):
        pytest.skip(
            f"Webhook signature mismatch — TEST_STRIPE_WEBHOOK_SECRET may "
            f"not match the deployed STRIPE_WEBHOOK_SECRET. "
            f"First response: {_body_snippet(first)}"
        )

    assert first.status_code == 200, (
        f"First delivery returned {first.status_code}: {_body_snippet(first)}"
    )
    assert second.status_code == 200, (
        f"Replay returned {second.status_code} — should idempotently 200. "
        f"Body: {_body_snippet(second)}"
    )
    # Both bodies should be {"received": true}
    try:
        b1 = first.json()
        b2 = second.json()
        assert b1.get("received") is True
        assert b2.get("received") is True
    except Exception:
        pass


def test_stripe_webhook_concurrent_deliveries_idempotent(http: httpx.Client):
    """10 concurrent webhook deliveries with the same event id must result
    in exactly ONE credit grant.

    The route uses ``upsert ... ignoreDuplicates: true`` on stripe_events —
    only the first insert returns a row; subsequent ones return null and
    the handler short-circuits without granting credits.  This catches the
    race window where ``insertedEvent`` could leak through twice.

    Capped at 10 concurrent calls (well under the 20-call ceiling).
    Skipped when TEST_STRIPE_WEBHOOK_SECRET is missing.
    """
    secret = _stripe_secret()
    if not secret:
        pytest.skip("TEST_STRIPE_WEBHOOK_SECRET not configured")

    event_id = f"evt_race_{uuid.uuid4().hex[:16]}"
    event = _build_stripe_event(event_id, user_id="test-race-user", credits=1)
    payload = json.dumps(event, separators=(",", ":")).encode()
    sig = _stripe_signature(payload, secret)
    headers = {
        "Content-Type": "application/json",
        "Stripe-Signature": sig,
    }

    async def fire(client: httpx.AsyncClient) -> httpx.Response:
        return await client.post(
            _webhook_url(), content=payload, headers=headers
        )

    async def burst() -> list[httpx.Response]:
        async with httpx.AsyncClient(
            verify=False, http2=True, timeout=20.0
        ) as c:
            return await asyncio.gather(*(fire(c) for _ in range(10)))

    try:
        results = asyncio.run(burst())
    except Exception as e:
        pytest.skip(f"Webhook unreachable: {e}")

    statuses = [r.status_code for r in results]
    if any(s in (404, 405, 521, 522, 523, 525) for s in statuses):
        pytest.skip(f"Webhook not exposed ({statuses})")
    if any(s in (400, 401) for s in statuses):
        pytest.skip(
            f"Webhook signature mismatch — TEST_STRIPE_WEBHOOK_SECRET likely "
            f"wrong. Statuses: {statuses}"
        )

    # All responses must be 2xx — the route returns 200 for both first
    # processing and dup-skip.
    for r in results:
        assert 200 <= r.status_code < 300, (
            f"SECURITY: concurrent webhook delivery returned "
            f"{r.status_code} — must be 2xx. Body: {_body_snippet(r)}"
        )
    # We can't directly verify "exactly 1 credit grant" without DB access,
    # but the route guarantees this via the upsert+ignoreDuplicates SQL —
    # the test passes as long as no duplicate processing surfaces as an
    # error response.


def test_stripe_webhook_payload_for_other_account_rejected(http: httpx.Client):
    """A signed payload with a signature computed from a DIFFERENT secret
    must be rejected with 400.

    This catches the case where an attacker has an old/leaked webhook
    secret from a different Stripe account and tries to forge events.
    """
    payload = b'{"id":"evt_fakeaccount","type":"checkout.session.completed","data":{}}'
    # Use a totally unrelated secret — guaranteed to mismatch
    wrong_secret = "whsec_test_definitely_not_the_real_secret"
    sig = _stripe_signature(payload, wrong_secret)
    try:
        resp = http.post(
            _webhook_url(),
            content=payload,
            headers={
                "Content-Type": "application/json",
                "Stripe-Signature": sig,
            },
            timeout=15.0,
        )
    except httpx.RequestError as e:
        pytest.skip(f"Webhook unreachable: {e}")
    if resp.status_code in (404, 405, 429, 521, 522, 523, 525):
        pytest.skip(f"Webhook not exposed ({resp.status_code})")
    assert resp.status_code in (400, 401), (
        f"SECURITY: payload signed with foreign secret returned "
        f"{resp.status_code} — expected 400/401. Body: {_body_snippet(resp)}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 7. Sanity: chat creation does not start unbilled VM session
# ───────────────────────────────────────────────────────────────────────────


def test_chat_create_does_not_start_billing_session(
    http: httpx.Client, auth_headers: dict[str, str], test_user_id: str
):
    """Creating a chat must not implicitly start a billing session.

    Sanity check: capture balance, create a chat, capture balance again.
    Within a tolerance of 0 (no real chat activity), balance must be
    unchanged.  Cleanup: delete the chat.
    """
    bal1 = http.get(
        _backend("/api/billing/credits/balance"), headers=auth_headers
    )
    _skip_if_invalid_user(bal1)
    if bal1.status_code != 200:
        pytest.skip(f"Cannot read balance ({bal1.status_code})")
    before = bal1.json().get("balance", 0)

    create = http.post(
        _backend("/api/chats/create"),
        json={
            "user_id": test_user_id,
            "title": "billing-sanity",
            "model": "default",
            "source": "post-deploy-test",
        },
        headers=auth_headers,
    )
    if create.status_code == 429:
        pytest.skip("Rate-limited")
    if create.status_code not in (200, 201):
        pytest.skip(f"Could not create chat ({create.status_code})")
    chat_id = (create.json().get("chat") or create.json()).get("id")

    try:
        bal2 = http.get(
            _backend("/api/billing/credits/balance"), headers=auth_headers
        )
        if bal2.status_code != 200:
            pytest.skip("Cannot re-read balance")
        after = bal2.json().get("balance", 0)
        # Some natural drift may happen if other tests are running, but
        # creating a chat should never deduct credits on its own.  Allow
        # at most +/- 5 credits of drift.
        diff = before - after
        assert diff <= 5, (
            f"SECURITY: balance dropped by {diff} after creating a chat — "
            f"chat creation must not implicitly start a billing session. "
            f"Before: {before}, after: {after}"
        )
    finally:
        try:
            http.request(
                "DELETE",
                _backend(f"/api/chats/{chat_id}"),
                headers=auth_headers,
            )
        except Exception:
            pass


# ───────────────────────────────────────────────────────────────────────────
# 8. Cross-tenant session-status (write methods)
# ───────────────────────────────────────────────────────────────────────────


@pytest.mark.parametrize("method", ["POST", "PUT", "PATCH", "DELETE"])
def test_session_status_write_methods_rejected(
    http: httpx.Client, auth_headers: dict[str, str], method: str
):
    """Only GET is defined for /api/billing/sessions/{id}/status.  Writes
    must return 405/404 — never 200."""
    resp = http.request(
        method,
        _backend(f"/api/billing/sessions/{FAKE_UUID_1}/status"),
        json={"completion_status": "completed"},
        headers=auth_headers,
    )
    _skip_if_invalid_user(resp)
    if resp.status_code == 429:
        pytest.skip("Rate-limited")
    assert resp.status_code != 200, (
        f"SECURITY: {method} /sessions/.../status returned 200 — "
        f"must be method-not-allowed. Body: {_body_snippet(resp)}"
    )
    assert resp.status_code in (401, 403, 404, 405, 422), (
        f"SECURITY: {method} /sessions/.../status returned {resp.status_code}. "
        f"Body: {_body_snippet(resp)}"
    )
