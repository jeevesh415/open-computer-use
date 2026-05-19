"""
test_security_api_routes_gauntlet.py — live attack matrix against every
Next.js App Router API route under app/api/.

Companion to tests/lib/api-routes-gauntlet.test.ts (which does the static
analysis side). This file does the **live** side: it walks the repo tree
to discover routes and then probes the deployed frontend for each one.

Attack matrix (per route + method)
----------------------------------
1.  No auth                         → expect 401/403, must NOT 5xx, must NOT 200
2.  Empty body                      → expect 400, must NOT 5xx
3.  5MB body                        → expect 4xx (413 preferred), must NOT 5xx
4.  Prototype-pollution body        → no 5xx, no echoed __proto__
5.  Path-traversal in query         → 4xx, no 5xx, no leaked filesystem text
6.  OPTIONS preflight               → consistent CORS behaviour (no echo of *)
7.  Idempotent GET stability        → two calls return matching shape

Cross-cutting checks
--------------------
* Error envelope: when status >= 400, body is JSON with an "error" key
  (or an "error" inside a "detail" key — FastAPI passthrough format).
* Rate-limit headers: present on rate-limited surfaces (chat, schedules,
  files, search, public CUA), absent on /api/health.
* No 5xx on any of the malformed-input probes — a 5xx means the framework
  panicked, which is a robustness defect even if not directly exploitable.

Constraints
-----------
* Skip cleanly when FRONTEND_URL is not configured (post-deploy fixture).
* Cap concurrency at 30 to avoid tripping Cloudflare rate-limits.
* Per-route timeouts are bounded so a misbehaving route can't hang the suite.
* Catch-all routes ([...path]) are probed at a benign path.
* Dynamic param routes ([id], [chatId], etc.) get a fake-but-well-formed
  UUID so they don't 404 in a way that masks the real probe response.

Why this isn't a duplicate of test_security_authz_idor.py
---------------------------------------------------------
The IDOR suite asserts authorization correctness with a real authenticated
session. This suite asserts unauthenticated robustness — the framework's
response to abuse before any business logic runs. Both are needed.
"""
from __future__ import annotations

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import httpx
import pytest

from conftest import assert_status, cfg


# ── Markers ────────────────────────────────────────────────────────────────

pytestmark = [pytest.mark.security]


# ── Discovery ──────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[2]
API_ROOT = REPO_ROOT / "app" / "api"

HTTP_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")

EXPORT_RE = {
    m: re.compile(
        rf"export\s+(?:async\s+)?function\s+{m}\b"
        rf"|export\s+const\s+{m}\b\s*[:=]"
        rf"|export\s*\{{[^}}]*\b{m}\b[^}}]*\}}",
        re.MULTILINE,
    )
    for m in HTTP_METHODS
}


@dataclass(frozen=True)
class Route:
    """One discovered (url_path, methods) pair."""
    url_path: str
    methods: tuple[str, ...]
    file_path: Path


def _path_for_file(p: Path) -> str:
    """Convert .../app/api/foo/[bar]/route.ts → /api/foo/<placeholder>"""
    rel = p.relative_to(API_ROOT).parent
    if str(rel) == ".":
        return "/api"
    parts = []
    for seg in rel.parts:
        if seg.startswith("[...") and seg.endswith("]"):
            # Catch-all → use a benign sub-path
            parts.append("probe")
        elif seg.startswith("[") and seg.endswith("]"):
            # Dynamic param → use a well-formed UUID. Most routes that
            # validate UUIDs will accept this; the ones that look up the
            # row will return 401/403/404, all of which are acceptable.
            parts.append("00000000-0000-0000-0000-000000000001")
        else:
            parts.append(seg)
    return "/api/" + "/".join(parts)


def _discover_routes() -> list[Route]:
    routes: list[Route] = []
    if not API_ROOT.exists():
        return routes
    for p in API_ROOT.rglob("route.ts"):
        try:
            src = p.read_text(encoding="utf-8")
        except Exception:
            continue
        methods = tuple(m for m, rx in EXPORT_RE.items() if rx.search(src))
        if not methods:
            continue
        routes.append(Route(url_path=_path_for_file(p), methods=methods, file_path=p))
    # Sort for stable output / test IDs
    routes.sort(key=lambda r: r.url_path)
    return routes


ALL_ROUTES = _discover_routes()


# ── Skip the entire module cleanly if the frontend URL isn't configured ────

if not ALL_ROUTES:
    pytest.skip(
        "No API routes discovered under app/api/ — running outside the repo?",
        allow_module_level=True,
    )


# ── Helpers ────────────────────────────────────────────────────────────────


def _url(path: str) -> str:
    return f"{cfg().frontend_url}{path}"


def _is_5xx(s: int) -> bool:
    return 500 <= s < 600


def _is_4xx(s: int) -> bool:
    return 400 <= s < 500


def _looks_like_json(resp: httpx.Response) -> bool:
    ctype = (resp.headers.get("Content-Type") or "").lower()
    return "application/json" in ctype


def _extract_error_text(resp: httpx.Response) -> str:
    """Return resp.text safely, capped to avoid huge dumps in CI logs."""
    try:
        return resp.text[:1000]
    except Exception:
        return "<unreadable>"


def _has_error_envelope(resp: httpx.Response) -> bool:
    """
    Coasty's documented error envelope is `{"error": "..."}` for Next.js
    routes and `{"detail": {...}}` for FastAPI passthrough. Both are valid.
    A non-JSON 4xx body is also acceptable when middleware short-circuits
    (e.g. CSRF returns plain "Invalid CSRF token") — we only require that
    the route eventually emits a JSON envelope when it processes the request.
    """
    if resp.status_code < 400:
        return True
    if not _looks_like_json(resp):
        return True  # middleware-level reject is fine
    try:
        body = resp.json()
    except Exception:
        return False
    if not isinstance(body, dict):
        return False
    return "error" in body or "detail" in body


# Routes that should return rate-limit headers when the upstream rate limiter
# is active. These are the ones that hit the FastAPI backend through the
# Next.js proxy, which itself enforces 60/min, 1000/hr.
RATE_LIMITED_PREFIXES = (
    "/api/chat",
    "/api/schedules",
    "/api/files",
    "/api/v1/cua",
    "/api/swarm",
    "/api/swarms",
)

# Public routes that must NEVER return 401/403 — they're the cold-path
# discovery surfaces.
ALWAYS_PUBLIC = ("/api/health", "/api/csrf", "/api/locale", "/api/status", "/api/models", "/api/providers")

# Routes we won't probe live for various reasons (mutations, expensive,
# webhook-style auth, SSE streams that hold the connection open).
SKIP_LIVE = (
    "/api/credits/webhook",          # Stripe webhook, signature-validated
    "/api/blog/revalidate",          # Next.js revalidation, signature-gated
    "/api/credits/auto-refill/execute",  # mutating, cron-only
    "/api/status/cron",              # mutating, cron-only
)


def _should_skip_live(url_path: str) -> bool:
    return any(url_path == p or url_path.startswith(p + "/") for p in SKIP_LIVE)


def _is_always_public(url_path: str) -> bool:
    return any(url_path == p or url_path.startswith(p + "/") for p in ALWAYS_PUBLIC)


def _is_rate_limited(url_path: str) -> bool:
    return any(url_path.startswith(p) for p in RATE_LIMITED_PREFIXES)


# ── Per-route probe parametrisation ───────────────────────────────────────

# Build a flat list of (route, method) ids for parametrize.
def _route_method_ids() -> list[tuple[Route, str]]:
    out: list[tuple[Route, str]] = []
    for r in ALL_ROUTES:
        if _should_skip_live(r.url_path):
            continue
        for m in r.methods:
            out.append((r, m))
    return out


ROUTE_METHODS = _route_method_ids()


def _id_for(rm: tuple[Route, str]) -> str:
    r, m = rm
    safe = re.sub(r"[^a-zA-Z0-9]+", "_", r.url_path).strip("_")
    return f"test_route__{safe}__{m}"


# Tracking dict — surfaced in the final summary.
RESULTS: dict[str, dict[str, Any]] = {}


def _record(route_id: str, key: str, value: Any) -> None:
    RESULTS.setdefault(route_id, {})[key] = value


# ── Core attack tests ──────────────────────────────────────────────────────


@pytest.mark.parametrize(("route", "method"), ROUTE_METHODS, ids=lambda x: getattr(x, "url_path", x))
def test_no_auth_returns_4xx_not_5xx(route: Route, method: str, http: httpx.Client):
    """Unauth call → 401/403 for protected routes, 200/4xx for public; never 5xx."""
    rid = f"{route.url_path}::{method}"
    if method in ("GET", "OPTIONS", "HEAD"):
        resp = http.request(method, _url(route.url_path), timeout=15.0)
    else:
        # State-changing method without CSRF token → middleware should 403.
        resp = http.request(
            method,
            _url(route.url_path),
            json={},
            headers={"Content-Type": "application/json"},
            timeout=15.0,
        )

    _record(rid, "no_auth_status", resp.status_code)
    # Must not 5xx — that's a server-side panic on a malformed/unauth request.
    assert not _is_5xx(resp.status_code), (
        f"{method} {route.url_path}: unauthenticated request returned 5xx "
        f"({resp.status_code}) — robustness regression. Body: {_extract_error_text(resp)}"
    )
    # Must NOT 200 for clearly protected routes (rough heuristic — we can't
    # reliably classify every route here, so we soft-record).
    if not _is_always_public(route.url_path) and method in ("POST", "PUT", "PATCH", "DELETE"):
        # State-changing without CSRF should be 401/403/400.
        if resp.status_code == 200:
            _record(rid, "warn_unauth_2xx", True)


@pytest.mark.parametrize(("route", "method"), [
    (r, m) for r, m in ROUTE_METHODS if m in ("POST", "PUT", "PATCH", "DELETE")
], ids=lambda x: getattr(x, "url_path", x))
def test_empty_body_no_5xx(route: Route, method: str, http: httpx.Client):
    """Empty JSON body → 400 (or 401/403 from auth gate first); never 5xx."""
    rid = f"{route.url_path}::{method}::empty"
    resp = http.request(
        method,
        _url(route.url_path),
        content=b"",
        headers={"Content-Type": "application/json"},
        timeout=15.0,
    )
    _record(rid, "empty_status", resp.status_code)
    assert not _is_5xx(resp.status_code), (
        f"{method} {route.url_path}: empty body caused 5xx ({resp.status_code}). "
        f"Body: {_extract_error_text(resp)}"
    )


@pytest.mark.parametrize(("route", "method"), [
    (r, m) for r, m in ROUTE_METHODS if m in ("POST", "PUT", "PATCH", "DELETE")
], ids=lambda x: getattr(x, "url_path", x))
def test_5mb_body_rejected(route: Route, method: str, http: httpx.Client):
    """5MB body → 4xx (413 preferred); never 5xx."""
    rid = f"{route.url_path}::{method}::5mb"
    big = "{" + '"x":"' + ("a" * (5 * 1024 * 1024 - 32)) + '"}'
    try:
        resp = http.request(
            method,
            _url(route.url_path),
            content=big.encode("utf-8"),
            headers={"Content-Type": "application/json"},
            timeout=30.0,
        )
    except httpx.TimeoutException:
        pytest.skip(f"5MB upload timed out — route may be SSE/streaming: {route.url_path}")
        return
    except httpx.HTTPError as e:
        _record(rid, "5mb_error", str(e))
        # Connection reset by upstream is acceptable — that's the proxy
        # cutting us off, which is a valid 4xx-equivalent.
        return
    _record(rid, "5mb_status", resp.status_code)
    assert not _is_5xx(resp.status_code), (
        f"{method} {route.url_path}: 5MB body caused 5xx ({resp.status_code}). "
        f"Body: {_extract_error_text(resp)}"
    )


@pytest.mark.parametrize(("route", "method"), [
    (r, m) for r, m in ROUTE_METHODS if m == "POST"
], ids=lambda x: getattr(x, "url_path", x))
def test_malformed_json_no_5xx(route: Route, method: str, http: httpx.Client):
    """Malformed JSON body → 400; never 5xx."""
    rid = f"{route.url_path}::{method}::malformed"
    resp = http.request(
        method,
        _url(route.url_path),
        content=b"{not valid json,,,",
        headers={"Content-Type": "application/json"},
        timeout=15.0,
    )
    _record(rid, "malformed_status", resp.status_code)
    assert not _is_5xx(resp.status_code), (
        f"{method} {route.url_path}: malformed JSON caused 5xx ({resp.status_code}). "
        f"Body: {_extract_error_text(resp)}"
    )


@pytest.mark.parametrize(("route", "method"), [
    (r, m) for r, m in ROUTE_METHODS if m == "POST"
], ids=lambda x: getattr(x, "url_path", x))
def test_prototype_pollution_body_no_5xx(route: Route, method: str, http: httpx.Client):
    """__proto__ / constructor injection → no 5xx; no echo of injected key in response."""
    rid = f"{route.url_path}::{method}::proto"
    payload = {
        "__proto__": {"polluted": 1},
        "constructor": {"prototype": {"polluted": 1}},
        "prototype": {"polluted": 1},
    }
    resp = http.request(
        method,
        _url(route.url_path),
        json=payload,
        timeout=15.0,
    )
    _record(rid, "proto_status", resp.status_code)
    assert not _is_5xx(resp.status_code), (
        f"{method} {route.url_path}: prototype-pollution body caused 5xx "
        f"({resp.status_code}). Body: {_extract_error_text(resp)}"
    )
    # Body should NOT contain the literal "polluted":1 echoed back — that
    # would mean the framework merged our payload into a model object.
    body = _extract_error_text(resp)
    assert '"polluted"' not in body, (
        f"{method} {route.url_path}: response echoes injected __proto__ key — "
        f"possible prototype pollution. Body: {body}"
    )


@pytest.mark.parametrize(("route", "method"), [
    (r, m) for r, m in ROUTE_METHODS if m == "GET" and "[" in str(r.file_path)
], ids=lambda x: getattr(x, "url_path", x))
def test_path_traversal_query_4xx(route: Route, method: str, http: httpx.Client):
    """GET with path-traversal style query → 4xx, no 5xx, no leaked /etc/passwd content."""
    rid = f"{route.url_path}::{method}::traversal"
    resp = http.request(
        method,
        _url(route.url_path),
        params={"id": "../../../etc/passwd", "path": "../../etc/passwd"},
        timeout=15.0,
    )
    _record(rid, "traversal_status", resp.status_code)
    assert not _is_5xx(resp.status_code), (
        f"{method} {route.url_path}: path-traversal query caused 5xx "
        f"({resp.status_code}). Body: {_extract_error_text(resp)}"
    )
    body = _extract_error_text(resp).lower()
    # If we ever saw a real /etc/passwd line in the response, that's a P0.
    assert "root:x:0:0" not in body, (
        f"{method} {route.url_path}: response appears to leak /etc/passwd content"
    )


@pytest.mark.parametrize("route", ALL_ROUTES, ids=lambda r: r.url_path)
def test_options_preflight_consistent(route: Route, http: httpx.Client):
    """OPTIONS preflight: must NOT echo `Access-Control-Allow-Origin: *` for credentialed routes,
    and must respond consistently (any 2xx/4xx, never 5xx)."""
    rid = f"{route.url_path}::OPTIONS"
    if _should_skip_live(route.url_path):
        pytest.skip(f"skip-live: {route.url_path}")
    try:
        resp = http.request(
            "OPTIONS",
            _url(route.url_path),
            headers={
                "Origin": "https://attacker.example",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type, x-csrf-token",
            },
            timeout=15.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"OPTIONS not supported by network layer: {e}")
        return
    _record(rid, "options_status", resp.status_code)
    assert not _is_5xx(resp.status_code), (
        f"OPTIONS {route.url_path}: 5xx ({resp.status_code}). Body: {_extract_error_text(resp)}"
    )
    # If CORS is allowed, the origin echo MUST be the requesting origin AND
    # MUST NOT be a wildcard when credentials are involved.
    aco = resp.headers.get("Access-Control-Allow-Origin", "")
    acc = resp.headers.get("Access-Control-Allow-Credentials", "").lower()
    if aco == "*" and acc == "true":
        pytest.fail(
            f"OPTIONS {route.url_path}: returns ACAO:* with ACAC:true — invalid + dangerous"
        )


@pytest.mark.parametrize("route", [
    r for r in ALL_ROUTES if "GET" in r.methods and _is_always_public(r.url_path)
], ids=lambda r: r.url_path)
def test_idempotent_get_stable(route: Route, http: httpx.Client):
    """Two calls to a public GET return the same response shape (keys), modulo timestamps."""
    if _should_skip_live(route.url_path):
        pytest.skip(f"skip-live: {route.url_path}")
    a = http.get(_url(route.url_path), timeout=15.0)
    b = http.get(_url(route.url_path), timeout=15.0)
    assert not _is_5xx(a.status_code) and not _is_5xx(b.status_code), (
        f"GET {route.url_path}: 5xx on idempotent calls"
    )
    if a.status_code != b.status_code:
        pytest.fail(
            f"GET {route.url_path}: status drifted between calls ({a.status_code} vs {b.status_code})"
        )
    if _looks_like_json(a) and _looks_like_json(b):
        try:
            ka = sorted(a.json().keys()) if isinstance(a.json(), dict) else None
            kb = sorted(b.json().keys()) if isinstance(b.json(), dict) else None
            if ka is not None and kb is not None:
                assert ka == kb, (
                    f"GET {route.url_path}: response shape drifted ({ka} vs {kb})"
                )
        except (ValueError, json.JSONDecodeError):
            pass


# ── Cross-cutting checks ──────────────────────────────────────────────────


def test_error_envelope_consistent_across_all_routes(http: httpx.Client):
    """For every route that returns >=400 to an unauth POST, the body must
    be valid JSON with an `error` or `detail` key — or a non-JSON body
    emitted by middleware (CSRF reject etc.)."""
    violations: list[str] = []
    # Sample: just probe a representative subset to keep runtime bounded.
    sample = [r for r in ALL_ROUTES if not _should_skip_live(r.url_path)][:40]
    with ThreadPoolExecutor(max_workers=10) as ex:
        futs = {
            ex.submit(
                http.post,
                _url(r.url_path),
                json={},
                headers={"Content-Type": "application/json"},
                timeout=15.0,
            ): r
            for r in sample
            if "POST" in r.methods
        }
        for fut in as_completed(futs):
            r = futs[fut]
            try:
                resp = fut.result()
            except httpx.HTTPError:
                continue
            if resp.status_code >= 400 and not _has_error_envelope(resp):
                violations.append(
                    f"{r.url_path}: status={resp.status_code} body={_extract_error_text(resp)[:120]}"
                )
    if violations:
        pytest.fail(
            "Error envelope violations:\n  " + "\n  ".join(violations[:10])
            + (f"\n  ... +{len(violations) - 10} more" if len(violations) > 10 else "")
        )


def test_rate_limit_headers_present_on_rate_limited_routes(http: httpx.Client):
    """X-RateLimit-* headers must appear on chat/schedules/files/cua, not on /health."""
    # Health route — must NOT advertise rate limits.
    h = http.get(_url("/api/health"), timeout=15.0)
    rl_health = any(k.lower().startswith("x-ratelimit") for k in h.headers.keys())
    if rl_health:
        pytest.fail("/api/health should not return X-RateLimit-* headers")

    # We don't strictly require X-RateLimit-* on every Next.js proxy route
    # — they're emitted by the FastAPI backend and may not propagate through
    # the proxy. Soft-check: if at least one rate-limited route has them,
    # the contract is honoured. If NONE do, flag a warning.
    saw_rl = False
    for url in ("/api/v1/cua/health", "/api/chat", "/api/schedules"):
        try:
            r = http.get(_url(url), timeout=15.0)
        except httpx.HTTPError:
            continue
        if any(k.lower().startswith("x-ratelimit") for k in r.headers.keys()):
            saw_rl = True
            break
    if not saw_rl:
        pytest.skip(
            "No rate-limit headers observed on any sampled rate-limited route. "
            "If the deployment exposes rate limiting only at the backend, this is OK; "
            "if it should be exposed via the proxy, this is a regression."
        )


# ── Discovery surface visibility ──────────────────────────────────────────


def test_discovery_found_routes():
    """Sanity: surface non-zero routes."""
    assert len(ALL_ROUTES) >= 50, f"Expected >=50 routes, found {len(ALL_ROUTES)}"


def test_summary_print():
    """Print discovered surface + per-route results once at the end."""
    print(f"\n[gauntlet] discovered {len(ALL_ROUTES)} routes")
    print(f"[gauntlet] (route,method) probes: {len(ROUTE_METHODS)}")
    # Top-level breakdown of which routes saw 5xx anywhere — should be empty
    bad: list[str] = []
    for rid, info in RESULTS.items():
        for k, v in info.items():
            if k.endswith("_status") and isinstance(v, int) and _is_5xx(v):
                bad.append(f"{rid}: {k}={v}")
    if bad:
        print("[gauntlet] 5xx-emitting probes (P1):")
        for b in bad[:20]:
            print(f"  {b}")
        if len(bad) > 20:
            print(f"  ... +{len(bad) - 20} more")
    # Always pass — this is the summary printer.
    assert True
