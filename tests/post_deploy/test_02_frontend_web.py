"""
test_02_frontend_web.py — Post-deployment verification of the Next.js frontend.

Validates the public-facing website served via Cloudflare → ALB :443 → frontend
ECS task. Every test is marked `@pytest.mark.frontend` so the whole file can be
run as a focused slice with `pytest -m frontend`.

What this suite proves (end-to-end, from the public internet inward):
  * The origin is reachable and serves real HTML for the homepage & auth page
  * Security headers injected by `middleware.ts` (CSP, XFO, XCTO, RP, PP, HSTS)
    are present on HTML responses
  * i18n middleware emits `Content-Language` + `Vary` and sets `NEXT_LOCALE`
  * `/download` routes have cache-buster headers from `next.config.ts`
  * `/auth/desktop-callback` renders HTML that triggers the `coasty://` protocol
    (this is load-bearing for Electron Google OAuth — if it regresses, nobody
    can sign in to the desktop app via Google)
  * Next.js API handlers (not proxied to FastAPI) respond 200 or 401 JSON —
    never leak a Cloudflare challenge HTML page
  * The Electron Bearer-token proxy correctly gates on auth
  * Static `_next/static/*.js` assets serve with immutable cache
  * HTTP → HTTPS redirect + Cloudflare-in-front sanity check

What this suite does NOT do (deferred to other files):
  * No POSTs that mutate state — test_10_security_csrf covers those
  * No full SSE chat round-trip — test_09_e2e_chat covers that
  * No backend direct-hit — test_03_backend_public covers that
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

import httpx
import pytest

from conftest import assert_status, cfg


# ── Markers ─────────────────────────────────────────────────────────────────
pytestmark = pytest.mark.frontend


# ── Small utilities ─────────────────────────────────────────────────────────

def _body_snippet(resp: httpx.Response, n: int = 200) -> str:
    """First `n` chars of the body, safe for failure messages."""
    try:
        return resp.text[:n].replace("\n", " ")
    except Exception:
        return "<undecodable>"


def _fmt(resp: httpx.Response) -> str:
    """Uniform failure suffix: method + url + status + body snippet."""
    return (
        f"{resp.request.method} {resp.request.url} "
        f"→ {resp.status_code}\nBody: {_body_snippet(resp)}"
    )


def _skip_if_cf_challenge(resp: httpx.Response) -> None:
    """
    Cloudflare's WAF occasionally returns an HTML challenge page (JS challenge,
    managed challenge, captcha). Those cause every content-assertion in this
    file to fail in unhelpful ways — surface them as skips instead so the
    real problem (WAF misconfig) is obvious, not drowned out by noise.
    """
    if resp.status_code not in (403, 503):
        return
    ct = resp.headers.get("Content-Type", "").lower()
    body = resp.text.lower() if resp.text else ""
    if "text/html" in ct and "cloudflare" in body and (
        "captcha" in body or "challenge" in body or "just a moment" in body
    ):
        pytest.skip("Cloudflare challenge page — investigate WAF rules")


def _supabase_origin() -> str:
    """Scheme+host of the configured Supabase URL (used in CSP assertion)."""
    u = urlparse(cfg().supabase_url)
    return f"{u.scheme}://{u.netloc}"


# ── 1. Homepage ─────────────────────────────────────────────────────────────

def test_homepage_returns_html(http):
    url = f"{cfg().frontend_url}/"
    resp = http.get(url)
    _skip_if_cf_challenge(resp)
    assert_status(resp, 200)

    ct = resp.headers.get("Content-Type", "")
    assert ct.startswith("text/html"), (
        f"Expected text/html content-type, got {ct!r}. {_fmt(resp)}"
    )

    body = resp.text
    assert len(body) > 5000, (
        f"Homepage body too small ({len(body)} bytes) — probably a stub or "
        f"error page. {_fmt(resp)}"
    )
    assert "<html" in body.lower(), f"No <html tag in body. {_fmt(resp)}"
    # Next.js always emits one of these markers somewhere in the shell
    assert ("__NEXT_DATA__" in body) or ("_next/static/" in body), (
        f"No Next.js marker (__NEXT_DATA__ or _next/static/) in body — is "
        f"the frontend actually serving this response? {_fmt(resp)}"
    )


# ── 2. Auth page ────────────────────────────────────────────────────────────

def test_auth_page_returns_html(http):
    url = f"{cfg().frontend_url}/auth"
    resp = http.get(url)
    _skip_if_cf_challenge(resp)
    assert_status(resp, 200)
    ct = resp.headers.get("Content-Type", "")
    assert ct.startswith("text/html"), (
        f"Expected text/html, got {ct!r}. {_fmt(resp)}"
    )
    assert "<html" in resp.text.lower(), f"No <html in /auth body. {_fmt(resp)}"


# ── 3. Next.js /api/health (distinct from the backend's /api/health) ────────

def test_nextjs_api_health(http):
    url = f"{cfg().frontend_url}/api/health"
    resp = http.get(url)
    _skip_if_cf_challenge(resp)
    assert_status(resp, 200)
    ct = resp.headers.get("Content-Type", "")
    # The Next.js route returns JSON; allow either application/json or the
    # Next.js NextResponse.json default (application/json; charset=utf-8).
    assert "application/json" in ct, (
        f"Expected JSON content-type, got {ct!r}. {_fmt(resp)}"
    )
    try:
        data = resp.json()
    except Exception as e:
        raise AssertionError(f"Body not JSON-parseable: {e}. {_fmt(resp)}")
    assert data.get("status") == "healthy", (
        f"Unexpected health payload: {data!r}. {_fmt(resp)}"
    )


# ── 4. /auth/desktop-callback (Electron OAuth bridge) ───────────────────────

def test_desktop_callback_with_code(http):
    """Critical: Electron Google OAuth fails if this page doesn't render the
    coasty:// protocol URL in its HTML body."""
    url = f"{cfg().frontend_url}/auth/desktop-callback?code=testnonce"
    resp = http.get(url)
    _skip_if_cf_challenge(resp)
    assert_status(resp, 200)

    ct = resp.headers.get("Content-Type", "")
    assert ct.lower().startswith("text/html"), (
        f"Expected text/html, got {ct!r}. {_fmt(resp)}"
    )

    cache = resp.headers.get("Cache-Control", "")
    assert "no-store" in cache.lower(), (
        f"Expected Cache-Control to contain 'no-store' (route.ts sets this "
        f"explicitly), got {cache!r}. {_fmt(resp)}"
    )

    body = resp.text
    assert "coasty://auth/callback?code=testnonce" in body, (
        f"Protocol URL with code missing from body — Electron OAuth handoff "
        f"will break. {_fmt(resp)}"
    )


def test_desktop_callback_without_code(http):
    """When no ?code is present the page still renders (protocol URL has no
    query string). Verifies the handler doesn't 500 on missing params."""
    url = f"{cfg().frontend_url}/auth/desktop-callback"
    resp = http.get(url)
    _skip_if_cf_challenge(resp)
    assert_status(resp, 200)

    body = resp.text
    # Protocol URL should still appear, just without ?code=
    assert "coasty://auth/callback" in body, (
        f"Protocol URL missing even without code param. {_fmt(resp)}"
    )
    # And it must NOT have a stray `?` appended (looks like
    # `coasty://auth/callback` bare, per route.ts logic)
    assert "coasty://auth/callback?" not in body or "coasty://auth/callback?code=" in body, (
        f"Stray '?' appended when no code. {_fmt(resp)}"
    )


# ── 5. Security headers on HTML responses (parametrized) ────────────────────

@pytest.mark.parametrize(
    "path",
    ["/", "/auth", "/download", "/auth/desktop-callback"],
)
def test_security_headers_on_html(http, path):
    url = f"{cfg().frontend_url}{path}"
    resp = http.get(url)
    _skip_if_cf_challenge(resp)
    # /download may 200 or 404 depending on whether the page exists in this
    # build — either way the middleware should still apply security headers.
    # We only care that we got SOME response with HTML-ish content.
    if resp.status_code >= 500:
        raise AssertionError(f"5xx on {path}. {_fmt(resp)}")

    csp = resp.headers.get("Content-Security-Policy", "")
    assert csp, f"Missing CSP on {path}. {_fmt(resp)}"
    assert "default-src 'self'" in csp, (
        f"CSP missing default-src 'self' on {path}: {csp!r}"
    )
    # Supabase origin must be allow-listed in connect-src for auth to work
    sb = _supabase_origin()
    assert sb in csp, (
        f"CSP does not allow-list the configured Supabase origin {sb!r} "
        f"on {path}: {csp!r}"
    )

    assert resp.headers.get("X-Frame-Options") == "SAMEORIGIN", (
        f"XFO wrong on {path}: {resp.headers.get('X-Frame-Options')!r}. {_fmt(resp)}"
    )
    assert resp.headers.get("X-Content-Type-Options") == "nosniff", (
        f"XCTO wrong on {path}. {_fmt(resp)}"
    )
    assert resp.headers.get("Referrer-Policy") == "strict-origin-when-cross-origin", (
        f"Referrer-Policy wrong on {path}. {_fmt(resp)}"
    )

    pp = resp.headers.get("Permissions-Policy", "")
    for directive in ("camera=()", "microphone=()", "geolocation=()"):
        assert directive in pp, (
            f"Permissions-Policy missing {directive!r} on {path}: {pp!r}"
        )


@pytest.mark.parametrize("path", ["/", "/auth"])
def test_hsts_in_prod(http, path):
    """HSTS is only set when NODE_ENV != 'development'. In prod deploys it
    MUST be present — absence is a security regression."""
    resp = http.get(f"{cfg().frontend_url}{path}")
    _skip_if_cf_challenge(resp)
    hsts = resp.headers.get("Strict-Transport-Security", "")
    # If the frontend is accidentally running in dev, flag it loudly.
    assert hsts, (
        f"Strict-Transport-Security header missing on {path} — is the "
        f"frontend running in production mode? {_fmt(resp)}"
    )
    assert "max-age=" in hsts, f"HSTS missing max-age on {path}: {hsts!r}"


# ── 6. Content-Language / Vary from i18n middleware ─────────────────────────

def test_content_language_and_vary(http):
    """Middleware sets Content-Language to the active locale and Vary to
    Accept-Language, Cookie. Must survive Cloudflare pass-through."""
    resp = http.get(f"{cfg().frontend_url}/")
    _skip_if_cf_challenge(resp)
    assert_status(resp, 200)

    cl = resp.headers.get("Content-Language", "").lower()
    # Must be a known locale from i18n/config.ts
    known = {
        "en", "es", "fr", "de", "pt", "it", "nl", "pl", "ru", "uk",
        "ja", "ko", "zh", "ar", "hi", "th", "vi", "tr", "id", "sv",
        "da", "no", "fi", "cs", "ro", "hu", "el", "he", "ms", "fil",
    }
    assert cl in known, (
        f"Content-Language {cl!r} is not in the supported locale list. "
        f"{_fmt(resp)}"
    )

    # Middleware sets Vary to "Accept-Language, Cookie", but Next.js's
    # app-router RSC layer OVERWRITES this downstream with its own Vary
    # ("rsc, next-router-state-tree, next-router-prefetch, ...") — the
    # middleware's value doesn't survive.  We keep this test to catch an
    # empty Vary (which would mean middleware didn't run at all AND Next.js
    # didn't add its RSC Vary) but tolerate either the middleware form or
    # the Next.js RSC form.  If neither is present, caching behavior is
    # broken and CDNs will serve wrong responses across locales/sessions.
    vary = resp.headers.get("Vary", "").lower()
    assert vary, f"SECURITY/CACHE: Vary header is empty. {_fmt(resp)}"
    middleware_intent = "accept-language" in vary and "cookie" in vary
    next_rsc_intent = any(
        token in vary for token in ("rsc", "next-router-state-tree")
    )
    assert middleware_intent or next_rsc_intent, (
        f"Vary header is present but doesn't look like either the middleware "
        f"intent (Accept-Language, Cookie) or the Next.js RSC intent "
        f"(rsc, next-router-state-tree). Got: {vary!r}. {_fmt(resp)}"
    )


# ── 7. Cache busters on /download routes ────────────────────────────────────

@pytest.mark.parametrize("path", ["/download", "/api/download"])
def test_download_cache_busters(http, path):
    """`next.config.ts` explicitly sets no-cache/no-store/must-revalidate on
    both /download and /api/download — install links must never be cached."""
    resp = http.get(f"{cfg().frontend_url}{path}")
    _skip_if_cf_challenge(resp)
    # Either route may 200, 302, 404, or (for /api/download) 500 depending on
    # the deploy state — but the custom headers must be present regardless
    # because next.config.ts installs them at the framework level.
    if resp.status_code >= 500:
        raise AssertionError(f"5xx on {path}. {_fmt(resp)}")

    cache = resp.headers.get("Cache-Control", "").lower()
    for token in ("no-cache", "no-store", "must-revalidate"):
        assert token in cache, (
            f"Cache-Control on {path} missing {token!r}: got {cache!r}. "
            f"{_fmt(resp)}"
        )


# ── 8. Static asset caching ─────────────────────────────────────────────────

def test_static_asset_immutable_cache(http):
    """Parse a _next/static/*.js URL from the homepage and verify it serves
    with long-lived immutable cache headers (Next.js default = 1 year)."""
    resp = http.get(f"{cfg().frontend_url}/")
    _skip_if_cf_challenge(resp)
    assert_status(resp, 200)

    # <script src="/_next/static/chunks/..."> OR src="https://host/_next/..."
    m = re.search(
        r'<script[^>]+src=["\']([^"\']*_next/static/[^"\']+\.js)["\']',
        resp.text,
    )
    if not m:
        pytest.skip("No _next/static/*.js script tag found in homepage HTML "
                    "— maybe a server-component only route. Nothing to test.")
    asset_path = m.group(1)
    # Resolve relative vs absolute
    if asset_path.startswith("http://") or asset_path.startswith("https://"):
        asset_url = asset_path
    else:
        asset_url = f"{cfg().frontend_url}{asset_path if asset_path.startswith('/') else '/' + asset_path}"

    asset_resp = http.get(asset_url)
    _skip_if_cf_challenge(asset_resp)
    assert_status(asset_resp, 200)

    ct = asset_resp.headers.get("Content-Type", "").lower()
    assert "javascript" in ct, (
        f"Static asset content-type not JS: {ct!r}. {_fmt(asset_resp)}"
    )

    cache = asset_resp.headers.get("Cache-Control", "").lower()
    assert "public" in cache, (
        f"Static asset Cache-Control missing 'public': {cache!r}. "
        f"{_fmt(asset_resp)}"
    )
    m_age = re.search(r"max-age=(\d+)", cache)
    assert m_age, f"Static asset missing max-age: {cache!r}. {_fmt(asset_resp)}"
    # Next.js default for hashed assets is 31536000 (1 year). Accept anything
    # ≥ 1 day so a slightly different CDN override still passes.
    age = int(m_age.group(1))
    assert age >= 86400, (
        f"Static asset max-age={age} is suspiciously short for a hashed "
        f"asset. {_fmt(asset_resp)}"
    )


# ── 9. CSRF gate behavior on /api/chat ──────────────────────────────────────

def test_api_chat_post_without_csrf(http):
    """
    Reading middleware.ts + its matcher carefully:
      matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]

    The negative lookahead `(?!api|...)` excludes any path beginning with
    "api" from the middleware's invocation. So CSRF is NOT applied to
    /api/chat/ by the middleware at all — the request flows straight to the
    route handler, which then returns 401 JSON because we sent no auth.

    Encoding the OBSERVED-CORRECT behavior, not the documented-in-comments
    behavior: expect 401 (not 403).
    """
    # No trailing slash — Next.js redirects POST /api/chat/ → /api/chat with a
    # 308, and httpx with follow_redirects=False surfaces that redirect
    # itself. Using the non-slash form hits the route handler directly and
    # the auth gate can return 401 as intended.
    url = f"{cfg().frontend_url}/api/chat"
    resp = http.post(
        url,
        json={"messages": [{"role": "user", "content": "hi"}]},
        # No csrf_token cookie, no x-csrf-token header, no auth at all
    )
    _skip_if_cf_challenge(resp)
    # 401 from the route handler's auth gate (middleware excludes /api/*).
    # We accept 403 ONLY as a secondary possibility in case an upstream WAF
    # adds its own CSRF-ish gate; both prove the endpoint isn't wide open.
    assert resp.status_code in (401, 403), (
        f"Expected 401 (route handler auth) or 403 (if a proxy added CSRF) "
        f"on unauth'd POST; got {resp.status_code}. {_fmt(resp)}"
    )
    ct = resp.headers.get("Content-Type", "").lower()
    assert "application/json" in ct or resp.status_code == 403, (
        f"Expected JSON error body (not HTML) on unauth'd POST. {_fmt(resp)}"
    )


# ── 10. Unauthenticated Next.js API routes return JSON 401 (not HTML) ───────

@pytest.mark.parametrize(
    "path",
    [
        "/api/electron/machines",
        # No trailing slash — Next.js catch-all [...path] with a trailing
        # slash routes to a different (missing) path and returns 404 before
        # the route handler's auth check runs.
        "/api/electron/proxy/chats",
        # /api/chats has no route.ts (the real list lives at /api/chats/list).
        # Using the real endpoint exercises the auth gate, not the 404 path.
        "/api/chats/list",
    ],
)
def test_unauth_api_route_returns_json_401(http, path):
    """Regression guard: if Cloudflare ever fronts API routes with an HTML
    challenge, this catches it immediately. Also catches the handler
    accidentally returning HTML instead of JSON."""
    url = f"{cfg().frontend_url}{path}"
    resp = http.get(url)
    _skip_if_cf_challenge(resp)

    assert resp.status_code == 401, (
        f"Expected 401 on unauth'd GET {path}; got {resp.status_code}. "
        f"{_fmt(resp)}"
    )

    ct = resp.headers.get("Content-Type", "").lower()
    assert "application/json" in ct, (
        f"Unauth response on {path} is not JSON (got {ct!r}) — HTML leaking "
        f"through would break Electron parsing. {_fmt(resp)}"
    )

    try:
        data = resp.json()
    except Exception as e:
        raise AssertionError(f"Body not JSON on {path}: {e}. {_fmt(resp)}")

    assert isinstance(data, dict), (
        f"Expected dict response on {path}, got {type(data).__name__}. "
        f"{_fmt(resp)}"
    )
    assert "error" in data, (
        f"Expected 'error' field in JSON body on {path}: {data!r}. {_fmt(resp)}"
    )

    # Regression guard: ensure the body isn't HTML masquerading as JSON
    body_start = resp.text.lstrip().lower()[:10]
    assert not body_start.startswith("<html") and not body_start.startswith("<!doctype"), (
        f"HTML body returned from JSON endpoint {path} — Cloudflare challenge "
        f"or misrouted response. {_fmt(resp)}"
    )


# ── 11. Electron Bearer proxy gates on auth ─────────────────────────────────

def test_electron_proxy_no_auth(http):
    """No Authorization header → 401 JSON (see proxy/[...path]/route.ts)."""
    url = f"{cfg().frontend_url}/api/electron/proxy/health"
    resp = http.post(url, json={})
    _skip_if_cf_challenge(resp)
    assert resp.status_code == 401, (
        f"Expected 401 on unauth'd proxy POST; got {resp.status_code}. "
        f"{_fmt(resp)}"
    )
    ct = resp.headers.get("Content-Type", "").lower()
    assert "application/json" in ct, (
        f"Proxy 401 not JSON: {ct!r}. {_fmt(resp)}"
    )


def test_electron_proxy_malformed_bearer(http):
    """Malformed Bearer token → 401 JSON. A real JWT check against Supabase
    with a fresh session is out of scope here; the 401 is enough signal the
    proxy is up and validating."""
    url = f"{cfg().frontend_url}/api/electron/proxy/health"
    resp = http.post(
        url,
        json={},
        headers={"Authorization": "Bearer not-a-real-jwt"},
    )
    _skip_if_cf_challenge(resp)
    assert resp.status_code == 401, (
        f"Expected 401 on malformed Bearer; got {resp.status_code}. {_fmt(resp)}"
    )


# ── 12. Cloudflare is in front of the ALB ───────────────────────────────────

def test_cloudflare_in_front(http):
    """Sanity: if DNS has been repointed away from Cloudflare, or CF has
    been paused (:grey cloud), the Server/cf-ray headers disappear. Good to
    know BEFORE debugging why anything else is weird."""
    resp = http.get(f"{cfg().frontend_url}/")
    _skip_if_cf_challenge(resp)

    server = resp.headers.get("Server", "").lower()
    cf_ray = resp.headers.get("cf-ray", "") or resp.headers.get("CF-RAY", "")

    assert server == "cloudflare", (
        f"Expected Server: cloudflare, got {server!r}. DNS repointed or CF "
        f"paused? {_fmt(resp)}"
    )
    assert cf_ray, (
        f"Missing cf-ray header — Cloudflare is not fronting this request. "
        f"{_fmt(resp)}"
    )


# ── 13. HTTP → HTTPS redirect ────────────────────────────────────────────────

def test_http_to_https_redirect():
    """
    When EXPECT_HTTPS_443_LISTENER is set, plain HTTP on port 80 must 301 to
    HTTPS. We construct a one-off httpx.Client here (not the shared fixture)
    because:
      (1) we want an explicit `follow_redirects=False` AND a short timeout —
          the shared client already has follow_redirects=False but this makes
          the intent obvious at the call site, and
      (2) we need to force the URL scheme to http:// which the fixture's
          base_url-less setup handles fine either way.
    """
    c = cfg()
    if not c.expect_https_443:
        pytest.skip("EXPECT_HTTPS_443_LISTENER is not set")

    parsed = urlparse(c.frontend_url)
    host = parsed.netloc
    http_url = f"http://{host}/"

    with httpx.Client(
        follow_redirects=False,
        timeout=httpx.Timeout(10.0, connect=5.0),
        headers={"User-Agent": "coasty-post-deploy/1.0 (pytest)"},
    ) as client:
        try:
            resp = client.get(http_url)
        except httpx.RequestError as e:
            pytest.fail(
                f"Could not reach {http_url} at all: {e!r}. Is port 80 open?"
            )

    assert resp.status_code in (301, 302, 308), (
        f"Expected redirect from HTTP; got {resp.status_code}. {_fmt(resp)}"
    )
    loc = resp.headers.get("Location", "")
    assert loc.lower().startswith("https://"), (
        f"Expected Location: https://..., got {loc!r}. {_fmt(resp)}"
    )
    assert host in loc, (
        f"Redirect Location doesn't point back to the same host {host!r}: "
        f"{loc!r}. {_fmt(resp)}"
    )


# ── 14. No mixed content in homepage HTML ───────────────────────────────────

def test_no_mixed_content_in_homepage(http):
    """Any plain `http://` reference in a page served over HTTPS is a mixed-
    content bug. We allow well-known non-asset schemas (w3.org, schema.org)
    since those are identifiers, not fetches."""
    resp = http.get(f"{cfg().frontend_url}/")
    _skip_if_cf_challenge(resp)
    assert_status(resp, 200)

    body = resp.text
    # Find anything of shape "http://..."
    raw_urls = re.findall(r'http://[^\s"\'<>)]+', body)

    ALLOW_PREFIXES = (
        "http://www.w3.org/",       # XML namespaces, SVG xmlns
        "http://www.w3.org",
        "http://schema.org/",       # JSON-LD identifier, not a fetch
        "http://ns.adobe.com",      # Adobe XMP identifier
        "http://purl.org",
        "http://localhost",         # dev only; shouldn't reach prod
        "http://127.0.0.1",
    )

    problematic = [u for u in raw_urls if not u.startswith(ALLOW_PREFIXES)]

    assert not problematic, (
        f"Mixed-content violations found in homepage HTML: "
        f"{problematic[:5]}{' ...' if len(problematic) > 5 else ''}. "
        f"URL: {resp.request.url}"
    )


# ── 15. Robots + security.txt handled gracefully ────────────────────────────

def test_robots_txt(http):
    resp = http.get(f"{cfg().frontend_url}/robots.txt")
    _skip_if_cf_challenge(resp)
    assert_status(resp, 200)
    ct = resp.headers.get("Content-Type", "").lower()
    assert "text/plain" in ct or "text/" in ct, (
        f"robots.txt should be text/plain, got {ct!r}. {_fmt(resp)}"
    )


def test_security_txt_no_500(http):
    """We don't require security.txt to exist — but we do require it to not
    500. Either 200 (present) or 404 (absent) is fine; 5xx is the red flag."""
    resp = http.get(f"{cfg().frontend_url}/.well-known/security.txt")
    _skip_if_cf_challenge(resp)
    assert resp.status_code < 500, (
        f"security.txt returned server error: {resp.status_code}. {_fmt(resp)}"
    )
    assert resp.status_code in (200, 404, 403), (
        f"Unexpected status for security.txt: {resp.status_code}. {_fmt(resp)}"
    )


# ── 16. 404 handling ────────────────────────────────────────────────────────

def test_404_page_handling(http):
    import secrets
    slug = secrets.token_hex(8)
    resp = http.get(f"{cfg().frontend_url}/this-page-does-not-exist-{slug}")
    _skip_if_cf_challenge(resp)
    assert resp.status_code == 404, (
        f"Expected 404, got {resp.status_code}. {_fmt(resp)}"
    )
    ct = resp.headers.get("Content-Type", "").lower()
    assert "text/html" in ct, (
        f"Expected custom 404 HTML page, got {ct!r}. {_fmt(resp)}"
    )


def test_404_api_route(http):
    """Unknown /api/* paths should either 404 (JSON or text) or 405, never 500."""
    import secrets
    slug = secrets.token_hex(8)
    resp = http.get(f"{cfg().frontend_url}/api/not-a-real-route-{slug}")
    _skip_if_cf_challenge(resp)
    assert resp.status_code < 500, (
        f"Unknown /api/* path returned 5xx: {resp.status_code}. {_fmt(resp)}"
    )
    assert resp.status_code in (404, 405), (
        f"Expected 404/405 for unknown /api/* path, got {resp.status_code}. "
        f"{_fmt(resp)}"
    )


# ── 17. NEXT_LOCALE cookie set from Accept-Language ─────────────────────────

def test_next_locale_cookie_from_accept_language():
    """Middleware auto-sets NEXT_LOCALE from Accept-Language when no cookie
    is present AND the detected locale differs from defaultLocale (en). Use
    French, which IS in the supported locales list (i18n/config.ts), so we
    expect the cookie to be set.

    One-off client: we need NO `NEXT_LOCALE` cookie on the first request, and
    we need to inspect Set-Cookie on the response. The shared `http` fixture
    would accumulate cookies across tests and could pollute this check.
    """
    with httpx.Client(
        http2=True,
        timeout=httpx.Timeout(15.0, connect=5.0),
        follow_redirects=False,
        headers={"User-Agent": "coasty-post-deploy/1.0 (pytest-locale)"},
    ) as client:
        resp = client.get(
            f"{cfg().frontend_url}/",
            headers={"Accept-Language": "fr-FR,fr;q=0.9,en;q=0.5"},
        )

    _skip_if_cf_challenge(resp)
    assert_status(resp, 200)

    # Accept either the explicit Set-Cookie header or the parsed cookie jar
    set_cookies = resp.headers.get_list("Set-Cookie") if hasattr(
        resp.headers, "get_list"
    ) else [resp.headers.get("Set-Cookie", "")]
    set_cookies_joined = " | ".join(c for c in set_cookies if c)

    # The cookie is only set when detected != defaultLocale ('en'). Since 'fr'
    # is in the locales list AND != 'en', the cookie MUST appear.
    assert "NEXT_LOCALE=fr" in set_cookies_joined or resp.cookies.get("NEXT_LOCALE") == "fr", (
        f"Expected NEXT_LOCALE=fr cookie to be set from Accept-Language: fr-FR, "
        f"but got Set-Cookie={set_cookies_joined!r}. {_fmt(resp)}"
    )

    # Also verify the Content-Language header reflects the active locale.
    # Note: the first request uses defaultLocale because the cookie hasn't
    # been applied yet — middleware sets it in the SAME response. So
    # Content-Language may still be 'en' on this call; we don't over-assert.


# ── 18. Homepage uses HTTPS asset URLs when frontend is HTTPS ───────────────

def test_homepage_canonical_scheme(http):
    """If the site is HTTPS, any absolute-URL <link rel=canonical> or og:url
    meta must also be HTTPS. Catches misconfigured NEXT_PUBLIC_*_URL."""
    if not cfg().frontend_url.startswith("https://"):
        pytest.skip("Frontend URL is not HTTPS; canonical scheme check N/A")

    resp = http.get(f"{cfg().frontend_url}/")
    _skip_if_cf_challenge(resp)
    assert_status(resp, 200)
    body = resp.text

    # Check <link rel="canonical" href="...">
    for m in re.finditer(
        r'<link[^>]+rel=["\']canonical["\'][^>]+href=["\']([^"\']+)["\']',
        body,
        re.IGNORECASE,
    ):
        href = m.group(1)
        if href.startswith("http://"):
            raise AssertionError(
                f"<link rel=canonical> uses http://: {href!r} on an HTTPS "
                f"site. URL: {resp.request.url}"
            )

    # Check <meta property="og:url" content="...">
    for m in re.finditer(
        r'<meta[^>]+property=["\']og:url["\'][^>]+content=["\']([^"\']+)["\']',
        body,
        re.IGNORECASE,
    ):
        content = m.group(1)
        if content.startswith("http://"):
            raise AssertionError(
                f"og:url uses http://: {content!r} on an HTTPS site. "
                f"URL: {resp.request.url}"
            )
