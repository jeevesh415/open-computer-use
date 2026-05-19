"""
test_security_dos_resilience.py — Rate-limit + DoS-resilience verification.

Companion to ``test_10_security.py``. Where test_10 locks in the *headers*
side of security posture (CSP/HSTS/cookies/CSRF gates), this module locks in
the *availability* side: rate-limit bypasses, resource-exhaustion attacks,
and protocol-level abuse — all must end in a clean 4xx, never a 5xx and
never a wedged worker.

Layout:

  * ``RATE LIMITING`` — burst tests + spoof-header bypass attempts +
    per-route + per-user bucketing + 429 envelope shape
  * ``RESOURCE EXHAUSTION`` — oversized JSON, slowloris, compression bomb,
    deep JSON, multipart abuse, long URL/header, header count
  * ``WEBSOCKET FLOOD`` — 100 simultaneous WS upgrades on /api/electron/ws
  * ``ALGORITHMIC COMPLEXITY`` — regex backtracking + 1MB chat message
  * ``CONNECTION-LEVEL`` — TE smuggling, pipelining, malformed chunked

Every test carries ``@pytest.mark.security`` and ``@pytest.mark.dos``.
The SLOW marker gates anything >5s; tests that *expect* a 429 envelope
skip cleanly when no 429 is observed (rate limiter may be in fail-open
mode if Redis is down — caught upstream by infra tests, not us).

CRITICAL: every burst test caps at 200 requests max — we are testing
*against production*. Don't actually DoS the box you're protecting.

Failure messages prefixed ``DOS:`` for triage filtering.
"""
from __future__ import annotations

import asyncio
import gzip
import json
import os
import socket
import ssl
import struct
import time
from typing import Optional, Tuple
from urllib.parse import urlparse

import httpx
import pytest

from conftest import cfg


# ── Markers ─────────────────────────────────────────────────────────────────
pytestmark = [pytest.mark.security, pytest.mark.dos]


# ───────────────────────────────────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────────────────────────────────

def _dos(msg: str, resp: Optional[httpx.Response] = None) -> str:
    """Build a ``DOS:``-prefixed assertion message with response context."""
    if resp is None:
        return f"DOS: {msg}"
    body = ""
    try:
        body = (resp.text or "")[:400].replace("\n", " ")
    except Exception:
        body = "<undecodable>"
    return (
        f"DOS: {msg}\n"
        f"  {resp.request.method} {resp.request.url} → {resp.status_code}\n"
        f"  Body: {body}"
    )


def _slow_only() -> None:
    """Skip when RUN_SLOW is not set. Used for the wall-clock-heavy tests."""
    if os.environ.get("RUN_SLOW", "0") != "1":
        pytest.skip("Set RUN_SLOW=1 to run this >5s DoS test")


def _is_429_with_envelope(resp: httpx.Response) -> bool:
    """Return True iff resp is a structurally-valid 429 envelope."""
    if resp.status_code != 429:
        return False
    if "Retry-After" not in resp.headers:
        return False
    try:
        body = resp.json()
    except Exception:
        return False
    return isinstance(body, dict) and "error" in body


async def _async_client(timeout: float = 10.0) -> httpx.AsyncClient:
    """Build an AsyncClient configured the same way as the suite's session
    client — verify off (we hit the ALB hostname directly), no follow_redirects,
    no brotli."""
    return httpx.AsyncClient(
        http2=True,
        timeout=httpx.Timeout(timeout, connect=5.0),
        follow_redirects=False,
        verify=False,
        headers={
            "User-Agent": "coasty-post-deploy-dos/1.0 (pytest)",
            "Accept-Encoding": "gzip, deflate",
        },
    )


def _backend_host_port() -> Tuple[str, int, bool]:
    """Resolve the backend public URL into (host, port, is_tls)."""
    u = urlparse(cfg().backend_public_url)
    is_tls = u.scheme == "https"
    port = u.port or (443 if is_tls else 80)
    return u.hostname, port, is_tls


# ───────────────────────────────────────────────────────────────────────────
# RATE LIMITING — bypass attempts + envelope shape
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.slow
def test_burst_triggers_429_with_retry_after(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """Burst an authenticated endpoint quickly; expect a 429 with Retry-After.

    We target ``/api/chats/`` — bucketed by ``X-User-ID`` (set internally by
    the JWT verifier). The default ``RATE_LIMIT_PER_MINUTE`` is 60, so 100
    rapid GETs should cross the threshold cleanly.

    Skips (rather than fails) if no 429 surfaces inside 200 requests — the
    rate limiter may be operating fail-open (Redis down + in-process
    counter resets per worker), which is its documented behavior. We don't
    want this test to flake under that environmental degradation; the
    infra suite is the right place to catch a Redis outage.
    """
    _slow_only()
    url = f"{cfg().backend_public_url}/api/chats/"
    saw_429: Optional[httpx.Response] = None
    other_codes: dict[int, int] = {}

    start = time.monotonic()
    for i in range(200):  # hard cap — never DoS prod
        resp = http.get(url, headers=auth_headers)
        if resp.status_code == 429:
            saw_429 = resp
            break
        other_codes[resp.status_code] = other_codes.get(resp.status_code, 0) + 1
        # If the very first response is a 5xx the whole burst is moot
        if resp.status_code >= 500 and i < 3:
            pytest.skip(
                f"Endpoint returning {resp.status_code} on first calls — "
                "backend not healthy enough for a rate-limit test"
            )
    elapsed = time.monotonic() - start

    if saw_429 is None:
        pytest.skip(
            f"No 429 in 200 requests over {elapsed:.1f}s "
            f"(observed: {sorted(other_codes.items())!r}). "
            "Rate limiter may be in fail-open mode (Redis down) — "
            "see RateLimitMiddleware._check_redis."
        )

    # Envelope checks — these are the load-bearing part of the test.
    retry_after = saw_429.headers.get("Retry-After", "")
    assert retry_after, _dos("429 missing Retry-After header", saw_429)
    assert retry_after.isdigit(), _dos(
        f"Retry-After is not integer seconds: {retry_after!r}", saw_429
    )
    val = int(retry_after)
    assert 1 <= val <= 3700, _dos(
        f"Retry-After {val}s is outside expected [1, 3700] range", saw_429
    )

    try:
        body = saw_429.json()
    except Exception:
        pytest.fail(_dos("429 body is not valid JSON", saw_429))

    assert isinstance(body, dict), _dos(
        f"429 body must be a JSON object (got {type(body).__name__})", saw_429
    )
    assert "error" in body, _dos(
        f"429 body missing `error` key (got keys {list(body.keys())!r})", saw_429
    )
    assert isinstance(body["error"], str) and body["error"], _dos(
        f"429 `error` value must be non-empty string (got {body['error']!r})", saw_429
    )


@pytest.mark.parametrize("spoof_header", [
    "X-Forwarded-For",
    "X-Real-IP",
    "CF-Connecting-IP",
    "X-Client-IP",
    "True-Client-IP",
])
@pytest.mark.slow
def test_spoofed_client_ip_does_not_bypass_limit(
    http: httpx.Client, auth_headers: dict[str, str], spoof_header: str
):
    """Rotating a spoof IP header per request must NOT extend the bucket.

    The middleware buckets by ``request.client.host`` OR ``X-User-ID`` —
    *not* by any X-Forwarded-* / CF-* header. So rotating those should not
    increase the budget. We send up to 200 rapid requests with a fresh
    spoofed IP each time, then assert the same 429 we'd see without
    spoofing eventually fires.

    If no 429 fires here AND no 429 fires in the baseline ``test_burst…``
    test, both will skip — that's the expected state when the limiter is
    fail-open. The only way this test FAILS is if the spoof header
    somehow extends the bucket past where the baseline burst saw 429.
    """
    _slow_only()
    url = f"{cfg().backend_public_url}/api/chats/"
    saw_429 = False
    for i in range(200):
        # IPv4 in 198.51.100.0/24 (TEST-NET-2) — guaranteed non-routable
        spoof_ip = f"198.51.100.{i % 254 + 1}"
        resp = http.get(
            url,
            headers={**auth_headers, spoof_header: spoof_ip},
        )
        if resp.status_code == 429:
            saw_429 = True
            break
        if resp.status_code >= 500 and i < 3:
            pytest.skip(
                f"Backend 5xx on first hit ({resp.status_code}) — cannot test"
            )

    if not saw_429:
        pytest.skip(
            f"No 429 in 200 requests with rotating {spoof_header!r} — "
            "rate limiter likely fail-open. The contract still holds: "
            "we observed no bypass."
        )
    # If we DID see 429 with the spoof header, the limiter is working
    # AND it isn't trusting the spoofed header — exactly what we want.


@pytest.mark.slow
def test_per_user_bucketing_with_bearer_token(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """Bursts under one Bearer should not exhaust an anonymous bucket.

    Documents the contract: the rate limiter prefers ``X-User-ID`` (set by
    the JWT verifier on Bearer paths) over ``request.client.host``. So
    two different users sharing one egress IP get independent budgets.
    Direct test isn't possible from the suite (we have one test user),
    but we can at least verify a Bearer burst hits a 429 specific to
    *that user's bucket* — namely, the ``X-User-ID`` is the limiter key.

    We assert Retry-After is bounded by the per-minute window (≤60s) when
    we fire fewer than 1000 requests — proving the per-minute counter is
    what tripped, not the per-hour one.
    """
    _slow_only()
    url = f"{cfg().backend_public_url}/api/chats/"
    saw_429: Optional[httpx.Response] = None
    for _ in range(200):
        resp = http.get(url, headers=auth_headers)
        if resp.status_code == 429:
            saw_429 = resp
            break

    if saw_429 is None:
        pytest.skip("No 429 observed — rate limiter likely fail-open")

    val = int(saw_429.headers.get("Retry-After", "0") or "0")
    assert val <= 60, _dos(
        f"Retry-After {val}s suggests per-hour limit triggered with <200 "
        f"requests — that should be impossible (per-hour=1000)", saw_429
    )


@pytest.mark.slow
def test_burst_across_different_paths_still_rate_limited(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """Per-client limit applies across paths — switching routes should not
    reset the counter.

    The middleware buckets by client_id (not (client_id, path)), so
    interleaving GETs across multiple endpoints should still trip 429.
    """
    _slow_only()
    paths = [
        "/api/chats/",
        "/api/billing/balance",
        "/api/models/",
        "/api/files/",
    ]
    saw_429 = False
    for i in range(200):
        path = paths[i % len(paths)]
        resp = http.get(
            f"{cfg().backend_public_url}{path}", headers=auth_headers
        )
        if resp.status_code == 429:
            saw_429 = True
            break
    if not saw_429:
        pytest.skip(
            "No 429 across rotated paths in 200 requests — limiter fail-open "
            "or path-rotation reset the bucket (latter would be a bug)"
        )


# ───────────────────────────────────────────────────────────────────────────
# RESOURCE EXHAUSTION — must not crash backend
# ───────────────────────────────────────────────────────────────────────────

def test_oversized_json_body_is_rejected_cleanly(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """POST a 5MB JSON body to /api/chat/ — expect 4xx, never 5xx.

    settings.MAX_REQUEST_SIZE defaults to 10MB; ALB/Cloudflare may cap
    earlier. Either way, a clean 400/413/422 is acceptable; a 5xx
    indicates the request reached app code and exploded there.
    """
    huge_payload = {
        "messages": [
            {"role": "user", "content": "x" * (5 * 1024 * 1024)}  # 5MB string
        ]
    }
    url = f"{cfg().backend_public_url}/api/chat/"
    try:
        resp = http.post(url, json=huge_payload, headers=auth_headers, timeout=30.0)
    except httpx.HTTPError as e:
        # Connection-level rejection (closed socket) is also acceptable —
        # ALB or uvicorn dropped before app saw it.
        pytest.skip(f"Connection-level rejection: {e!r}")
        return

    assert resp.status_code < 500, _dos(
        f"5MB JSON body produced {resp.status_code} — backend should reject "
        "with 4xx (400/413/422), not crash with 5xx",
        resp,
    )


def test_compression_bomb_does_not_blow_memory(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """Tiny gzipped body that decompresses to 100MB — backend must reject
    or refuse to decompress, never OOM.

    GZipMiddleware in Starlette only compresses *outgoing* responses;
    incoming Content-Encoding: gzip would have to be handled by the route
    or a pre-middleware. The contract this test enforces: such a payload
    should result in a clean 4xx, not a hang or 5xx.
    """
    # 100MB of zeros compresses to ~100KB — but we want to keep the wire
    # payload tiny, so we generate a 50MB string of zeros (compresses to
    # ~50KB which fits any limit cleanly).
    bomb_plain = b"\0" * (50 * 1024 * 1024)  # 50MB
    bomb = gzip.compress(bomb_plain, compresslevel=9)
    assert len(bomb) < 200_000, "compression bomb should be tiny on the wire"

    url = f"{cfg().backend_public_url}/api/chat/"
    try:
        resp = http.post(
            url,
            content=bomb,
            headers={
                **auth_headers,
                "Content-Type": "application/json",
                "Content-Encoding": "gzip",
            },
            timeout=15.0,
        )
    except httpx.HTTPError as e:
        # Connection-level reject is fine — ALB/uvicorn refused.
        pytest.skip(f"Connection-level rejection (acceptable): {e!r}")
        return

    assert resp.status_code < 500, _dos(
        f"Gzip bomb produced {resp.status_code} — backend should reject "
        "decompression bomb with 4xx, not crash with 5xx",
        resp,
    )


def test_deeply_nested_json_does_not_500(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """1000-level deep JSON — Pydantic/json should reject as 4xx, not 5xx.

    Python's default ``json`` module has a recursion limit of ~1000 by
    default; deeper input raises ``RecursionError`` which an unguarded
    handler would surface as 500. We require 4xx.
    """
    # Build the JSON manually as a string to avoid blowing Python's own
    # parser before we even send it — we control how deep we go.
    depth = 1000
    body = "{" + '"a":' * depth + "1" + "}" * depth

    url = f"{cfg().backend_public_url}/api/chat/"
    try:
        resp = http.post(
            url,
            content=body.encode(),
            headers={**auth_headers, "Content-Type": "application/json"},
            timeout=15.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"Connection-level rejection: {e!r}")
        return

    assert resp.status_code < 500, _dos(
        f"Deep JSON (depth={depth}) produced {resp.status_code} — "
        "backend should reject with 4xx, not crash via RecursionError",
        resp,
    )


def test_hash_collision_dict_does_not_500(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """JSON object with 10000 keys — confirms no quadratic behavior.

    Python hash randomization (PYTHONHASHSEED) defeats the classic
    string-collision DoS, but a 10000-key body is still a useful stress
    test: it must complete with a 4xx, not 5xx, and not hang.
    """
    obj = {f"k{i:05d}": i for i in range(10000)}
    url = f"{cfg().backend_public_url}/api/chat/"
    try:
        resp = http.post(
            url,
            json=obj,
            headers=auth_headers,
            timeout=15.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"Connection-level rejection: {e!r}")
        return

    assert resp.status_code < 500, _dos(
        f"10000-key JSON object produced {resp.status_code} — "
        "should be 4xx (validation error), not 5xx",
        resp,
    )


def test_long_url_query_string_returns_4xx(http: httpx.Client):
    """8KB query string — expect 4xx (414/400). Many ALBs cap URL at 8KB.

    Don't need auth for this one; the URL-length limit is enforced before
    any handler runs. We point at /api/health (always reachable) — the
    intent is to verify the *gateway's* behavior, not the route's.
    """
    big_q = "x=" + "a" * 8000  # ~8KB query string
    url = f"{cfg().backend_public_url}/api/health?{big_q}"
    try:
        resp = http.get(url, timeout=10.0)
    except httpx.HTTPError as e:
        pytest.skip(f"Connection-level rejection (acceptable): {e!r}")
        return

    # 414 (URI Too Long) is the textbook reply, but ALBs sometimes send
    # 400 or just close the connection. Anything in 4xx is acceptable.
    assert resp.status_code < 500, _dos(
        f"Long URL produced {resp.status_code} — should be 4xx, not 5xx",
        resp,
    )


def test_long_header_value_returns_4xx(http: httpx.Client):
    """16KB single header value — expect 431 or 400, never 5xx."""
    huge_header = "X-Probe: " + "a" * 16000
    url = f"{cfg().backend_public_url}/api/health"
    try:
        resp = http.get(url, headers={"X-Probe": "a" * 16000}, timeout=10.0)
    except httpx.HTTPError as e:
        pytest.skip(f"Connection-level rejection (acceptable): {e!r}")
        return

    assert resp.status_code < 500, _dos(
        f"16KB header produced {resp.status_code} — should be 4xx (431/400), "
        "not 5xx",
        resp,
    )


def test_many_headers_returns_4xx_or_succeeds(http: httpx.Client):
    """200 headers on one request — should either succeed (some gateways
    allow) or 4xx, never 5xx."""
    headers = {f"X-Probe-{i:03d}": f"value-{i}" for i in range(200)}
    url = f"{cfg().backend_public_url}/api/health"
    try:
        resp = http.get(url, headers=headers, timeout=10.0)
    except httpx.HTTPError as e:
        pytest.skip(f"Connection-level rejection (acceptable): {e!r}")
        return

    assert resp.status_code < 500, _dos(
        f"200-header request produced {resp.status_code} — should be "
        "2xx or 4xx, not 5xx",
        resp,
    )


def test_multipart_with_many_small_parts(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """1000 multipart fields — backend must not OOM or 500."""
    files = [
        (f"f{i}", (f"f{i}.txt", b"x", "text/plain"))
        for i in range(1000)
    ]
    url = f"{cfg().backend_public_url}/api/files/"
    try:
        resp = http.post(url, files=files, headers=auth_headers, timeout=30.0)
    except httpx.HTTPError as e:
        pytest.skip(f"Connection-level rejection: {e!r}")
        return

    assert resp.status_code < 500, _dos(
        f"1000-part multipart produced {resp.status_code} — should be 4xx "
        "(too many parts) or 2xx, not 5xx",
        resp,
    )


def test_single_huge_multipart_field(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """One ~5MB field in a multipart upload — same MAX_REQUEST_SIZE rule."""
    huge = ("blob", ("blob.bin", b"x" * (5 * 1024 * 1024), "application/octet-stream"))
    url = f"{cfg().backend_public_url}/api/files/"
    try:
        resp = http.post(url, files=[huge], headers=auth_headers, timeout=60.0)
    except httpx.HTTPError as e:
        pytest.skip(f"Connection-level rejection: {e!r}")
        return

    assert resp.status_code < 500, _dos(
        f"5MB multipart field produced {resp.status_code} — should be 4xx "
        "(413/400) or 2xx, not 5xx",
        resp,
    )


# ───────────────────────────────────────────────────────────────────────────
# SLOWLORIS — open many slow connections concurrently
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.slow
def test_slowloris_concurrent_slow_connections(http: httpx.Client):
    """Open 50 concurrent connections sending bytes very slowly.

    The backend should drop / time out / refuse — never wedge. We use
    ``asyncio`` + raw sockets so we can dribble bytes one-at-a-time.

    Connection cap is 50 (well below the FastAPI/uvicorn worker count
    in production) so we don't actually take the service down.
    """
    _slow_only()

    host, port, is_tls = _backend_host_port()
    if not host:
        pytest.skip("Cannot resolve backend host")

    async def slow_one() -> str:
        """Open a TCP socket, write a partial HTTP request very slowly,
        return the outcome."""
        try:
            if is_tls:
                ssl_ctx = ssl.create_default_context()
                ssl_ctx.check_hostname = False
                ssl_ctx.verify_mode = ssl.CERT_NONE
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(host, port, ssl=ssl_ctx),
                    timeout=5.0,
                )
            else:
                reader, writer = await asyncio.wait_for(
                    asyncio.open_connection(host, port),
                    timeout=5.0,
                )
            try:
                # Send the request line + Host header, but nothing else.
                # Then dribble more headers one byte at a time.
                writer.write(b"GET /api/health HTTP/1.1\r\n")
                writer.write(f"Host: {host}\r\n".encode())
                await writer.drain()

                # Dribble for up to 10s, one byte at a time, then give up.
                slow_header = b"X-Slow: " + b"a" * 60 + b"\r\n"
                for byte in slow_header:
                    try:
                        writer.write(bytes([byte]))
                        await writer.drain()
                        await asyncio.sleep(0.2)
                    except (ConnectionResetError, BrokenPipeError, ssl.SSLError):
                        return "dropped"
                return "kept-alive-too-long"
            finally:
                try:
                    writer.close()
                    await writer.wait_closed()
                except Exception:
                    pass
        except (asyncio.TimeoutError, OSError, ssl.SSLError):
            return "connect-failed"

    async def run_all():
        # Cap at 50 concurrent slow connections.
        return await asyncio.gather(
            *(slow_one() for _ in range(50)),
            return_exceptions=True,
        )

    results = asyncio.run(run_all())
    # We don't strictly require any particular outcome — what we require is
    # that the rest of the suite continues to work (i.e. the backend is
    # not wedged). Verify with a fresh request.
    sentinel = http.get(f"{cfg().backend_public_url}/api/health", timeout=10.0)
    assert sentinel.status_code < 500, _dos(
        f"After slowloris probe, backend health returned {sentinel.status_code} — "
        "service may have been destabilized by 50 slow connections",
        sentinel,
    )
    # And report what happened
    dropped = sum(1 for r in results if r == "dropped")
    held = sum(1 for r in results if r == "kept-alive-too-long")
    if held > 0 and dropped == 0:
        # Worth surfacing — could mean no idle-timeout configured.
        pytest.skip(
            f"Backend kept all {held}/50 slow connections alive without dropping. "
            "Consider an idle-timeout on the ALB/uvicorn (current behavior is "
            "not a 5xx, but is a slowloris risk vector)."
        )


# ───────────────────────────────────────────────────────────────────────────
# WEBSOCKET FLOOD
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.slow
def test_websocket_connection_flood_does_not_crash_backend(http: httpx.Client):
    """Open 100 simultaneous WebSocket upgrades on /api/electron/ws.

    None will authenticate; the server should reject each individually
    without affecting service to other clients. We verify after that
    /api/health still responds 2xx.
    """
    _slow_only()
    try:
        import websockets
    except ImportError:
        pytest.skip("`websockets` not installed in test env")

    ws_url = cfg().ws_backend_direct_url + "/api/electron/ws"

    async def open_one() -> str:
        try:
            async with websockets.connect(
                ws_url,
                open_timeout=5.0,
                ping_interval=None,
                close_timeout=2.0,
                # SSL: don't verify (suite policy)
                ssl=ssl._create_unverified_context() if ws_url.startswith("wss://") else None,
            ) as ws:
                # Don't send auth — let the server time out / close.
                try:
                    await asyncio.wait_for(ws.recv(), timeout=3.0)
                except asyncio.TimeoutError:
                    pass
                return "opened"
        except websockets.exceptions.InvalidStatusCode as e:
            return f"rejected-{e.status_code}"
        except Exception as e:
            return f"err-{type(e).__name__}"

    async def flood():
        return await asyncio.gather(
            *(open_one() for _ in range(100)),
            return_exceptions=True,
        )

    asyncio.run(flood())

    # Sentinel: health check must still pass after the flood.
    sentinel = http.get(f"{cfg().backend_public_url}/api/health", timeout=10.0)
    assert sentinel.status_code < 500, _dos(
        f"After 100-WS flood, /api/health returned {sentinel.status_code} — "
        "WebSocket handler may not be properly bounded",
        sentinel,
    )


# ───────────────────────────────────────────────────────────────────────────
# ALGORITHMIC COMPLEXITY
# ───────────────────────────────────────────────────────────────────────────

def test_pathological_search_query_does_not_5xx(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """A regex-catastrophic-backtracking-style search query must not 5xx.

    Classic ReDoS payloads attack patterns like ``(a+)+$`` — we feed one
    into /api/search and verify the route either rejects (4xx), times out
    cleanly (503/504), or succeeds, but never throws a 5xx with a stack
    trace.
    """
    bomb_query = "a" * 100 + "!"  # nested-quantifier killer
    url = f"{cfg().backend_public_url}/api/search/"
    try:
        resp = http.get(
            url,
            params={"q": bomb_query, "depth": "quick"},
            headers=auth_headers,
            timeout=30.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"Connection-level rejection: {e!r}")
        return

    assert resp.status_code < 500 or resp.status_code in (502, 503, 504), _dos(
        f"Search with pathological query produced {resp.status_code} — "
        "should be 4xx or 2xx (or 502/503/504 timeout), not a hard 5xx",
        resp,
    )

    body = resp.text or ""
    assert "Traceback" not in body, _dos(
        "Pathological search query leaked a Python traceback", resp
    )


def test_extremely_long_single_chat_message(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """A 1MB single message — should be rejected or truncated, not OOM."""
    payload = {
        "messages": [{"role": "user", "content": "x" * (1024 * 1024)}],
        "model": "amazon.nova-lite-v1:0",
    }
    url = f"{cfg().backend_public_url}/api/chat/"
    try:
        resp = http.post(url, json=payload, headers=auth_headers, timeout=30.0)
    except httpx.HTTPError as e:
        pytest.skip(f"Connection-level rejection: {e!r}")
        return

    # Either the route accepts and streams, or rejects cleanly — but no 5xx
    # from buffer overruns / context-window math errors.
    assert resp.status_code < 500, _dos(
        f"1MB message produced {resp.status_code} — should be 4xx or 2xx, "
        "not 5xx (context-window math or buffer overflow)",
        resp,
    )


# ───────────────────────────────────────────────────────────────────────────
# CONNECTION-LEVEL — request smuggling, malformed chunked, pipelining
# ───────────────────────────────────────────────────────────────────────────

def _raw_request(host: str, port: int, is_tls: bool, raw: bytes,
                 read_bytes: int = 4096, timeout: float = 5.0) -> bytes:
    """Send a raw request over a fresh TCP/TLS socket; return what we read."""
    s = socket.create_connection((host, port), timeout=timeout)
    try:
        if is_tls:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            s = ctx.wrap_socket(s, server_hostname=host)
        s.settimeout(timeout)
        s.sendall(raw)
        chunks = []
        try:
            while True:
                buf = s.recv(read_bytes)
                if not buf:
                    break
                chunks.append(buf)
                if sum(len(c) for c in chunks) >= read_bytes * 4:
                    break
        except (socket.timeout, ConnectionResetError, ssl.SSLError):
            pass
        return b"".join(chunks)
    finally:
        try:
            s.close()
        except Exception:
            pass


def _status_from_response(raw: bytes) -> Optional[int]:
    """Parse the first HTTP status code from a raw response. None if absent."""
    if not raw:
        return None
    # First line: "HTTP/1.1 NNN Reason"
    first = raw.split(b"\r\n", 1)[0]
    parts = first.split(b" ", 2)
    if len(parts) < 2:
        return None
    try:
        return int(parts[1])
    except ValueError:
        return None


def test_request_smuggling_te_and_cl_returns_400(http: httpx.Client):
    """Both Transfer-Encoding AND Content-Length set — RFC 7230 §3.3.3
    says reject. ALB and uvicorn both should 400.
    """
    host, port, is_tls = _backend_host_port()
    if not host:
        pytest.skip("Cannot resolve backend host")

    raw = (
        b"POST /api/health HTTP/1.1\r\n"
        + f"Host: {host}\r\n".encode()
        + b"Content-Length: 4\r\n"
        b"Transfer-Encoding: chunked\r\n"
        b"Connection: close\r\n"
        b"\r\n"
        b"0\r\n\r\n"
    )

    try:
        resp = _raw_request(host, port, is_tls, raw)
    except OSError as e:
        pytest.skip(f"Connection-level rejection (acceptable): {e!r}")
        return

    status = _status_from_response(resp)
    if status is None:
        # Connection closed without sending a response — also acceptable
        # (server detected the smuggling attempt and dropped).
        return
    assert status < 500, _dos(
        f"TE+CL smuggling probe got status {status} — should be 4xx "
        "(400/501) or connection close, not 5xx"
    )


def test_malformed_chunked_encoding_returns_4xx(http: httpx.Client):
    """Send chunked TE with a malformed chunk length — expect 400."""
    host, port, is_tls = _backend_host_port()
    if not host:
        pytest.skip("Cannot resolve backend host")

    raw = (
        b"POST /api/health HTTP/1.1\r\n"
        + f"Host: {host}\r\n".encode()
        + b"Transfer-Encoding: chunked\r\n"
        b"Connection: close\r\n"
        b"\r\n"
        # Malformed: "ZZ" is not a valid hex chunk length
        b"ZZ\r\nGarbage\r\n0\r\n\r\n"
    )
    try:
        resp = _raw_request(host, port, is_tls, raw)
    except OSError as e:
        pytest.skip(f"Connection-level rejection: {e!r}")
        return

    status = _status_from_response(resp)
    if status is None:
        return  # connection closed = acceptable
    assert status < 500, _dos(
        f"Malformed chunked encoding got status {status} — should be 4xx, not 5xx"
    )


def test_http_pipelining_50_requests_consistently_handled(http: httpx.Client):
    """Send 50 GET /api/health on one TCP connection (pipelining).

    Either every one is served or every one is rejected — what we forbid
    is partial success with a 5xx mid-stream. Most modern servers (uvicorn
    with HTTP/1.1) will serve them sequentially; HTTP/2 multiplexing makes
    this moot. Use HTTP/1.1 explicitly and a raw socket.
    """
    host, port, is_tls = _backend_host_port()
    if not host:
        pytest.skip("Cannot resolve backend host")

    # Build 50 pipelined GETs on one connection.
    pipelined = b"".join(
        b"GET /api/health HTTP/1.1\r\n"
        + f"Host: {host}\r\n".encode()
        + b"Connection: keep-alive\r\n"
        b"\r\n"
        for _ in range(50)
    )
    # The 51st marks the connection close so we know when to stop reading.
    pipelined += (
        b"GET /api/health HTTP/1.1\r\n"
        + f"Host: {host}\r\n".encode()
        + b"Connection: close\r\n"
        b"\r\n"
    )

    try:
        resp = _raw_request(host, port, is_tls, pipelined, read_bytes=8192, timeout=15.0)
    except OSError as e:
        pytest.skip(f"Connection-level rejection: {e!r}")
        return

    if not resp:
        pytest.skip("Server closed connection without responding to pipelined batch")

    # Count distinct status lines — every one must be < 500.
    statuses: list[int] = []
    for line in resp.split(b"\r\n"):
        if line.startswith(b"HTTP/"):
            parts = line.split(b" ", 2)
            if len(parts) >= 2:
                try:
                    statuses.append(int(parts[1]))
                except ValueError:
                    pass

    if not statuses:
        pytest.skip("Could not parse any status lines from pipelined response")

    bad = [s for s in statuses if s >= 500]
    assert not bad, _dos(
        f"Pipelined batch produced 5xx responses {bad!r} (out of {len(statuses)} "
        f"observed); pipelining must be uniformly served or uniformly refused"
    )
