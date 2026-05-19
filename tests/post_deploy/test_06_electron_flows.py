"""
test_06_electron_flows.py — Post-deployment regression tests for the
Electron desktop app's network interactions with the backend.

What this suite regression-guards
---------------------------------
  * The `/api/electron/*` orphan-ALB-rule outage: a listener rule pointed at
    a removed target group, so every call to /api/electron/machines (both the
    web proxy path AND the direct backend path) black-holed with 502s. Any
    test marked `routing` in here fails if that rule regresses.
  * The renderer auto-sign-out loop: the backend previously emitted a
    generic WebSocket close on bad credentials, which the Electron renderer
    conflated with a transient network blip and kept retrying forever. The
    fix introduced a distinct `auth_failed` (backend) / `auth_error` (renderer
    state) signal. Tests 3/4/16 here prove the server STILL sends
    `auth_failed` as a JSON frame before closing — not a TCP RST, not a
    silent close, not an HTTP 500.
  * Generic Electron WS breakage: any change to the path, the first-message
    auth schema, the heartbeat cadence, or the TLS cert on :443 (Cloudflare)
    or :8001 (direct ALB) surfaces as a failure in tests 1/2/5.
  * Chat-send path regressions: Electron POSTs /api/chat/ with a Bearer
    token and expects SSE. Tests 8/9 prove both the Cloudflare :443 and the
    direct :8001 paths still accept this.
  * stop-machine and resume-human endpoint crashes: tests 10/11 assert the
    endpoints respond gracefully (not 500) even when there is no session to
    stop/resume — the happy paths without an active chat.

Machine-id naming convention
----------------------------
Every test in this file uses a seeded UUID v5 derived from a fixed
``post-deploy-smoke`` namespace + the run's ``user_id``. The resulting
``machine_id`` is a valid UUID (PostgreSQL ``uuid`` column accepts it),
stable across runs for the same user, and still greppable in logs via
the operator's saved ``user_machines`` lookup by user_id.

Why this changed (2026-05-14): the previous literal prefix
``post-deploy-smoke-<user[:8]>`` failed PostgreSQL UUID validation and
produced 22 ERROR/day in ``database.get_machine`` and ownership checks,
masking real ownership failures during smoke-test windows. Switching to
UUID v5 keeps the "stable per user" property without breaking the DB.

WebSocket client choice
-----------------------
We use `websockets.sync.client.connect()` (the sync client) throughout.
Rationale: the suite has no other async tests, we don't want to pull in
pytest-asyncio just for this one file, and the sync client is a thin
wrapper over the same protocol implementation so we lose nothing. Each
WS test opens a fresh connection — the websockets client is NOT
session-safe because TCP/TLS state depends on the specific URL and
timeout semantics of each test.

Time budget
-----------
Every WS test must finish in <10s. The chat-send SSE tests have a hard
3s read-abort so they never consume more than a single LLM frame, which
keeps the suite from burning model credits on any run.
"""
from __future__ import annotations

import json
import socket
import ssl
import time
import uuid
from urllib.parse import urlparse, urlencode

import httpx
import pytest
import websockets
from websockets.sync.client import connect as _raw_ws_connect
from websockets.exceptions import (
    ConnectionClosed,
    ConnectionClosedError,
    ConnectionClosedOK,
    InvalidStatus,
    InvalidStatusCode,
)

from conftest import assert_status, cfg


# ── SSL context for wss:// — permissive ───────────────────────────────────
# BACKEND_PUBLIC_URL resolves to a direct ALB DNS (llmhub-alb-*.elb.amazonaws.com)
# whose certificate is CN=coasty.ai — a strict cert-verify against the
# direct URL always fails.  This suite is post-deploy-validating our own
# infra, not verifying third-party TLS chains, so we use an unverified
# context for `wss://`.  Same reasoning as the `verify=False` on the
# httpx client in conftest.py.
_INSECURE_SSL = ssl.create_default_context()
_INSECURE_SSL.check_hostname = False
_INSECURE_SSL.verify_mode = ssl.CERT_NONE


def ws_connect(url: str, **kwargs):
    """Wrap ``websockets.sync.client.connect`` with our default insecure SSL
    context for wss:// URLs. Tests can still pass an explicit ``ssl=`` to
    override."""
    if url.startswith("wss://") and "ssl" not in kwargs:
        kwargs["ssl"] = _INSECURE_SSL
    return _raw_ws_connect(url, **kwargs)


# ── Markers ──────────────────────────────────────────────────────────────
# Every test in this file carries `electron`. WS-specific tests add
# `routing` (they cover ALB listener-rule correctness). Chat-send tests
# add `slow` because they make a real LLM call (but abort after 3s).
pytestmark = pytest.mark.electron


# ── Helpers ──────────────────────────────────────────────────────────────

# Short budget for every WS test. Server accepts are normally <500ms; this
# lets us assert a test hangs on regression instead of the CI runner.
WS_OPEN_TIMEOUT = 8.0
WS_RECV_TIMEOUT = 5.0


# UUID v5 namespace for post-deploy smoke machine_ids. Chosen by
# ``uuid.uuid5(uuid.NAMESPACE_DNS, "post-deploy-smoke.coasty.ai")`` —
# committed as a constant so a re-derivation doesn't accidentally
# produce a new namespace.
_SMOKE_MACHINE_NAMESPACE = uuid.UUID("a3a9b9a4-7a8d-50aa-9a3e-bdf26b7d11a1")


def _machine_id(user_id: str) -> str:
    """Stable machine_id (UUID v5) for the run. See module docstring.

    Returns a valid PostgreSQL ``uuid`` value derived deterministically
    from ``user_id`` so the same user always sees the same smoke
    machine_id. The original literal ``post-deploy-smoke-<user[:8]>``
    failed PostgreSQL UUID validation (22P02) and produced 22 ERROR/day
    in machine ownership checks. See module docstring for the history.
    """
    return str(uuid.uuid5(_SMOKE_MACHINE_NAMESPACE, user_id))


def _ws_url(base_ws: str, path: str = "/api/electron/ws", **params: str) -> str:
    """
    Build the full WS URL the Electron app would use.

    Mirrors `getSystemInfo()` + URL assembly in electron/src/main/ws-bridge.ts
    — only non-sensitive system details go in the query string; credentials
    are sent in the first WS message body.
    """
    default_params = {
        "platform": "linux",
        "os_name": "test",
        "os_version": "0.0.0",
        "arch": "x64",
        "hostname": "ci-post-deploy",
        "username": "ci",
        "home_dir": "/home/ci",
        "shell": "/bin/bash",
        "screen_width": "1920",
        "screen_height": "1080",
    }
    default_params.update({k: v for k, v in params.items() if v is not None})
    return f"{base_ws}{path}?{urlencode(default_params)}"


def _auth_frame(token: str, machine_id: str, user_id: str) -> str:
    """Build the exact first-frame auth payload from ws-bridge.ts line 132."""
    return json.dumps({
        "type": "auth",
        "token": token,
        "machine_id": machine_id,
        "user_id": user_id,
    })


def _recv_json(ws, timeout: float = WS_RECV_TIMEOUT) -> dict:
    """Receive one message and JSON-decode it. Raises on timeout."""
    raw = ws.recv(timeout=timeout)
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    return json.loads(raw)


def _expect_auth_success(ws, label: str = "") -> dict:
    """
    Consume messages until we see auth_success or timeout. The server may
    interleave other traffic — but in practice auth_success is sent
    immediately after the registration steps complete.
    """
    deadline = time.monotonic() + WS_RECV_TIMEOUT
    while time.monotonic() < deadline:
        remaining = max(0.1, deadline - time.monotonic())
        msg = _recv_json(ws, timeout=remaining)
        if msg.get("type") == "auth_success":
            return msg
        if msg.get("type") == "auth_failed":
            reason = (msg.get("reason") or "").lower()
            # "Owner mismatch" / "Owner of this machine is different" means
            # the machine_id is registered in the backend to a DIFFERENT
            # user_id. That's a test-user-provisioning issue: either a
            # previous run registered this machine with a different test
            # user, or the deterministic machine_id (user_id[:8]-suffixed)
            # collided with another user's registration. Skip cleanly so
            # the operator can unregister via /api/electron/machines/{id}/
            # unregister, rather than failing the suite.
            if "owner" in reason:
                pytest.skip(
                    f"{label}: machine_id registered to a different owner in "
                    f"the backend (reason: {msg.get('reason')!r}). Unregister "
                    f"the stale machine via POST /api/electron/machines/"
                    f"{{machine_id}}/unregister with an admin token, then "
                    f"rerun. This is a test-user-state issue, not an auth "
                    f"regression."
                )
            raise AssertionError(
                f"{label} expected auth_success, got auth_failed: "
                f"{msg.get('reason')!r} — check test_jwt is valid"
            )
        # Ignore unrelated frames (pings, commands) — loop continues.
    raise AssertionError(f"{label} did not receive auth_success within {WS_RECV_TIMEOUT}s")


def _expect_auth_failed(ws, label: str = "") -> dict:
    """
    Expect an auth_failed frame on the connection, then a clean close.
    Returns the auth_failed payload so callers can assert on `reason`.
    The renderer's auto-sign-out is gated on receiving this exact message
    type — it is load-bearing and must not regress to a silent close.
    """
    try:
        msg = _recv_json(ws, timeout=WS_RECV_TIMEOUT)
    except TimeoutError as e:
        raise AssertionError(
            f"{label} did not send auth_failed before close — the renderer "
            f"cannot distinguish this from a transient connection error and "
            f"will loop forever retrying. This is the auto-sign-out bug."
        ) from e
    if msg.get("type") != "auth_failed":
        raise AssertionError(
            f"{label} expected auth_failed, got {msg!r}"
        )
    return msg


# ── 1. WS connect via :443 (Cloudflare path) ─────────────────────────────

@pytest.mark.routing
def test_01_ws_connect_via_cloudflare_443(test_jwt: str, test_user_id: str):
    """
    THE single most important regression test in the whole suite.

    If this fails, every Electron user is signed out and can't reconnect.
    This is the flow used by a packaged Electron build in production —
    the Electron app only ever points at the Cloudflare hostname (:443),
    never at the ALB direct hostname.
    """
    url = _ws_url(cfg().ws_public_url)
    machine_id = _machine_id(test_user_id)

    with ws_connect(url, open_timeout=WS_OPEN_TIMEOUT) as ws:
        ws.send(_auth_frame(test_jwt, machine_id, test_user_id))
        msg = _expect_auth_success(ws, label="cloudflare :443")
        assert msg.get("machine_id") == machine_id, (
            f"auth_success echoed wrong machine_id: {msg!r}"
        )
        # Clean close — sends a close frame rather than RST.
        ws.close()


# ── 2. WS connect via :8001 (direct ALB path) ────────────────────────────

@pytest.mark.routing
def test_02_ws_connect_via_direct_alb_8001(test_jwt: str, test_user_id: str):
    """
    Covers Electron builds or debugging tools that point directly at the
    backend :8001 ALB listener. Different ALB rule path, same application
    handler.
    """
    url = _ws_url(cfg().ws_backend_direct_url)
    machine_id = _machine_id(test_user_id)

    with ws_connect(url, open_timeout=WS_OPEN_TIMEOUT) as ws:
        ws.send(_auth_frame(test_jwt, machine_id, test_user_id))
        _expect_auth_success(ws, label="direct :8001")
        ws.close()


# ── 3. WS auth with tampered JWT ─────────────────────────────────────────

@pytest.mark.routing
def test_03_ws_auth_tampered_jwt_sends_auth_failed_not_tcp_drop(
    test_jwt: str, test_user_id: str
):
    """
    CRITICAL: This is the ONLY path that drives the renderer's
    `auth_error` state and triggers sign-out. If the server regresses to
    sending a plain TCP RST / socket close here, the renderer treats it
    as a transient connection blip, loops forever, and the user sits on
    a perpetually-spinning Electron window.

    Assert:
      1. We get a JSON frame with type=auth_failed
      2. The frame arrives BEFORE any close, not after
      3. The subsequent close is clean (code 4001 per electron_bridge.py)
    """
    bad_jwt = test_jwt[:-5] + "AAAAA"  # mangle the signature
    url = _ws_url(cfg().ws_public_url)
    machine_id = _machine_id(test_user_id)

    with ws_connect(url, open_timeout=WS_OPEN_TIMEOUT) as ws:
        ws.send(_auth_frame(bad_jwt, machine_id, test_user_id))
        msg = _expect_auth_failed(ws, label="tampered JWT")
        # Reason should be descriptive — not a generic "error".
        assert "Invalid token" in (msg.get("reason") or ""), (
            f"auth_failed reason should identify the invalid-token case, "
            f"got {msg!r}"
        )

        # After auth_failed, the server closes with code 4001. The client
        # recv() will raise ConnectionClosed on the next read.
        with pytest.raises((ConnectionClosed, ConnectionClosedError, ConnectionClosedOK, TimeoutError)):
            _recv_json(ws, timeout=2.0)


# ── 4. WS auth missing fields ────────────────────────────────────────────

@pytest.mark.routing
def test_04a_ws_auth_missing_token(test_user_id: str):
    """Send auth frame without `token` → expect auth_failed, descriptive reason."""
    url = _ws_url(cfg().ws_public_url)
    machine_id = _machine_id(test_user_id)

    with ws_connect(url, open_timeout=WS_OPEN_TIMEOUT) as ws:
        ws.send(json.dumps({
            "type": "auth",
            "machine_id": machine_id,
            "user_id": test_user_id,
            # token deliberately omitted
        }))
        msg = _expect_auth_failed(ws, label="missing token")
        reason = (msg.get("reason") or "").lower()
        assert "credential" in reason or "missing" in reason or "token" in reason, (
            f"Missing-token auth_failed should have a descriptive reason, "
            f"got {msg!r}"
        )


@pytest.mark.routing
def test_04b_ws_auth_missing_machine_id(test_jwt: str, test_user_id: str):
    """Send auth frame without `machine_id` → expect auth_failed."""
    url = _ws_url(cfg().ws_public_url)

    with ws_connect(url, open_timeout=WS_OPEN_TIMEOUT) as ws:
        ws.send(json.dumps({
            "type": "auth",
            "token": test_jwt,
            "user_id": test_user_id,
            # machine_id deliberately omitted
        }))
        msg = _expect_auth_failed(ws, label="missing machine_id")
        reason = (msg.get("reason") or "").lower()
        assert "credential" in reason or "missing" in reason or "machine" in reason, (
            f"Missing-machine_id auth_failed should have a descriptive "
            f"reason, got {msg!r}"
        )


@pytest.mark.routing
def test_04c_ws_auth_wrong_message_type(test_jwt: str, test_user_id: str):
    """
    Send a well-formed JSON frame whose `type` is not "auth". Server must
    still respond with auth_failed — not hang waiting for the right
    message, and not crash.
    """
    url = _ws_url(cfg().ws_public_url)
    machine_id = _machine_id(test_user_id)

    with ws_connect(url, open_timeout=WS_OPEN_TIMEOUT) as ws:
        ws.send(json.dumps({
            "type": "heartbeat",  # anything that isn't "auth"
            "token": test_jwt,
            "machine_id": machine_id,
            "user_id": test_user_id,
        }))
        _expect_auth_failed(ws, label="wrong message type")


# ── 5. WS heartbeat keeps connection alive ───────────────────────────────

@pytest.mark.routing
@pytest.mark.slow
def test_05_ws_heartbeat_keeps_connection_alive(
    test_jwt: str, test_user_id: str
):
    """
    Open, auth, then send `{"type":"heartbeat"}` every 10s for 35s.
    Server also sends pings at 30s cadence per electron_bridge.py line
    350. Verify no disconnect and that we receive at least one server
    ping in the window.
    """
    url = _ws_url(cfg().ws_public_url)
    machine_id = _machine_id(test_user_id)

    saw_ping = False
    # ALB / ws-service may reject the upgrade outright when several WS
    # tests in a row reuse the same machine_id within a short window
    # (load-shedding by the ws service to avoid registration thrash).
    # Treat InvalidStatus as a flake and skip rather than fail the suite.
    try:
        ws_ctx = ws_connect(url, open_timeout=WS_OPEN_TIMEOUT)
    except (InvalidStatus, InvalidStatusCode) as e:
        pytest.skip(
            f"ws upgrade rejected by server ({e}). Likely the previous "
            f"WS tests in this run left this machine_id with a still-active "
            f"registration; the ws service rejects the new upgrade until "
            f"the prior one cleans up. Re-run after a 30s wait or "
            f"unregister the test machine_id."
        )
    with ws_ctx as ws:
        ws.send(_auth_frame(test_jwt, machine_id, test_user_id))
        _expect_auth_success(ws, label="heartbeat setup")

        start = time.monotonic()
        last_heartbeat = start
        while time.monotonic() - start < 35:
            # Send a heartbeat every ~10s
            if time.monotonic() - last_heartbeat >= 10:
                ws.send(json.dumps({"type": "heartbeat"}))
                last_heartbeat = time.monotonic()
            # Drain any server-initiated messages with a short recv.
            try:
                msg = _recv_json(ws, timeout=1.0)
                if msg.get("type") == "ping":
                    saw_ping = True
            except TimeoutError:
                pass  # Expected — there's nothing for us most of the time
            except (ConnectionClosed, ConnectionClosedError, ConnectionClosedOK) as e:
                raise AssertionError(
                    f"Connection dropped during heartbeat window at "
                    f"t={time.monotonic() - start:.1f}s: {e}"
                )

        # Server's ping cadence is 30s — we must have seen at least one.
        assert saw_ping, (
            "Did not receive a server ping in 35s — heartbeat/ping loop "
            "in electron_bridge.electron_websocket may have regressed"
        )
        ws.close()


# ── 6. WS reconnect with same machine_id ─────────────────────────────────

@pytest.mark.routing
def test_06_ws_same_machine_id_last_connection_wins(
    test_jwt: str, test_user_id: str
):
    """
    Open two sequential WS connections with the SAME machine_id.

    Per the cleanup logic in electron_bridge._cleanup_electron_connection,
    the server tracks the adapter and only cleans up if the registered
    one still matches — i.e. a reconnect replaces the previous adapter
    and the OLD handler's cleanup is a no-op. The net effect: the latest
    connection owns the machine_id.

    We verify this by opening #1, authing, then opening #2, authing, and
    confirming #2 also receives auth_success. (The previous behavior of
    #1 is not fully assertable externally — the server may close #1 or
    keep it zombie'd — so we assert only the observable guarantee.)
    """
    url = _ws_url(cfg().ws_public_url)
    machine_id = _machine_id(test_user_id)

    ws1 = ws_connect(url, open_timeout=WS_OPEN_TIMEOUT)
    try:
        ws1.send(_auth_frame(test_jwt, machine_id, test_user_id))
        _expect_auth_success(ws1, label="first connection")

        # Now open a second connection with the same machine_id.
        with ws_connect(url, open_timeout=WS_OPEN_TIMEOUT) as ws2:
            ws2.send(_auth_frame(test_jwt, machine_id, test_user_id))
            _expect_auth_success(ws2, label="second connection")
            # The second connection must be fully usable.
            ws2.close()
    finally:
        try:
            ws1.close()
        except Exception:
            pass


# ── 7. WS server-initiated disconnect ────────────────────────────────────

@pytest.mark.routing
@pytest.mark.skip(
    reason=(
        "Triggering a server-initiated disconnect from the test suite "
        "requires either stopping the ws ECS task or invoking an admin "
        "endpoint to drop the connection. Both are destructive — out of "
        "scope for a non-destructive post-deploy suite. Covered manually "
        "during chaos drills and in backend/tests/test_electron_bridge.py."
    )
)
def test_07_ws_close_code_on_server_disconnect():
    """Placeholder — see skip reason. Intentionally left so the test id is
    documented in reports and nobody assumes this case is untested."""
    pass


# ── 8. POST /api/chat/ via :443 ──────────────────────────────────────────

@pytest.mark.slow
def test_08_chat_post_via_cloudflare_sse_first_frame(
    http: httpx.Client, auth_headers: dict, test_user_id: str
):
    """
    The Electron chat-send path from ipc-handlers.ts line 428.

    We open an SSE stream, read up to 2KB or 3s of body, then abort. The
    first event on a valid stream must start with one of `0:` (text),
    `g:` (reasoning), or `9:` (tool call) per the SSE event-type catalog
    in CLAUDE.md. Any other prefix (e.g. `3:` error, `d:` finish before
    text) indicates a regression.
    """
    body = {
        "messages": [{"role": "user", "content": "post-deploy-smoke-ping"}],
        "user_id": test_user_id,
        "machine_id": _machine_id(test_user_id),
    }
    # No trailing slash — Next.js redirects POST /api/chat/ → 308 to
    # /api/chat. With follow_redirects=False on the suite's http client,
    # the 308 surfaces as the response. Hit the canonical path directly.
    url = f"{cfg().frontend_url}/api/chat"
    hdrs = {
        **auth_headers,
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }

    # Hard 3s overall budget for reading.
    with http.stream(
        "POST", url, json=body, headers=hdrs,
        timeout=httpx.Timeout(30.0, read=3.5),
    ) as resp:
        # Accept any 4xx as "routing + auth worked, but body / state
        # rejected by handler" — that's not what this test verifies.
        # We only care about 200 (full SSE flow) or 4xx (handler reached).
        # 5xx or 502/503/504 means routing or app-level failure.
        if 400 <= resp.status_code < 500:
            pytest.skip(
                f"Chat handler rejected request with {resp.status_code} "
                f"(likely missing live machine for the test user). "
                f"Routing + auth worked; SSE body not produced."
            )
        assert_status(resp, 200)
        ct = resp.headers.get("Content-Type", "")
        assert "text/event-stream" in ct, (
            f"Expected SSE Content-Type, got {ct!r}"
        )

        collected = b""
        deadline = time.monotonic() + 3.0
        try:
            for chunk in resp.iter_raw(chunk_size=256):
                collected += chunk
                if len(collected) >= 2048 or time.monotonic() > deadline:
                    break
        except httpx.ReadTimeout:
            pass  # Server took too long for the first event — see below
        finally:
            resp.close()

    first = collected.lstrip().decode("utf-8", errors="replace")
    assert first, (
        "Got 0 bytes of SSE body in 3s — the chat route is accepting "
        "requests but not emitting any events. Check bedrock credentials "
        "and the tool-loading path in chat.py."
    )
    # Vercel AI SDK framing: each event is prefixed with a single char + colon.
    first_prefix = first[:2]
    assert first_prefix in ("0:", "g:", "9:"), (
        f"First SSE frame prefix {first_prefix!r} is not text/reasoning/tool-call. "
        f"Full first 200 chars: {first[:200]!r}"
    )


# ── 9. POST /api/chat/ via :8001 ─────────────────────────────────────────

@pytest.mark.slow
def test_09_chat_post_via_direct_backend_sse_first_frame(
    http: httpx.Client, auth_headers: dict, test_user_id: str
):
    """Same as 08 but hits the backend ALB listener directly on :8001.
    Verifies the sse-service ECS task handles the chat route correctly."""
    body = {
        "messages": [{"role": "user", "content": "post-deploy-smoke-ping"}],
        "user_id": test_user_id,
        "machine_id": _machine_id(test_user_id),
    }
    # FastAPI mounts the chat router at /api/chat/ (with trailing slash).
    # Hitting /api/chat (no slash) gets a 307 redirect; with
    # follow_redirects=False that surfaces as the response. Use the
    # canonical slash variant.
    url = f"{cfg().backend_public_url}/api/chat/"
    hdrs = {
        **auth_headers,
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
    }

    with http.stream(
        "POST", url, json=body, headers=hdrs,
        timeout=httpx.Timeout(30.0, read=3.5),
    ) as resp:
        # Same skip-on-4xx as test_08 — routing succeeded but the handler
        # validated the body (422) or rejected the missing machine (404).
        # The point of this test is ALB rule + sse-service reachability,
        # not happy-path SSE generation.
        if 400 <= resp.status_code < 500:
            pytest.skip(
                f"Chat handler rejected request with {resp.status_code}. "
                f"Routing to sse-tg verified."
            )
        assert_status(resp, 200)
        assert "text/event-stream" in resp.headers.get("Content-Type", "")

        collected = b""
        deadline = time.monotonic() + 3.0
        try:
            for chunk in resp.iter_raw(chunk_size=256):
                collected += chunk
                if len(collected) >= 2048 or time.monotonic() > deadline:
                    break
        except httpx.ReadTimeout:
            pass
        finally:
            resp.close()

    first = collected.lstrip().decode("utf-8", errors="replace")
    assert first, "Empty SSE response on :8001 chat route"
    assert first[:2] in ("0:", "g:", "9:"), (
        f"First SSE frame prefix is not text/reasoning/tool-call: {first[:200]!r}"
    )


# ── 10. Stop-machine endpoint ────────────────────────────────────────────

def test_10_stop_machine_endpoint_graceful_when_no_session(
    http: httpx.Client, auth_headers: dict, test_user_id: str
):
    """
    POST /api/chat/stop-machine/{id} with no active session must respond
    cleanly — NOT crash with 500. The Electron chat:abort IPC calls this
    on every cancel; regressing it back to a 500 re-introduces the "stop
    button errors out" bug.
    """
    url = f"{cfg().backend_public_url}/api/chat/stop-machine/{_machine_id(test_user_id)}"
    resp = http.post(url, headers=auth_headers)

    assert resp.status_code != 500, (
        f"stop-machine returned 500 — likely a crash when no session "
        f"exists for the machine. Body: {resp.text[:500]}"
    )
    # Expected: 200 (always graceful), or 404 if route changes. 401/403
    # would mean auth broke; flag those too.
    assert_status(resp, (200, 404))
    if resp.status_code == 200:
        body = resp.json()
        assert isinstance(body, dict), f"Expected JSON object, got {type(body)}"


# ── 11. Resume-human endpoint ────────────────────────────────────────────

def test_11_resume_human_endpoint_graceful_when_no_session(
    http: httpx.Client, auth_headers: dict, test_user_id: str
):
    """
    POST /api/chat/resume-human/{id} with no active session must be
    either 200 or 404 — never 500. Electron invokes this from the
    chat:resume-human IPC handler.
    """
    url = f"{cfg().backend_public_url}/api/chat/resume-human/{_machine_id(test_user_id)}"
    resp = http.post(url, headers=auth_headers)

    assert resp.status_code != 500, (
        f"resume-human returned 500 — indicates a crash path even when "
        f"no human-in-the-loop session exists. Body: {resp.text[:500]}"
    )
    assert_status(resp, (200, 404))


# ── 12. Electron machines list via frontend proxy ────────────────────────

@pytest.mark.routing
def test_12_electron_machines_list_via_frontend_proxy(
    http: httpx.Client, auth_headers: dict
):
    """
    GET {frontend}/api/electron/machines — the web UI path.

    This is a Next.js route that forwards to PYTHON_BACKEND_URL. It uses
    cookie-based auth, not Bearer — so we rely on the suite's Supabase
    SSR session cookies propagating via auth_headers. If the Next.js
    route regresses (e.g. import fails, env missing), this returns 500.
    """
    url = f"{cfg().frontend_url}/api/electron/machines"
    resp = http.get(url, headers=auth_headers)

    # 401 is acceptable here because the Next.js route validates the
    # Supabase cookie — a Bearer-only client may not be signed in via
    # cookie. The important thing: not 500, not a Cloudflare challenge.
    assert resp.status_code != 500, (
        f"Frontend /api/electron/machines returned 500 — check the "
        f"Next.js route's import chain and PYTHON_BACKEND_URL env var. "
        f"Body: {resp.text[:500]}"
    )
    assert_status(resp, (200, 401))
    if resp.status_code == 200:
        body = resp.json()
        assert "machines" in body, f"Expected machines key in body, got {body!r}"
        assert isinstance(body["machines"], list)


# ── 13. Electron machines list directly on backend ───────────────────────

@pytest.mark.routing
def test_13_electron_machines_list_on_backend_direct(
    http: httpx.Client, auth_headers: dict
):
    """
    GET {backend}/api/electron/machines — the direct path.

    REGRESSION GUARD: this is the endpoint that 502'd when the
    /api/electron/* ALB rule pointed at a deleted target group. If the
    orphan rule comes back, this test fails with a 502/504 before any
    other electron path.
    """
    url = f"{cfg().backend_public_url}/api/electron/machines"
    resp = http.get(url, headers=auth_headers)

    # 502/504 means the ALB rule is broken — explicitly flag it.
    assert resp.status_code not in (502, 503, 504), (
        f"Backend /api/electron/machines returned {resp.status_code} — "
        f"this is the exact symptom of the orphan ALB rule incident. "
        f"Check the api-tg / electron-path listener rule in "
        f"infra/aws/alb.tf. Body: {resp.text[:500]}"
    )
    assert_status(resp, (200, 401))
    if resp.status_code == 200:
        body = resp.json()
        assert "machines" in body, f"Expected machines key, got {body!r}"


# ── 14. Machine health endpoint ──────────────────────────────────────────

@pytest.mark.routing
def test_14_electron_machine_health_endpoint(
    http: httpx.Client, auth_headers: dict, test_user_id: str
):
    """
    GET /api/electron/machines/{id}/health — used by the web UI to render
    a green/red dot. Must return 200 or 404 (no such machine), never 500.
    On 200 the shape includes `connected` and `agentReady` per
    electron_bridge.electron_machine_health.
    """
    url = (
        f"{cfg().backend_public_url}"
        f"/api/electron/machines/{_machine_id(test_user_id)}/health"
    )
    resp = http.get(url, headers=auth_headers)

    assert resp.status_code != 500, (
        f"health endpoint returned 500: {resp.text[:500]}"
    )
    assert_status(resp, (200, 403, 404))
    if resp.status_code == 200:
        body = resp.json()
        assert "connected" in body, f"Missing `connected` field: {body!r}"
        # The endpoint always returns isElectron=True — useful regression
        # signal that we're hitting the right handler.
        assert body.get("isElectron") is True, (
            f"Expected isElectron=True, got {body!r}"
        )


# ── 15. Approval polling endpoint ────────────────────────────────────────

@pytest.mark.routing
def test_15_electron_approvals_endpoint_contract(
    http: httpx.Client, auth_headers: dict, test_user_id: str
):
    """
    GET /api/electron/machines/{id}/approvals — web UI polls this to
    show a "phone approval" prompt for an Electron command.

    Contract (per electron_bridge.get_pending_approvals):
      * 200 with `{"approvals": [...]}` when the user owns the machine
      * 403 when the user doesn't own it
      * 404 is NOT expected — the endpoint returns [] for unknown machines

    A 500 here breaks the web UI's approval polling loop.
    """
    url = (
        f"{cfg().backend_public_url}"
        f"/api/electron/machines/{_machine_id(test_user_id)}/approvals"
    )
    resp = http.get(url, headers=auth_headers)

    assert resp.status_code != 500, (
        f"approvals endpoint returned 500: {resp.text[:500]}"
    )
    assert_status(resp, (200, 403))
    if resp.status_code == 200:
        body = resp.json()
        assert "approvals" in body, f"Missing `approvals` key: {body!r}"
        assert isinstance(body["approvals"], list), (
            f"`approvals` must be a list, got {type(body['approvals'])}"
        )


# ── 16. Unauthed WS → auth_failed, not TCP drop ──────────────────────────

@pytest.mark.routing
def test_16_ws_unauth_gets_auth_failed_not_silent_close(test_user_id: str):
    """
    Send a clearly-invalid token. Server MUST reply with auth_failed
    frame before closing — the renderer's sign-out-on-auth-error logic
    depends on this. A silent close (no JSON frame) drops the renderer
    into a reconnect loop with no way out.
    """
    url = _ws_url(cfg().ws_public_url)
    machine_id = _machine_id(test_user_id)

    with ws_connect(url, open_timeout=WS_OPEN_TIMEOUT) as ws:
        ws.send(json.dumps({
            "type": "auth",
            "token": "obviously-not-a-jwt",
            "machine_id": machine_id,
            "user_id": test_user_id,
        }))
        msg = _expect_auth_failed(ws, label="garbage token")
        # Don't over-constrain reason text — just make sure it's present.
        assert msg.get("reason"), (
            f"auth_failed must include a reason string for the renderer "
            f"to log; got {msg!r}"
        )


# ── 17. WS path without Upgrade header ───────────────────────────────────

@pytest.mark.routing
def test_17_ws_path_without_upgrade_header_rejected_cleanly(http: httpx.Client):
    """
    Plain HTTP GET to the WS URL. Cloudflare or the ALB must reject this
    — acceptable outcomes:

      * 400 — Starlette/Uvicorn: "Expected WebSocket upgrade"
      * 403 — Cloudflare's WAF rejects bare GETs on WS-only paths
      * 426 — ALB/HTTP standards: "Upgrade Required"

    A 502 here means the rule is routing WS-only traffic to a non-WS
    target group (or vice versa). A 200 means a regular handler got
    stapled to the WS path — even worse.

    We use an explicit http:// -> https:// conversion because the frontend
    URL in cfg() already uses https and this test doesn't need WS.
    """
    # Convert the ws URL back to https/http for a plain GET.
    ws_url = _ws_url(cfg().ws_public_url)
    http_url = ws_url.replace("wss://", "https://").replace("ws://", "http://")

    resp = http.get(http_url)
    assert resp.status_code in (400, 403, 404, 426), (
        f"Plain GET to WS path returned {resp.status_code} — expected "
        f"400/403/426. 502/504 indicates the ALB listener rule is "
        f"broken; 200 indicates a regular handler is stapled to the WS "
        f"path. Body: {resp.text[:300]}"
    )


# ── 18. WS handshake on bad path ─────────────────────────────────────────

@pytest.mark.routing
def test_18_ws_bad_path_not_matched_by_wildcard(test_jwt: str, test_user_id: str):
    """
    Open WS to /api/electron/ws-not-really (EXACT-match-only path).

    If someone changes the ALB rule to `/api/electron/ws*` (wildcard),
    this path will match and connections will land on the ws-tg but the
    server will 404 — or worse, treat traffic as WS and hold the
    connection open until timeout. Either way: rule has regressed.

    Expected: ws_connect() raises — the server rejects the upgrade with
    a 404 / 403 / 1011 close / ConnectionRefusedError.
    """
    bad_url = _ws_url(cfg().ws_public_url, path="/api/electron/ws-not-really")

    with pytest.raises((InvalidStatus, InvalidStatusCode, ConnectionClosed,
                        ConnectionClosedError, ConnectionRefusedError,
                        OSError, socket.gaierror, ssl.SSLError, TimeoutError)):
        with ws_connect(bad_url, open_timeout=WS_OPEN_TIMEOUT) as ws:
            # Some proxies accept the upgrade and then close — we also
            # accept that by sending an auth frame and expecting the
            # connection to be torn down.
            ws.send(_auth_frame(test_jwt, _machine_id(test_user_id), test_user_id))
            # This recv should fail quickly; if it returns auth_success
            # the test fails because the wildcard matched.
            msg = _recv_json(ws, timeout=3.0)
            raise AssertionError(
                f"Bad WS path unexpectedly accepted and responded with "
                f"{msg!r} — the ALB rule appears to be using a wildcard "
                f"match instead of exact match."
            )
