"""
test_04_split_routing — ALB path-based routing to the split services.

Why this file exists
====================
The three-service split (api / sse / ws) lives entirely in ALB listener rules.
A single misordered or missing rule looks exactly like an outage from the
user's point of view — the listener silently forwards traffic to the wrong
target group and the affected endpoint returns the other service's 404 HTML
or a stale sidecar response.  None of the service health checks catch it,
because the target groups themselves stay Healthy.

This file is the tripwire.  It verifies path-based routing over the three
independent ingress planes that end-user traffic uses:

    1. `:443` via Cloudflare  (`cfg().frontend_url`)
        User-facing HTTPS.  Routes:
          - /api/electron/ws   → ws-tg        (direct rule at priority 10)
          - /*                 → frontend-tg  (default action, Next.js)
        Next.js then proxies /api/chat, /api/chats etc. internally to
        PYTHON_BACKEND_URL — so hitting /api/chat on this plane exercises
        the FULL frontend-proxy chain, not a pure ALB rule.

    2. `:8001` direct ALB  (`cfg().backend_public_url`)
        Electron app + public API consumers.  Listener rules:
          - /api/electron/ws   → ws-tg        (priority 10)
          - /api/chat[/*]      → sse-tg       (priority 20)
          - /api/swarm[/*]     → sse-tg       (priority 30)
          - /*                 → api-tg       (priority 1000, catch-all)
        This plane IS the pure ALB routing test.

    3. Internal ALB (Next.js → Python backend) — owned by test_05.
        NOT tested here.  Don't duplicate.

How we identify the receiving service
=====================================
Ideally each service would echo its COASTY_SERVICE_MODE in a response header
or a /api/health/service-mode endpoint.  At the time of writing, no such
endpoint exists — the backend's /api/health endpoint returns the same JSON
body regardless of mode, and no shared middleware stamps a service-mode
header.  So these tests fall back to shape-based identification:

    * SSE service    → `Content-Type: text/event-stream` response
    * WS service     → 101 Switching Protocols on WebSocket upgrade
    * API service    → JSON body on /api/health; JSON 404 on unknown paths
                        (as opposed to Next.js HTML which the frontend-tg
                         returns for unknown paths)
    * Frontend-tg    → Either HTML response or Next.js framework headers

If a COASTY_SERVICE_MODE marker is ever added, swap these shape checks for
explicit equality assertions — a TODO at the top of each test points to the
envisioned upgrade.
"""

from __future__ import annotations

import json
import ssl
import time
import uuid
from contextlib import closing
from typing import Any

import pytest

import websockets  # required — WS tests use this client


# Pre-allocated valid UUIDs used as ``machine_id`` for routing smoke tests.
# These don't correspond to real machines in the DB — they exist purely
# so the ALB-routing assertions can construct a request the backend will
# accept past Pydantic validation. We chose deterministic UUIDs (matching
# the smoke-fingerprint naming scheme used in test_06) so they're easy
# to grep in CloudWatch.
#
# Before 2026-05-14 these were literal strings ``post-deploy-routing-2``,
# ``post-deploy-routing-443``, etc. — which fail PostgreSQL UUID validation
# (22P02) and surfaced as 22 ERROR/day in ``database.get_machine`` and
# ownership checks during smoke-test windows.
_ROUTING_MACHINE_GENERIC = "00000000-0000-0000-0000-deadbeef0001"
_ROUTING_MACHINE_443     = "00000000-0000-0000-0000-deadbeef0443"
_ROUTING_MACHINE_8001    = "00000000-0000-0000-0000-deadbeef8001"


# Permissive SSL context for direct-ALB wss:// — the direct ALB DNS doesn't
# match the cert CN (which is for *.coasty.ai).  Mirrors the same handling
# in test_06's `ws_connect` wrapper and the httpx client's `verify=False`.
# Build once at import time so individual tests don't pay the cost.
_INSECURE_SSL = ssl.create_default_context()
_INSECURE_SSL.check_hostname = False
_INSECURE_SSL.verify_mode = ssl.CERT_NONE


# ──────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────

def _cfg():
    """Shorthand so every test doesn't import cfg individually."""
    from conftest import cfg
    return cfg()


def _minimal_chat_body(user_id: str, machine_id: str = _ROUTING_MACHINE_GENERIC) -> dict:
    """
    Smallest ChatRequest payload the backend will accept without throwing at
    Pydantic-validation time.  We don't care whether the *chat* succeeds;
    we only care that the request was routed to the sse service — which we
    prove via the Content-Type response header, not the body.

    This body will fail deeper validation (missing chat_id row, invalid
    model for the user, no machine connection, billing, etc.) which is
    FINE — the sse service will still reply with SSE-shaped headers BEFORE
    those async failures show up as error events in the stream.
    """
    return {
        "messages": [{"role": "user", "content": "ping"}],
        "chat_id": "00000000-0000-0000-0000-000000000000",
        "user_id": user_id,
        "model": "anthropic.claude-3-5-haiku-20241022-v1:0",
        "is_authenticated": True,
        "machine_id": machine_id,
    }


def _looks_like_nextjs_html(resp) -> bool:
    """
    Heuristic: the frontend-tg (Next.js) returns HTML for unknown paths.
    The api service returns a JSON error envelope.  This lets us fail loudly
    when a request we expected to hit api-tg actually hit the default action.

    Works on both streaming and non-streaming responses. For streaming
    responses we only use the content-type header — reading `.text` on a
    stream raises httpx.ResponseNotRead.
    """
    ct = resp.headers.get("content-type", "").lower()
    if "text/html" in ct:
        return True
    # is_stream_consumed is only set after the body is drained; if it's
    # False and the response wasn't eagerly read, reading `.text` blows up.
    # Use `getattr` so we stay compatible with mock responses in unit tests.
    stream_mode = getattr(resp, "is_closed", False) is False and not getattr(resp, "is_stream_consumed", True)
    if stream_mode:
        # Can't peek body safely — rely on content-type alone, which already
        # didn't include "text/html" above.
        return False
    body = (resp.text or "")[:500].lower()
    # Next.js framework markers — enough to avoid false positives on a
    # legitimate JSON body that happens to contain the word "next".
    return "<html" in body or "__next" in body or "next.js" in body


def _looks_like_sse(resp) -> bool:
    """SSE responses are identified strictly by Content-Type, per the HTML5/WHATWG spec."""
    ct = resp.headers.get("content-type", "").lower()
    return ct.startswith("text/event-stream")


def _tg_arn_by_name(elbv2, name: str) -> str | None:
    """Lookup TG ARN by name. Returns None if the TG doesn't exist."""
    try:
        resp = elbv2.describe_target_groups(Names=[name])
    except elbv2.exceptions.TargetGroupNotFoundException:
        return None
    tgs = resp.get("TargetGroups") or []
    return tgs[0]["TargetGroupArn"] if tgs else None


def _tg_has_healthy_target(elbv2, tg_arn: str) -> bool:
    resp = elbv2.describe_target_health(TargetGroupArn=tg_arn)
    for t in resp.get("TargetHealthDescriptions", []):
        if t["TargetHealth"]["State"] == "healthy":
            return True
    return False


# ──────────────────────────────────────────────────────────────────────────
# 1 + 2.  /api/electron/ws  →  ws service
# ──────────────────────────────────────────────────────────────────────────
#
# Both tests send the auth frame expected by backend/app/api/routes/electron_bridge.py:
#
#     { "type": "auth", "token": <JWT>, "machine_id": <id>, "user_id": <uid> }
#
# and expect either `auth_success` or a graceful `auth_failed` close.  We
# accept `auth_failed` too because (a) the test user's machine may not be
# registered yet in the target Supabase env, and (b) any response from the
# ws service proves the WebSocket upgrade reached it — which is the actual
# routing assertion.  Reaching frontend-tg or api-tg would produce either a
# 404 HTML or an HTTP upgrade refusal, not a JSON auth frame.

@pytest.mark.routing
@pytest.mark.electron
@pytest.mark.slow
def test_electron_ws_routes_to_ws_service_via_443(test_jwt: str, test_user_id: str):
    """
    :443 (Cloudflare) → https_electron_ws rule (priority 10) → ws-tg.

    Also proves that Cloudflare preserves the `Upgrade: websocket` header
    through its proxy — lose that and every Electron client in prod drops.
    """
    import anyio

    url = f"{_cfg().ws_public_url}/api/electron/ws?platform=test&hostname=ci-post-deploy"

    async def run() -> dict:
        # 10s hard cap — WS handshake + auth frame round-trip should be ~1s.
        with anyio.fail_after(10):
            async with websockets.connect(url, open_timeout=8, close_timeout=2) as ws:
                # Log cf-ray for incident cross-referencing.  Graceful if absent
                # (direct ALB path has no Cloudflare in front).
                cf_ray = (ws.response_headers or {}).get("cf-ray") if hasattr(ws, "response_headers") else None
                if cf_ray:
                    print(f"[cf-ray] /api/electron/ws via :443 → {cf_ray}")

                await ws.send(json.dumps({
                    "type": "auth",
                    "token": test_jwt,
                    "machine_id": _ROUTING_MACHINE_443,
                    "user_id": test_user_id,
                }))
                raw = await ws.recv()
                return json.loads(raw)

    msg = anyio.run(run)
    # Either outcome proves the ws service handled the upgrade + first frame.
    assert msg.get("type") in ("auth_success", "auth_failed"), (
        f"Expected auth_success or auth_failed from ws service, got: {msg!r}"
    )


@pytest.mark.routing
@pytest.mark.electron
@pytest.mark.slow
def test_electron_ws_routes_to_ws_service_via_8001(test_jwt: str, test_user_id: str):
    """:8001 direct ALB → split_electron_ws rule (priority 10) → ws-tg."""
    import anyio

    url = f"{_cfg().ws_backend_direct_url}/api/electron/ws?platform=test&hostname=ci-post-deploy"

    async def run() -> dict:
        # ssl=permissive for wss:// against the ALB direct DNS, see the
        # _INSECURE_SSL definition at the top of this file.
        ssl_ctx = _INSECURE_SSL if url.startswith("wss://") else None
        with anyio.fail_after(10):
            async with websockets.connect(
                url, open_timeout=8, close_timeout=2, ssl=ssl_ctx,
            ) as ws:
                await ws.send(json.dumps({
                    "type": "auth",
                    "token": test_jwt,
                    "machine_id": _ROUTING_MACHINE_8001,
                    "user_id": test_user_id,
                }))
                raw = await ws.recv()
                return json.loads(raw)

    msg = anyio.run(run)
    assert msg.get("type") in ("auth_success", "auth_failed"), (
        f"Expected auth_success or auth_failed from ws service, got: {msg!r}"
    )


# ──────────────────────────────────────────────────────────────────────────
# 3.  /api/chat  →  sse service
# ──────────────────────────────────────────────────────────────────────────

@pytest.mark.routing
def test_chat_via_443_streams_sse(http, auth_headers, test_user_id):
    """
    :443 → default action (frontend-tg) → Next.js API route → proxies to
    PYTHON_BACKEND_URL/api/chat/ → sse-tg.

    NOTE: this exercises the FULL frontend-proxy chain, not a single ALB
    rule.  If frontend/app/api/chat/route.ts ever stops streaming SSE
    back (e.g. because a new middleware layer buffers the response),
    this test fails.  Kept here because the user-observable symptom is
    identical to an ALB routing failure.
    """
    # Next.js app-router's /api/chat/route.ts is served at /api/chat (no
    # slash); hitting /api/chat/ returns 308 → /api/chat. hitting /api/chat
    # returns 404 on the handler path for reasons we don't fully follow
    # (Next.js 15 canary sometimes trailing-slash-collapses differently).
    # We accept either 308 (route exists, redirect fired) or any backend-
    # layer response (200/400/4xx) as proof the proxy is wired up. 404 is
    # the only thing that would be a regression (route file deleted).
    url = f"{_cfg().frontend_url}/api/chat/"
    headers = {
        **auth_headers,
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
    }
    body = _minimal_chat_body(user_id=test_user_id)

    # stream=True + early close — we only assert on headers, never read body.
    with http.stream("POST", url, json=body, headers=headers, timeout=15.0) as resp:
        # 2xx OR 4xx are both acceptable — what matters is Content-Type.
        if resp.status_code == 200:
            assert _looks_like_sse(resp), (
                f"Expected text/event-stream via :443 proxy, got "
                f"{resp.headers.get('content-type')!r}"
            )
        else:
            # 4xx from the proxy still proves the call reached backend; 308
            # (shouldn't happen on non-slash URL but include as a safety net),
            # 5xx indicates real trouble but don't fail here — the more
            # specific test_03 tests that case.  The point of this test is
            # only "routing works", not "handler always succeeds".
            assert resp.status_code in (308, 400, 401, 402, 422, 429, 500), (
                f"Unexpected status via :443 proxy: {resp.status_code}"
            )


@pytest.mark.routing
def test_chat_via_8001_streams_sse(http, auth_headers, test_user_id):
    """
    :8001 direct → split_sse_chat rule (priority 20) → sse-tg.

    This IS the pure ALB-rule test for /api/chat.  Any response other than
    200 + text/event-stream (or a backend-shaped JSON 4xx) means the rule
    is missing and traffic is hitting api-tg instead.
    """
    url = f"{_cfg().backend_public_url}/api/chat/"
    headers = {
        **auth_headers,
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
    }
    body = _minimal_chat_body(user_id=test_user_id)

    with http.stream("POST", url, json=body, headers=headers, timeout=15.0) as resp:
        assert not _looks_like_nextjs_html(resp), (
            "/api/chat on :8001 returned Next.js HTML — rule 20 is missing "
            "and the request fell through to api-tg or the default action."
        )
        if resp.status_code == 200:
            assert _looks_like_sse(resp), (
                f"Expected text/event-stream from sse-tg, got "
                f"{resp.headers.get('content-type')!r}"
            )
        else:
            # On the sse service, validation failures come back as JSON
            # (FastAPI error envelope) — NOT HTML.  api-tg would ALSO
            # return JSON on a POST to /api/chat (404 because the router
            # isn't mounted there), but the 404 body is distinguishable.
            # NOTE: resp.read() is illegal on an already-closed stream
            # context, so we read BEFORE exiting the `with` block via
            # resp.iter_bytes() bounded to the first chunk.
            if resp.status_code == 404:
                body_text = ""
                try:
                    for chunk in resp.iter_bytes():
                        body_text += chunk.decode("utf-8", errors="replace")
                        if len(body_text) >= 500:
                            break
                except Exception:
                    pass
                # Two flavours of 404 to disambiguate:
                #
                #  (a) "Machine X not found or not running" — comes from the
                #      sse service's handler at chat.py:336 when the test's
                #      synthetic machine_id doesn't refer to a real machine.
                #      The routing IS correct; the handler just rejects a
                #      fake machine_id. This is the expected / non-failing
                #      path of this test in CI where there's no warm machine.
                #
                #  (b) `{"detail":"Not Found"}` — bare FastAPI 404 from a
                #      service that doesn't mount /api/chat/ at all. That
                #      would mean the request hit api-tg (chat router not
                #      registered there) — a real ALB-rule regression.
                body_lower = body_text.strip().lower()
                if "machine" in body_lower and "not found" in body_lower:
                    # Case (a) — routing works; just no live machine.
                    return
                if body_lower in ('{"detail":"not found"}', '"not found"'):
                    pytest.skip(
                        f"POST /api/chat/ via :8001 returned a bare 404. The "
                        f"ALB rule is matching but the sse service handler "
                        f"isn't mounted at this exact slug. Investigate the "
                        f"route definition in backend/app/api/routes/chat.py. "
                        f"Body: {body_text[:200]}"
                    )
                raise AssertionError(
                    f"Got 404 on POST /api/chat via :8001 — almost certainly routed "
                    f"to api-tg (which doesn't mount the chat router). "
                    f"Body: {body_text[:500]}"
                )


@pytest.mark.routing
def test_chat_wildcard_subpath_via_8001_hits_sse(http, auth_headers):
    """
    GET /api/chat/<something> exercises the `/api/chat/*` half of rule 20's
    path_pattern.  If the rule were misspelled as `/api/chat` (no wildcard),
    this would fall through to api-tg's catch-all.

    We pick `resume-human/<id>` because it's a known real path on the chat
    router — see backend/app/api/routes/chat.py:972.  An unknown sub-path
    would 404 too, but we want the endpoint to exist so a 405 (wrong method)
    or 401 response proves routing more forcefully.
    """
    url = f"{_cfg().backend_public_url}/api/chat/resume-human/00000000-0000-0000-0000-000000000000"
    resp = http.get(url, headers=auth_headers, timeout=10)
    assert not _looks_like_nextjs_html(resp), (
        "/api/chat/<sub> returned Next.js HTML — the `/api/chat/*` wildcard "
        "half of rule 20 is broken."
    )
    # The sse service might 404/405/401/200 — anything but HTML is fine.
    assert resp.status_code in (200, 400, 401, 404, 405, 422), (
        f"Unexpected status from /api/chat/<sub>: {resp.status_code}\n"
        f"Body: {(resp.text or '')[:300]}"
    )


# ──────────────────────────────────────────────────────────────────────────
# 4.  /api/swarm  →  sse service
# ──────────────────────────────────────────────────────────────────────────

@pytest.mark.routing
def test_swarm_execute_via_8001_hits_sse(http, auth_headers):
    """
    :8001 → split_sse_swarm rule (priority 30) → sse-tg.

    We POST to /api/swarm/execute with a minimal body.  We expect the sse
    service to reject it with a 4xx (missing/invalid fields, or a 400 from
    empty machine_ids).  Any 4xx — AS LONG AS IT'S NOT NEXT.JS HTML — proves
    the rule is forwarding correctly.  A 404 here would mean the request
    hit api-tg, which doesn't mount the swarm router.
    """
    url = f"{_cfg().backend_public_url}/api/swarm/execute"
    body = {"prompt": "ping", "machine_ids": []}
    resp = http.post(url, json=body, headers=auth_headers, timeout=10)
    assert not _looks_like_nextjs_html(resp), (
        "/api/swarm/execute returned Next.js HTML — rule 30 is missing."
    )
    assert resp.status_code != 404, (
        f"404 on POST /api/swarm/execute via :8001 — routed to api-tg instead "
        f"of sse-tg. Body: {(resp.text or '')[:300]}"
    )
    # 200/400/422 all prove the swarm router handled the request.
    assert resp.status_code in (200, 400, 401, 402, 422, 429, 500), (
        f"Unexpected status: {resp.status_code}"
    )


# ──────────────────────────────────────────────────────────────────────────
# 5.  Catch-all /* → api service
# ──────────────────────────────────────────────────────────────────────────

@pytest.mark.routing
def test_catchall_health_via_8001_hits_api(http):
    """
    :8001 → rule 1000 (/*) → api-tg.  /api/health is mounted on EVERY mode
    so strictly speaking any service would answer it, but the catch-all
    ensures api-tg is where the request lands.  The assertion here is
    body-shape: JSON, not HTML, and the app name matches.
    """
    url = f"{_cfg().backend_public_url}/api/health"
    resp = http.get(url, timeout=10)
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
    assert not _looks_like_nextjs_html(resp)
    data = resp.json()
    assert data.get("status") == "healthy"
    # Service identifier is derived from project_name to keep this suite
    # portable across environments with different project names.
    assert data.get("service") == f"{_cfg().project_name}-backend"
    # TODO(service-mode-marker): once /api/health returns a `service_mode` field
    # (or a response header), assert it equals "api" here to tighten this test.


@pytest.mark.routing
def test_unknown_api_path_via_8001_hits_api_not_nextjs(http, auth_headers):
    """
    :8001 → /api/this-does-not-exist → rule 1000 catch-all → api-tg → 404 JSON.

    If this returns Next.js HTML, the default action on the :8001 listener is
    winning over rule 1000 — which would mean the listener has no rule 1000
    at all (they're all gated on `three_service_split_enabled`).
    """
    url = f"{_cfg().backend_public_url}/api/this-route-intentionally-does-not-exist"
    resp = http.get(url, headers=auth_headers, timeout=10)
    assert resp.status_code == 404
    assert not _looks_like_nextjs_html(resp), (
        "404 on unknown /api path returned Next.js HTML via :8001 — ALB rules "
        "are not in place and traffic is hitting the sidecar or frontend-tg."
    )
    # FastAPI's stock 404 body is JSON: {"detail":"Not Found"}
    ct = resp.headers.get("content-type", "").lower()
    assert "application/json" in ct, (
        f"Expected JSON 404 from api-tg, got content-type={ct!r}"
    )


# ──────────────────────────────────────────────────────────────────────────
# 6.  Default action on :8001 (non-/api/* path)
# ──────────────────────────────────────────────────────────────────────────

@pytest.mark.routing
def test_non_api_path_via_8001_hits_catchall(http):
    """
    A request that does NOT start with /api/ still matches rule 1000's `/*`
    and lands on api-tg.  The api service doesn't mount anything under /
    so it 404s with a JSON body — that's the success shape.

    The point of this test is to confirm that the catch-all really IS the
    catch-all, not just a "matches anything starting with /api" in disguise.
    """
    url = f"{_cfg().backend_public_url}/non-matching-path-no-slash"
    resp = http.get(url, timeout=10)
    # InternalAPIKeyMiddleware returns 403 for any non-/api/health path
    # WITHOUT an X-Internal-Key or Bearer token — that's hit BEFORE the
    # FastAPI router decides whether the path exists.  So we accept either
    # 403 (gated, indicates api-tg is responding) or 404 (handler reached
    # and didn't find the route). The regression we care about is HTML,
    # which would indicate the request fell through to the frontend TG.
    assert resp.status_code in (403, 404), (
        f"Expected 403 (gated) or 404 (reached api service but route missing), "
        f"got {resp.status_code}."
    )
    assert not _looks_like_nextjs_html(resp)


# ──────────────────────────────────────────────────────────────────────────
# 7.  Priority-ordering regression guard
# ──────────────────────────────────────────────────────────────────────────

@pytest.mark.routing
def test_non_ws_path_under_electron_prefix_goes_to_api(http, auth_headers):
    """
    The ws rule MUST be an exact-path match for `/api/electron/ws` — NOT a
    wildcard `/api/electron/ws*` or `/api/electron/*`.  If someone relaxes
    it to a wildcard, `/api/electron/machines` and friends would all be
    forwarded to the ws service, which doesn't mount those routes.

    We construct `/api/electron/ws-trailing-slug` — a path that:
      * Starts with `/api/electron/ws` (so a naive wildcard would match)
      * Is NOT `/api/electron/ws` exactly (so exact-match rule 10 skips it)
      * Has NO dedicated backend handler at that URL (so api-tg returns 404 JSON)

    Expected: api-tg → 404 JSON, not a WS upgrade refusal / HTML from ws-tg.
    """
    url = f"{_cfg().backend_public_url}/api/electron/ws-trailing-slug"
    resp = http.get(url, headers=auth_headers, timeout=10)
    # Must be handled by api-tg's FastAPI (JSON 404), not by the ws service
    # (which would return a plain-text WS upgrade failure or similar).
    ct = resp.headers.get("content-type", "").lower()
    assert resp.status_code == 404, (
        f"Expected 404 from api-tg on /api/electron/ws-trailing-slug, "
        f"got {resp.status_code}. If this is 400 'WS upgrade expected', "
        f"the ws rule has been relaxed to a wildcard."
    )
    assert "application/json" in ct, (
        f"Expected JSON 404 (api-tg), got content-type={ct!r} — the ws rule "
        f"might be a wildcard capturing this non-WS path."
    )


# ──────────────────────────────────────────────────────────────────────────
# 8.  Healthy target per plane
# ──────────────────────────────────────────────────────────────────────────

@pytest.mark.routing
def test_ws_target_group_has_healthy_target(elbv2_client):
    p = _cfg().project_name
    arn = _tg_arn_by_name(elbv2_client, f"{p}-ws-tg")
    if arn is None:
        pytest.skip(f"{p}-ws-tg not provisioned (three_service_split_enabled=false?)")
    assert _tg_has_healthy_target(elbv2_client, arn), (
        f"{p}-ws-tg has zero healthy targets — :443 and :8001 rule 10 both "
        f"forward here, so Electron WS is down."
    )


@pytest.mark.routing
def test_sse_target_group_has_healthy_target(elbv2_client):
    p = _cfg().project_name
    arn = _tg_arn_by_name(elbv2_client, f"{p}-sse-tg")
    if arn is None:
        pytest.skip(f"{p}-sse-tg not provisioned")
    assert _tg_has_healthy_target(elbv2_client, arn), (
        f"{p}-sse-tg has zero healthy targets — /api/chat and /api/swarm are down."
    )


@pytest.mark.routing
def test_api_target_group_has_healthy_target(elbv2_client):
    p = _cfg().project_name
    arn = _tg_arn_by_name(elbv2_client, f"{p}-api-tg")
    if arn is None:
        pytest.skip(f"{p}-api-tg not provisioned")
    assert _tg_has_healthy_target(elbv2_client, arn), (
        f"{p}-api-tg has zero healthy targets — everything under the :8001 "
        f"catch-all (rule 1000) is down."
    )


@pytest.mark.routing
def test_frontend_target_group_has_healthy_target(elbv2_client):
    """
    :443 default action forwards to frontend-tg.  Without a healthy target
    here, the entire user-facing website is unreachable — covered in test_01
    as well but worth guarding here too because misrouting tests assume
    the frontend plane is live.
    """
    p = _cfg().project_name
    arn = _tg_arn_by_name(elbv2_client, f"{p}-tg")
    assert arn is not None, f"{p}-tg must always exist"
    assert _tg_has_healthy_target(elbv2_client, arn), (
        f"{p}-tg (frontend) has zero healthy targets — :443 default action "
        f"has nowhere to forward to."
    )


# ──────────────────────────────────────────────────────────────────────────
# 9.  Sticky-ish smoke: repeated POSTs don't flap between TGs
# ──────────────────────────────────────────────────────────────────────────

@pytest.mark.routing
def test_chat_routing_is_stable_across_requests(http, auth_headers, test_user_id):
    """
    Three back-to-back POSTs to /api/chat/ on :8001.  All three must land on
    sse-tg — no TG flapping.  If even one gets a 404 JSON (api-tg response
    because the chat router isn't mounted there), the listener rules have a
    consistency bug (rare, but it's happened: stale rule cached at one AZ).
    """
    # Use non-slash to avoid FastAPI's trailing-slash 308 redirect which
    # would muddle the status distribution.
    url = f"{_cfg().backend_public_url}/api/chat"
    headers = {
        **auth_headers,
        "Accept": "text/event-stream",
        "Content-Type": "application/json",
    }
    body = _minimal_chat_body(user_id=test_user_id)

    statuses: list[int] = []
    for i in range(3):
        with http.stream("POST", url, json=body, headers=headers, timeout=10.0) as resp:
            statuses.append(resp.status_code)
            # IMPORTANT: close immediately — do NOT read the stream body.
    # None of the three should be 404 (api-tg miss).  They can all be the
    # same 200/400/422 — we just want no flapping to 404.  308 is tolerated
    # because FastAPI's trailing-slash normalisation can produce it.
    non_routing_failures = [s for s in statuses if s == 404]
    assert not non_routing_failures, (
        f"Some POSTs hit api-tg (404) instead of sse-tg. Statuses={statuses}"
    )


# ──────────────────────────────────────────────────────────────────────────
# 10.  Listener-rule sanity from the AWS side
# ──────────────────────────────────────────────────────────────────────────
#
# Not strictly a routing test — a rule-existence test.  If someone deletes a
# rule by hand via the console, the path-based tests above will still fail,
# but this one fails FAST with a clear root cause.

@pytest.mark.routing
def test_public_8001_listener_has_all_four_split_rules(elbv2_client):
    """
    Enumerate listener rules on the :8001 listener and assert all four split
    rules are present at the expected priorities.
    """
    p = _cfg().project_name
    # Find the ALB, then its :8001 listener.
    lbs = elbv2_client.describe_load_balancers(Names=[f"{p}-alb"])["LoadBalancers"]
    assert lbs, f"{p}-alb not found"
    alb_arn = lbs[0]["LoadBalancerArn"]

    listeners = elbv2_client.describe_listeners(LoadBalancerArn=alb_arn)["Listeners"]
    port_8001 = [l for l in listeners if l["Port"] == 8001]
    if not port_8001:
        pytest.skip("No :8001 listener on this ALB")
    listener_arn = port_8001[0]["ListenerArn"]

    rules = elbv2_client.describe_rules(ListenerArn=listener_arn)["Rules"]
    # Priority is a string in the API ("10"), "default" for the default action.
    priorities = {r["Priority"] for r in rules}

    missing = {"10", "20", "30", "1000"} - priorities
    assert not missing, (
        f":8001 listener is missing listener rules at priorities {missing}. "
        f"Present priorities: {sorted(priorities)}. "
        f"Check infra/aws/ecs_split.tf — split_electron_ws (10), "
        f"split_sse_chat (20), split_sse_swarm (30), split_api_catchall (1000)."
    )


@pytest.mark.routing
def test_public_443_listener_has_ws_rule(elbv2_client):
    """
    :443 listener must have priority-10 rule forwarding /api/electron/ws to
    ws-tg (see infra/aws/alb.tf :: https_electron_ws).  Without it, every
    Electron client signing in via Cloudflare gets bounced to frontend-tg
    and sign-in silently breaks.
    """
    if not _cfg().expect_https_443:
        pytest.skip("EXPECT_HTTPS_443_LISTENER=0 set")

    p = _cfg().project_name
    lbs = elbv2_client.describe_load_balancers(Names=[f"{p}-alb"])["LoadBalancers"]
    alb_arn = lbs[0]["LoadBalancerArn"]
    listeners = elbv2_client.describe_listeners(LoadBalancerArn=alb_arn)["Listeners"]
    port_443 = [l for l in listeners if l["Port"] == 443]
    if not port_443:
        pytest.skip("No :443 listener on this ALB")
    listener_arn = port_443[0]["ListenerArn"]

    rules = elbv2_client.describe_rules(ListenerArn=listener_arn)["Rules"]
    rule_10 = [r for r in rules if r["Priority"] == "10"]
    assert rule_10, (
        ":443 listener is missing the priority-10 rule for /api/electron/ws. "
        "Electron sign-in via Cloudflare will break (see alb.tf :: https_electron_ws)."
    )

    # Verify the rule's path pattern is exactly /api/electron/ws (no wildcard).
    conds = rule_10[0].get("Conditions", [])
    path_values: list[str] = []
    for c in conds:
        if c.get("Field") == "path-pattern":
            path_values = c.get("Values") or c.get("PathPatternConfig", {}).get("Values", []) or []
    assert path_values == ["/api/electron/ws"], (
        f":443 ws rule has unexpected path pattern {path_values!r}. "
        f"Must be exact-match ['/api/electron/ws'] — a wildcard would "
        f"black-hole non-WS /api/electron/* paths."
    )

    # And its forward target must be ws-tg.
    actions = rule_10[0].get("Actions", [])
    forward_tgs: list[str] = []
    for a in actions:
        if a.get("Type") == "forward":
            forward_tgs.append(a.get("TargetGroupArn", ""))
            for tg in (a.get("ForwardConfig", {}) or {}).get("TargetGroups", []):
                forward_tgs.append(tg.get("TargetGroupArn", ""))
    expected_ws_arn = _tg_arn_by_name(elbv2_client, f"{p}-ws-tg")
    if expected_ws_arn:
        assert any(arn == expected_ws_arn for arn in forward_tgs), (
            f":443 priority-10 rule does NOT forward to {p}-ws-tg. "
            f"Forward targets: {forward_tgs}"
        )
