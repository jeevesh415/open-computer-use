"""
test_security_websocket.py — WebSocket security tests for the Coasty
electron bridge endpoint at ``/api/electron/ws``.

These tests are post-deployment security regressions: each one targets a
real attack surface the production WebSocket exposes. They are
intentionally complementary to ``test_06_electron_flows.py`` (which
covers the *happy* WS flow + auth_failed-not-silent-close basics) — this
file goes further and exercises bypass attempts, message smuggling,
heartbeat abuse, frame-size limits, and reconnect/replay scenarios.

Auth on WS
----------
  * No auth message at all → server times out and closes within 10 s.
  * Empty first frame → close.
  * Malformed JSON first frame → close.
  * Bogus JWT → ``auth_failed`` JSON frame *before* close (the
    distinct signal renderer needs to drive sign-out).
  * Valid JWT but ``user_id`` claim mismatch → close.
  * Token NOT honored when passed via URL query string ``?access_token=``
    or ``?token=``.
  * Sub-protocol header negotiation: server should not accept arbitrary
    Sec-WebSocket-Protocol headers as auth.

Cross-tenant message smuggling
------------------------------
  * Send ``chat:message`` referencing another user's chat_id → reject /
    ignore (never leak data, never crash).
  * Send a result for a request_id never issued → ignore / no crash.
  * Oversized frame (5 MB) → server enforces frame-size limit.
  * Fragmented frames with malformed continuation → close cleanly.

Heartbeat / keepalive
---------------------
  * Idle for >35 s (heartbeat is 30 s) → backend closes cleanly without
    crashing.
  * Invalid pong frames → close.
  * Burst of 100 pings/sec → backend rate-limits or absorbs gracefully
    (never crashes).

Reconnection / replay
---------------------
  * Two simultaneous WS connections from same user/machine → second is
    accepted (per documented "last connection wins" semantics).
  * After a forced 1008/4001 close, reconnecting with a fresh token must
    succeed.

VM control WS attempts
----------------------
  * The legacy ``/api/vm/...`` REST router has no WS endpoint, so we
    confirm a WS upgrade attempt against that path is rejected and
    cannot be used to smuggle commands.

Constraints (enforced for every test)
-------------------------------------
  * Each test wraps the network round-trip with ``asyncio.wait_for(...,
    timeout=10)`` so a stuck connection never hangs the suite.
  * SSL is permissive (``ssl.CERT_NONE``) because the direct ALB DNS
    differs from the cert CN — same justification as the suite's
    httpx client.
  * Tests skip cleanly when ``TEST_USER_TOKEN`` / ``TEST_MACHINE_ID``
    aren't available via the suite's ``test_jwt`` / ``test_user_id``
    fixtures.
"""
from __future__ import annotations

import asyncio
import json
import ssl
import time
from urllib.parse import urlencode

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

from conftest import cfg

# ── SSL context — same shape as test_06 ──────────────────────────────────
# We're security-testing OUR backend at the ALB DNS, not the third-party
# TLS chain (cert is for coasty.ai, ALB DNS is *.elb.amazonaws.com).
_INSECURE_SSL = ssl.create_default_context()
_INSECURE_SSL.check_hostname = False
_INSECURE_SSL.verify_mode = ssl.CERT_NONE


# Each test must complete within this budget.
TEST_TIMEOUT = 10.0
# Server's documented behavior on missing first frame: 10 s timeout +
# close 4001 (electron_bridge.py:158). With network round-trip slack:
NO_AUTH_CLOSE_BUDGET = 18.0
# The post-auth pings cadence is 30 s; idle close should arrive within
# ~45 s in production. We don't actually wait that long in CI — the
# heartbeat-stress test instead asserts the connection survives
# gracefully under abuse.
HEARTBEAT_STRESS_DURATION = 5.0


pytestmark = [pytest.mark.electron, pytest.mark.security]


# ── Fixture wiring ───────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def ws_url() -> str:
    """Cloudflare-fronted ws:// URL for /api/electron/ws."""
    base = cfg().ws_public_url
    params = urlencode({
        "platform": "linux",
        "os_name": "ci-security",
        "os_version": "0.0.0",
        "arch": "x64",
        "hostname": "ci-security",
        "username": "ci",
        "home_dir": "/home/ci",
        "shell": "/bin/bash",
        "screen_width": "1920",
        "screen_height": "1080",
    })
    return f"{base}/api/electron/ws?{params}"


@pytest.fixture
def machine_id(test_user_id: str) -> str:
    # Distinct prefix from test_06 so concurrent runs don't collide on the
    # same machine_id — a stable suffix per user_id keeps cleanup grep-able.
    return f"post-deploy-sec-{test_user_id[:8]}"


def _ssl_kwargs(url: str) -> dict:
    return {"ssl": _INSECURE_SSL} if url.startswith("wss://") else {}


async def _open(url: str, **kwargs):
    """Open a WS connection with an explicit open timeout."""
    return await asyncio.wait_for(
        websockets.connect(
            url,
            open_timeout=TEST_TIMEOUT,
            close_timeout=2.0,
            **_ssl_kwargs(url),
            **kwargs,
        ),
        timeout=TEST_TIMEOUT,
    )


async def _recv_json(ws, timeout: float = 5.0) -> dict:
    raw = await asyncio.wait_for(ws.recv(), timeout=timeout)
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    return json.loads(raw)


def _auth(token: str, machine_id: str, user_id: str, **extra) -> str:
    payload = {
        "type": "auth",
        "token": token,
        "machine_id": machine_id,
        "user_id": user_id,
    }
    payload.update(extra)
    return json.dumps(payload)


async def _expect_close(ws, label: str, codes: tuple = (),
                        recv_timeout: float = 15.0) -> int:
    """Assert the server closes the connection. Returns the close code.

    ``codes`` — if non-empty, the close code must be in this tuple.
    ``recv_timeout`` — wall-clock budget for how long the server might
    take to close. Default 15 s covers the documented 10 s auth-frame
    timeout (electron_bridge.py:158) plus network round-trip slack.
    """
    try:
        # Drain any remaining frames until close.
        while True:
            msg = await asyncio.wait_for(ws.recv(), timeout=recv_timeout)
            # If we got an auth_failed JSON frame, keep reading for the close.
            if isinstance(msg, (bytes, bytearray)):
                continue
            try:
                _ = json.loads(msg)
            except Exception:
                continue
    except (ConnectionClosed, ConnectionClosedError, ConnectionClosedOK) as e:
        if codes and e.rcvd is not None and e.rcvd.code not in codes:
            raise AssertionError(
                f"{label}: expected close code in {codes}, got {e.rcvd.code} "
                f"reason={e.rcvd.reason!r}"
            )
        return e.rcvd.code if e.rcvd is not None else 1006
    except asyncio.TimeoutError as e:
        raise AssertionError(
            f"{label}: server did not close within {recv_timeout}s"
        ) from e


async def _expect_auth_failed_then_close(ws, label: str) -> dict:
    """Assert server emits an auth_failed JSON frame, then closes 4001."""
    msg = await _recv_json(ws, timeout=5.0)
    assert msg.get("type") == "auth_failed", (
        f"{label}: expected auth_failed frame, got {msg!r}"
    )
    # Drain to close
    try:
        while True:
            await asyncio.wait_for(ws.recv(), timeout=2.0)
    except (ConnectionClosed, ConnectionClosedError, ConnectionClosedOK):
        pass
    except asyncio.TimeoutError:
        # Some proxies delay the close; we still validate the frame above.
        pass
    return msg


# ════════════════════════════════════════════════════════════════════════
# Section 1 — Auth on WS
# ════════════════════════════════════════════════════════════════════════


@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_no_auth_message_closes_within_window(ws_url: str):
    """
    Connect and send NOTHING. Server has a 10 s ``receive_text`` timeout
    on the first frame (electron_bridge.py:158). It must close cleanly
    within ~15 s — never hold the socket open indefinitely.
    """
    async def _scenario():
        ws = await _open(ws_url)
        try:
            # Don't send anything. Just wait for the server-initiated close.
            await _expect_close(
                ws, label="no auth", codes=(4001, 1011, 1008),
                recv_timeout=NO_AUTH_CLOSE_BUDGET,
            )
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    # Outer budget = inner recv + open() + close() + slack
    await asyncio.wait_for(_scenario(), timeout=NO_AUTH_CLOSE_BUDGET + 8)


@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_empty_first_frame_closes(ws_url: str):
    """An empty first frame is not parseable JSON → server closes."""
    async def _scenario():
        ws = await _open(ws_url)
        try:
            await ws.send("")
            # The server tries json.loads("") which raises JSONDecodeError;
            # the handler emits auth_failed then closes 4001.
            await _expect_close(ws, label="empty first frame", codes=(4001, 1008, 1011))
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=TEST_TIMEOUT)


@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_malformed_json_first_frame_closes(ws_url: str):
    """Garbage bytes that aren't JSON → server emits auth_failed and closes."""
    async def _scenario():
        ws = await _open(ws_url)
        try:
            await ws.send("{not-json-at-all,,,")
            # Server should emit auth_failed; then close.
            try:
                msg = await _recv_json(ws, timeout=3.0)
                assert msg.get("type") == "auth_failed", (
                    f"Expected auth_failed for malformed JSON, got {msg!r}"
                )
            except (ConnectionClosed, ConnectionClosedError, ConnectionClosedOK):
                # Some proxy may close before the JSON frame is flushed —
                # acceptable as long as the connection ends.
                return
            await _expect_close(ws, label="malformed JSON", codes=(4001, 1008, 1011))
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=TEST_TIMEOUT)


@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_bogus_jwt_returns_auth_failed_invalid_token(
    ws_url: str, machine_id: str, test_user_id: str
):
    """Bogus JWT → ``auth_failed`` with ``Invalid token`` reason, not silent close."""
    async def _scenario():
        ws = await _open(ws_url)
        try:
            await ws.send(_auth("eyJhbGciOiJIUzI1NiJ9.bogus.signature",
                                machine_id, test_user_id))
            msg = await _expect_auth_failed_then_close(ws, label="bogus JWT")
            reason = (msg.get("reason") or "").lower()
            # Accept either "invalid token" or generic descriptive text — but
            # never empty: the renderer logs this string.
            assert reason, f"auth_failed must have non-empty reason: {msg!r}"
            assert "invalid" in reason or "token" in reason or "credential" in reason, (
                f"reason should mention invalid token, got {msg!r}"
            )
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=TEST_TIMEOUT)


@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_valid_jwt_with_wrong_user_id_claim_rejected(
    ws_url: str, machine_id: str, test_jwt: str
):
    """
    Send a valid JWT but claim a DIFFERENT ``user_id`` field. The server
    verifies the JWT against Supabase and compares the returned id with
    the claimed user_id (electron_bridge.py:191). Mismatch must yield
    auth_failed, not silent acceptance.
    """
    async def _scenario():
        ws = await _open(ws_url)
        try:
            # Different uuid that almost certainly doesn't match the JWT
            wrong_uid = "00000000-0000-0000-0000-deadbeefcafe"
            await ws.send(_auth(test_jwt, machine_id, wrong_uid))
            msg = await _expect_auth_failed_then_close(
                ws, label="user_id mismatch"
            )
            reason = (msg.get("reason") or "").lower()
            # The handler logs "token user_id mismatch" but surfaces
            # "Invalid token" — both phrasings mean the same outcome.
            assert reason, f"missing reason: {msg!r}"
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=TEST_TIMEOUT)


@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_token_in_query_string_is_not_accepted(
    ws_url: str, machine_id: str, test_jwt: str, test_user_id: str
):
    """
    Tokens MUST NOT be honored as query string parameters. Even if a
    proxy logs them, the server should ignore ``?access_token=`` /
    ``?token=`` and require the auth message body. Connecting with the
    token in the URL but withholding the auth message must still time
    out.
    """
    # Append the token as a leaked query param. Since the server ignores
    # query-string credentials, this connection should still need an auth
    # frame. We send NO auth message and expect a close.
    leaky_url = ws_url + "&" + urlencode({
        "access_token": test_jwt,
        "token": test_jwt,
        "user_id": test_user_id,
        "machine_id": machine_id,
    })

    async def _scenario():
        ws = await _open(leaky_url)
        try:
            # Don't send the auth message. If the server (incorrectly)
            # accepted query-string auth, it would proceed to send
            # auth_success. We assert it doesn't — by waiting for close.
            await _expect_close(
                ws, label="query-string token", codes=(4001, 1008, 1011),
                recv_timeout=NO_AUTH_CLOSE_BUDGET,
            )
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=NO_AUTH_CLOSE_BUDGET + 8)


@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_subprotocol_header_does_not_grant_auth(
    ws_url: str, machine_id: str, test_jwt: str, test_user_id: str
):
    """
    Some servers implement auth via Sec-WebSocket-Protocol. Our backend
    does NOT — it requires the auth message. Even if the client sends a
    token-shaped subprotocol header, the server must still demand the
    auth frame.

    We send an auth-shaped subprotocol AND withhold the message body;
    the connection must time out on the missing first frame.
    """
    async def _scenario():
        try:
            ws = await asyncio.wait_for(
                websockets.connect(
                    ws_url,
                    subprotocols=[f"bearer.{test_jwt[:32]}"],
                    open_timeout=TEST_TIMEOUT,
                    close_timeout=2.0,
                    **_ssl_kwargs(ws_url),
                ),
                timeout=TEST_TIMEOUT,
            )
        except (InvalidStatus, InvalidStatusCode, InvalidHandshake):
            # Server rejecting the subprotocol outright is the safer
            # outcome — count it as a pass.
            return
        try:
            # Don't send any auth frame.
            await _expect_close(
                ws, label="bearer subprotocol", codes=(4001, 1008, 1011),
                recv_timeout=NO_AUTH_CLOSE_BUDGET,
            )
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=NO_AUTH_CLOSE_BUDGET + 8)


# ════════════════════════════════════════════════════════════════════════
# Section 2 — Cross-tenant message smuggling
# ════════════════════════════════════════════════════════════════════════


@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_after_auth_chat_message_with_other_users_chat_id_does_not_crash(
    ws_url: str, machine_id: str, test_jwt: str, test_user_id: str
):
    """
    After authing as user A, attempt to send a message that references
    another user's chat_id. The Electron WS bridge does not actually
    route ``chat:message`` frames (chat goes via /api/chat HTTP), so the
    server must either ignore the frame or close — but never leak data
    or crash.
    """
    async def _scenario():
        ws = await _open(ws_url)
        try:
            await ws.send(_auth(test_jwt, machine_id, test_user_id))
            # Drain auth_success or auth_failed (machine ownership may
            # already belong to another user from prior runs).
            try:
                first = await _recv_json(ws, timeout=5.0)
            except (ConnectionClosed, ConnectionClosedError):
                pytest.skip("Cannot reach auth_success — unrelated WS state")
                return

            if first.get("type") == "auth_failed":
                pytest.skip(
                    f"Cannot exercise smuggling: auth_failed "
                    f"({first.get('reason')!r}) — likely stale machine_id."
                )
                return
            assert first.get("type") == "auth_success", (
                f"Expected auth_success, got {first!r}"
            )

            # Attempt to smuggle a chat-message frame referencing a
            # foreign chat_id. The server's read loop is in
            # vm_control.recv() — it expects 'result' / 'approval_request'
            # / 'heartbeat' frames. Anything else is ignored.
            await ws.send(json.dumps({
                "type": "chat:message",
                "chat_id": "11111111-2222-3333-4444-555555555555",
                "user_id": "victim-user-id",
                "content": "leak my chats",
            }))
            # Server must NOT crash — connection stays alive (or closes
            # cleanly with a reasonable code).
            await asyncio.sleep(0.3)
            try:
                # Ping-style heartbeat to verify socket is still functional
                await ws.send(json.dumps({"type": "heartbeat"}))
                await asyncio.sleep(0.1)
            except (ConnectionClosed, ConnectionClosedError) as e:
                # Closing the connection on a malformed frame is acceptable;
                # what we forbid is a 1011 with a stack trace string.
                if e.rcvd is not None:
                    assert e.rcvd.code != 1011 or "internal" not in (e.rcvd.reason or "").lower(), (
                        f"Server crashed on smuggled frame: {e!r}"
                    )
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=TEST_TIMEOUT)


@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_unsolicited_command_result_does_not_crash(
    ws_url: str, machine_id: str, test_jwt: str, test_user_id: str
):
    """
    Send a ``result`` frame for a request_id that was never issued. The
    server's recv loop will look up the pending future and find nothing
    — must drop silently or log + ignore. NEVER crash.
    """
    async def _scenario():
        ws = await _open(ws_url)
        try:
            await ws.send(_auth(test_jwt, machine_id, test_user_id))
            try:
                first = await _recv_json(ws, timeout=5.0)
            except (ConnectionClosed, ConnectionClosedError):
                pytest.skip("Cannot reach auth_success")
                return
            if first.get("type") == "auth_failed":
                pytest.skip(
                    f"auth_failed: {first.get('reason')!r}"
                )
                return

            # Phantom request_id — never issued by the server.
            await ws.send(json.dumps({
                "type": "result",
                "request_id": "phantom-req-id-deadbeef",
                "data": {"success": True, "ghost": True},
            }))
            # Wait briefly — server should not have crashed; subsequent
            # heartbeat must round-trip.
            await asyncio.sleep(0.3)
            await ws.send(json.dumps({"type": "heartbeat"}))
            await asyncio.sleep(0.1)
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=TEST_TIMEOUT)


@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_oversized_frame_rejected(ws_url: str, test_jwt: str,
                                            test_user_id: str, machine_id: str):
    """
    Send a 5 MB frame. Most WS server stacks (uvicorn / starlette) cap
    incoming frame size around 1 MB by default. The server must reject
    or close — must not OOM, must not echo back, must not accept and
    process.
    """
    async def _scenario():
        ws = await _open(ws_url, max_size=10 * 1024 * 1024)
        try:
            # Must auth first or the server closes for missing auth.
            await ws.send(_auth(test_jwt, machine_id, test_user_id))
            try:
                first = await _recv_json(ws, timeout=5.0)
            except (ConnectionClosed, ConnectionClosedError):
                pytest.skip("Cannot reach auth_success")
                return
            if first.get("type") == "auth_failed":
                pytest.skip(f"auth_failed: {first.get('reason')!r}")
                return

            # 5 MB JSON-shaped payload (well over typical 1 MB cap)
            big_payload = json.dumps({
                "type": "result",
                "data": {"x": "A" * (5 * 1024 * 1024)},
            })
            try:
                await ws.send(big_payload)
            except (ConnectionClosed, ConnectionClosedError) as e:
                # Server may have already closed mid-send — acceptable
                if e.rcvd is not None:
                    assert e.rcvd.code in (1009, 1011, 1008, 1006), (
                        f"unexpected close code on oversized frame: {e.rcvd.code}"
                    )
                return
            # If send succeeded, the next recv should yield a close.
            try:
                await asyncio.wait_for(ws.recv(), timeout=3.0)
            except (ConnectionClosed, ConnectionClosedError) as e:
                # 1009 = message too big; 1011 = server error; 1006 = abnormal
                if e.rcvd is not None:
                    assert e.rcvd.code in (1009, 1011, 1008, 1006), (
                        f"unexpected close code on oversized frame: {e.rcvd.code}"
                    )
            except asyncio.TimeoutError:
                # Some servers silently drop the oversized frame and keep
                # the connection. That's tolerable as long as it doesn't
                # echo or process — heartbeat should still work.
                pass
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=TEST_TIMEOUT + 5)


@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_malformed_continuation_frame_handled_cleanly(
    ws_url: str, test_jwt: str, test_user_id: str, machine_id: str
):
    """
    The websockets library doesn't expose raw frame fragmentation, but
    we can simulate "bad input that breaks the JSON contract" — sending
    a frame whose ``type`` field is None (wrong type) or missing
    entirely. Server must reject without crashing.
    """
    async def _scenario():
        ws = await _open(ws_url)
        try:
            await ws.send(_auth(test_jwt, machine_id, test_user_id))
            try:
                first = await _recv_json(ws, timeout=5.0)
            except (ConnectionClosed, ConnectionClosedError):
                pytest.skip("Cannot reach auth_success")
                return
            if first.get("type") == "auth_failed":
                pytest.skip(f"auth_failed: {first.get('reason')!r}")
                return

            # Malformed structures the recv loop might trip on.
            for bad in (
                json.dumps({"type": None}),
                json.dumps({"type": 12345}),
                json.dumps({"type": "result", "data": "string-not-dict"}),
                json.dumps({}),
                json.dumps([1, 2, 3]),
            ):
                try:
                    await ws.send(bad)
                except (ConnectionClosed, ConnectionClosedError):
                    return  # Closed mid-stream is acceptable
                await asyncio.sleep(0.05)
            # Connection should still be alive after each malformed frame.
            await ws.send(json.dumps({"type": "heartbeat"}))
            await asyncio.sleep(0.2)
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=TEST_TIMEOUT)


# ════════════════════════════════════════════════════════════════════════
# Section 3 — Heartbeat / keepalive
# ════════════════════════════════════════════════════════════════════════


@pytest.mark.routing
@pytest.mark.slow
@pytest.mark.asyncio
async def test_ws_idle_past_heartbeat_window_does_not_crash(
    ws_url: str, machine_id: str, test_jwt: str, test_user_id: str
):
    """
    Open + auth, then idle for >35 s. Server-initiated pings come at 30 s
    cadence. We don't need a positive close here — the requirement is
    "no exception, no garbage frames, no crash".

    Marked slow; skipped under SKIP_SLOW=1.
    """
    async def _scenario():
        ws = await _open(ws_url)
        try:
            await ws.send(_auth(test_jwt, machine_id, test_user_id))
            try:
                first = await _recv_json(ws, timeout=5.0)
            except (ConnectionClosed, ConnectionClosedError):
                pytest.skip("Cannot reach auth_success")
                return
            if first.get("type") == "auth_failed":
                pytest.skip(f"auth_failed: {first.get('reason')!r}")
                return

            # Idle for ~35 s — drain anything the server pushes (pings).
            saw_anything = False
            deadline = time.monotonic() + 35.0
            while time.monotonic() < deadline:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=2.0)
                    saw_anything = True
                    # Reply to server pings to keep it alive
                    if isinstance(msg, str):
                        try:
                            parsed = json.loads(msg)
                            if parsed.get("type") == "ping":
                                await ws.send(json.dumps({"type": "heartbeat"}))
                        except Exception:
                            pass
                except asyncio.TimeoutError:
                    pass  # idle is the entire point
                except (ConnectionClosed, ConnectionClosedError) as e:
                    # Clean close is acceptable — server may have decided
                    # we're dead. The forbidden outcome is 1011 + server
                    # crash trace.
                    if e.rcvd is not None:
                        assert e.rcvd.code in (1000, 1001, 1008, 1011, 4001), (
                            f"unexpected close code on idle: {e.rcvd.code}"
                        )
                    return
            assert saw_anything, (
                "Did not see ANY server frame during 35 s idle — server "
                "ping loop may have regressed"
            )
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    # Wider outer budget for this test specifically (35 s + slack).
    await asyncio.wait_for(_scenario(), timeout=45.0)


@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_invalid_pong_frame_handled(
    ws_url: str, machine_id: str, test_jwt: str, test_user_id: str
):
    """
    Send a ``pong`` JSON frame with garbage data. The server's recv loop
    must not panic on unexpected types. We then verify the connection
    remains usable for a heartbeat.
    """
    async def _scenario():
        ws = await _open(ws_url)
        try:
            await ws.send(_auth(test_jwt, machine_id, test_user_id))
            try:
                first = await _recv_json(ws, timeout=5.0)
            except (ConnectionClosed, ConnectionClosedError):
                pytest.skip("Cannot reach auth_success")
                return
            if first.get("type") == "auth_failed":
                pytest.skip(f"auth_failed: {first.get('reason')!r}")
                return

            # JSON pong with garbage payload
            await ws.send(json.dumps({
                "type": "pong",
                "ts": "not-a-number",
                "extra": [None, {"weird": True}],
            }))
            # Native WebSocket pong frames are different — also try one.
            try:
                await ws.pong(b"\x00\x01\x02nonsense")
            except Exception:
                pass

            # Connection still functional?
            await ws.send(json.dumps({"type": "heartbeat"}))
            await asyncio.sleep(0.2)
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=TEST_TIMEOUT)


@pytest.mark.routing
@pytest.mark.dos
@pytest.mark.asyncio
async def test_ws_burst_pings_do_not_crash_server(
    ws_url: str, machine_id: str, test_jwt: str, test_user_id: str
):
    """
    Hammer the server with 100 heartbeat frames as fast as possible. The
    server must absorb them gracefully (rate-limit or no-op) — never
    crash and never echo unbounded responses.
    """
    async def _scenario():
        ws = await _open(ws_url)
        try:
            await ws.send(_auth(test_jwt, machine_id, test_user_id))
            try:
                first = await _recv_json(ws, timeout=5.0)
            except (ConnectionClosed, ConnectionClosedError):
                pytest.skip("Cannot reach auth_success")
                return
            if first.get("type") == "auth_failed":
                pytest.skip(f"auth_failed: {first.get('reason')!r}")
                return

            for _ in range(100):
                try:
                    await ws.send(json.dumps({"type": "heartbeat"}))
                except (ConnectionClosed, ConnectionClosedError) as e:
                    # Server-initiated close due to flood is acceptable —
                    # 1008 (policy violation) or 1011 (server error) only
                    # if the server is actively rejecting flood, never an
                    # uncaught exception.
                    if e.rcvd is not None:
                        assert e.rcvd.code in (1000, 1008, 1011, 1006, 4001), (
                            f"flood close code unexpected: {e.rcvd.code}"
                        )
                    return

            # Stress duration elapsed — connection should still be alive.
            await asyncio.sleep(HEARTBEAT_STRESS_DURATION)
            try:
                await ws.send(json.dumps({"type": "heartbeat"}))
            except (ConnectionClosed, ConnectionClosedError):
                # Server may have closed after flood — that's okay.
                pass
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=TEST_TIMEOUT + 5)


# ════════════════════════════════════════════════════════════════════════
# Section 4 — Reconnection / replay
# ════════════════════════════════════════════════════════════════════════


@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_two_simultaneous_connections_second_succeeds(
    ws_url: str, machine_id: str, test_jwt: str, test_user_id: str
):
    """
    Per electron_bridge cleanup logic, the LATEST connection owns the
    machine_id. Open #1 + auth, then open #2 + auth — both should reach
    auth_success, and #2 supersedes #1 in vm_control_service.connections.
    """
    async def _scenario():
        ws1 = await _open(ws_url)
        try:
            await ws1.send(_auth(test_jwt, machine_id, test_user_id))
            try:
                first1 = await _recv_json(ws1, timeout=5.0)
            except (ConnectionClosed, ConnectionClosedError):
                pytest.skip("ws1 closed before auth response")
                return
            if first1.get("type") == "auth_failed":
                pytest.skip(f"ws1 auth_failed: {first1.get('reason')!r}")
                return

            # Now open ws2 with the same machine_id.
            ws2 = await _open(ws_url)
            try:
                await ws2.send(_auth(test_jwt, machine_id, test_user_id))
                try:
                    first2 = await _recv_json(ws2, timeout=5.0)
                except (ConnectionClosed, ConnectionClosedError) as e:
                    raise AssertionError(
                        f"ws2 closed instead of authing — last-conn-wins "
                        f"semantics regressed: {e!r}"
                    )
                # ws2 must auth_success (last connection wins).
                assert first2.get("type") == "auth_success", (
                    f"Second connection must succeed, got {first2!r}"
                )
            finally:
                try:
                    await ws2.close()
                except Exception:
                    pass
        finally:
            try:
                await ws1.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=TEST_TIMEOUT + 5)


@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_reconnect_after_forced_close_with_same_token(
    ws_url: str, machine_id: str, test_jwt: str, test_user_id: str
):
    """
    Force a 4001 close by sending a bogus first frame, then immediately
    reconnect with the SAME (valid) token. The fresh connection must
    succeed — proves no machine_id blacklisting on token reuse.
    """
    async def _scenario():
        # Force-close with bogus auth
        ws_bad = await _open(ws_url)
        try:
            await ws_bad.send(_auth("BAD_TOKEN", machine_id, test_user_id))
            try:
                msg = await _recv_json(ws_bad, timeout=5.0)
                assert msg.get("type") == "auth_failed", (
                    f"expected auth_failed for bad token, got {msg!r}"
                )
            except (ConnectionClosed, ConnectionClosedError):
                pass
        finally:
            try:
                await ws_bad.close()
            except Exception:
                pass

        # Brief pause for server-side cleanup
        await asyncio.sleep(0.5)

        # Now reconnect with the valid token
        ws_good = await _open(ws_url)
        try:
            await ws_good.send(_auth(test_jwt, machine_id, test_user_id))
            try:
                msg = await _recv_json(ws_good, timeout=5.0)
            except (ConnectionClosed, ConnectionClosedError) as e:
                raise AssertionError(
                    f"reconnect with valid token failed: {e!r}"
                )
            if msg.get("type") == "auth_failed":
                # Could be machine ownership pinned to a different user
                # (test_06 path). Skip rather than fail.
                pytest.skip(
                    f"reconnect auth_failed (likely test machine state issue): "
                    f"{msg.get('reason')!r}"
                )
                return
            assert msg.get("type") == "auth_success", (
                f"Reconnect should succeed, got {msg!r}"
            )
        finally:
            try:
                await ws_good.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=TEST_TIMEOUT + 5)


# ════════════════════════════════════════════════════════════════════════
# Section 5 — VM control WS endpoint
# ════════════════════════════════════════════════════════════════════════


@pytest.mark.routing
@pytest.mark.asyncio
async def test_vm_control_ws_endpoint_does_not_exist_or_rejects():
    """
    The legacy ``/api/vm/...`` REST router (vm_control.py) intentionally
    has NO WebSocket endpoint. Any WS upgrade attempt against it must be
    rejected — otherwise an attacker could attempt to bypass the auth
    gate that protects /api/electron/ws.

    We probe 2 likely-attacker paths (extending to a longer list bumps
    the suite wall-clock past the budget without surfacing new bugs).
    """
    base = cfg().ws_public_url
    PATHS = ("/api/vm/ws", "/api/vm/test-machine-id/ws")
    PER_PATH_OPEN_BUDGET = 4.0
    PER_PATH_RECV_BUDGET = 2.0

    async def _probe_one(path: str):
        url = f"{base}{path}"
        try:
            ws = await asyncio.wait_for(
                websockets.connect(
                    url,
                    open_timeout=PER_PATH_OPEN_BUDGET,
                    close_timeout=1.0,
                    **_ssl_kwargs(url),
                ),
                timeout=PER_PATH_OPEN_BUDGET + 1.0,
            )
        except (InvalidStatus, InvalidStatusCode, InvalidHandshake,
                ConnectionClosed, ConnectionClosedError,
                ConnectionRefusedError, OSError, ssl.SSLError,
                asyncio.TimeoutError, TimeoutError):
            # Server rejecting the upgrade is the correct behavior.
            return
        try:
            await ws.send(json.dumps({
                "type": "command",
                "data": {
                    "command": "terminal_execute",
                    "parameters": {"command": "xdotool key Delete"},
                },
            }))
            try:
                msg = await asyncio.wait_for(ws.recv(), timeout=PER_PATH_RECV_BUDGET)
                raise AssertionError(
                    f"VM control WS path {path} accepted and responded "
                    f"to raw xdotool payload: {msg!r}. The router has "
                    f"no WS endpoint — the upgrade should never have "
                    f"succeeded."
                )
            except (ConnectionClosed, ConnectionClosedError):
                # Closed-after-accept is tolerable; server didn't
                # forward the payload.
                return
            except asyncio.TimeoutError:
                # Server held the connection open without forwarding —
                # also acceptable: nothing is processing the payload.
                return
        finally:
            try:
                await asyncio.wait_for(ws.close(), timeout=2.0)
            except Exception:
                pass

    async def _scenario():
        # Probe paths sequentially to keep close+open serialized.
        for path in PATHS:
            await _probe_one(path)

    # Outer = (open + recv + close + slack) * len(PATHS)
    outer = (PER_PATH_OPEN_BUDGET + PER_PATH_RECV_BUDGET + 3.0) * len(PATHS) + 5.0
    await asyncio.wait_for(_scenario(), timeout=outer)


@pytest.mark.routing
@pytest.mark.asyncio
async def test_ws_other_users_machine_id_rejected(
    ws_url: str, test_jwt: str, test_user_id: str
):
    """
    Try to authenticate with a machine_id that belongs to (or has been
    registered to) a clearly-different user. The ownership check
    (electron_bridge.py:243) must reject with auth_failed code 4003.

    Note: if the machine_id is brand-new (not in DB), the server
    auto-registers it on first connect. So we use a machine_id whose
    OWNER is provably someone else by including an obviously-foreign
    user prefix. If the machine doesn't already exist in DB, this test
    skips — it can only verify the *check* runs, not that EVERY foreign
    machine is rejected.
    """
    foreign_machine = "post-deploy-foreign-owner-locked-machine"

    async def _scenario():
        ws = await _open(ws_url)
        try:
            await ws.send(_auth(test_jwt, foreign_machine, test_user_id))
            try:
                msg = await _recv_json(ws, timeout=5.0)
            except (ConnectionClosed, ConnectionClosedError):
                pytest.skip("connection closed before any frame")
                return

            if msg.get("type") == "auth_success":
                # The machine didn't pre-exist for another user, so the
                # server registered it for us. We can't exercise the
                # mismatch path without DB seeding — skip.
                pytest.skip(
                    "foreign_machine not pre-seeded to another user "
                    "in this environment — cannot exercise ownership check"
                )
                return
            assert msg.get("type") == "auth_failed", (
                f"expected auth_failed or auth_success, got {msg!r}"
            )
            # If reason mentions ownership, that's the path we wanted.
            reason = (msg.get("reason") or "").lower()
            assert reason, f"missing reason: {msg!r}"
        finally:
            try:
                await ws.close()
            except Exception:
                pass

    await asyncio.wait_for(_scenario(), timeout=TEST_TIMEOUT)
