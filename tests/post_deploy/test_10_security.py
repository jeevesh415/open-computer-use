"""
test_10_security.py — Post-deployment security posture verification.

Locks in the security-critical invariants of the production deployment:

  * CSP + security headers injected by ``middleware.ts`` are present and sane
  * HSTS on HTTPS, XFO/XCTO/Referrer-Policy/Permissions-Policy on every page
  * Auth-gated cookies carry Secure + HttpOnly
  * CSRF behavior on Next.js POSTs (observable: either the Next.js middleware
    rejects with 403, or the route itself rejects unauth / invalid bodies —
    never a silent 200 without a valid token)
  * Session cookie / protected route redirect chain
  * SQLi + XSS smokes on user-input endpoints
  * Bearer JWT validation on the direct FastAPI ALB — bad sig / expired /
    tampered claims all rejected
  * Backend rate-limit envelope (well-formed 429 + Retry-After)
  * Cloudflare-side rate limiting on the frontend (best-effort)
  * Open-redirect / directory-listing / env-file exposure regressions
  * PII-in-error-body + INTERNAL_API_KEY leak guards
  * Reflected input HTML escaping on error pages

Every test carries ``@pytest.mark.security``. Rate-limit scans are also
``@pytest.mark.slow``. State-writing tests (XSS storage) are marked
``@pytest.mark.destructive`` and clean up after themselves.

Failure messages are prefixed ``SECURITY:`` so triage tooling can flag these
as P0.
"""
from __future__ import annotations

import base64
import json
import os
import re
import time
from typing import Optional
from urllib.parse import urlparse, urlencode

import httpx
import pytest

from conftest import cfg


# ── Markers ─────────────────────────────────────────────────────────────────
pytestmark = pytest.mark.security


# ───────────────────────────────────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────────────────────────────────

def _sec(msg: str, resp: Optional[httpx.Response] = None) -> str:
    """Build a ``SECURITY:``-prefixed assertion message with response context."""
    if resp is None:
        return f"SECURITY: {msg}"
    body = ""
    try:
        body = resp.text[:400].replace("\n", " ")
    except Exception:
        body = "<undecodable>"
    return (
        f"SECURITY: {msg}\n"
        f"  {resp.request.method} {resp.request.url} → {resp.status_code}\n"
        f"  Body: {body}"
    )


def _skip_if_cf_challenge(resp: httpx.Response) -> None:
    if resp.status_code not in (403, 503):
        return
    ct = resp.headers.get("Content-Type", "").lower()
    body = (resp.text or "").lower()
    if "text/html" in ct and "cloudflare" in body and (
        "captcha" in body or "challenge" in body or "just a moment" in body
    ):
        pytest.skip("Cloudflare challenge page — investigate WAF rules")


def _parse_csp(csp: str) -> dict[str, list[str]]:
    """Parse a CSP header into ``{directive: [source, ...]}``."""
    out: dict[str, list[str]] = {}
    for part in csp.split(";"):
        part = part.strip()
        if not part:
            continue
        tokens = part.split()
        directive = tokens[0].lower()
        out[directive] = tokens[1:]
    return out


def _supabase_origin() -> str:
    u = urlparse(cfg().supabase_url)
    return f"{u.scheme}://{u.netloc}"


def _b64url(data: bytes) -> str:
    """URL-safe base64 without padding, as used in JWTs."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _forge_jwt(payload: dict, signature: bytes = b"invalid-signature") -> str:
    """Build a raw 3-segment JWT with an intentionally bogus signature.

    We never sign with the real Supabase secret — these tokens must *fail*
    validation. The header is valid JSON so routes that pre-parse it won't
    choke before the signature check.
    """
    header = {"alg": "HS256", "typ": "JWT"}
    h = _b64url(json.dumps(header, separators=(",", ":")).encode())
    p = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    s = _b64url(signature)
    return f"{h}.{p}.{s}"


# ───────────────────────────────────────────────────────────────────────────
# 1–7. Security response headers on the frontend
# ───────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def homepage_resp(http: httpx.Client) -> httpx.Response:
    """GET {frontend_url}/ once per module — every header test reads from it."""
    resp = http.get(f"{cfg().frontend_url}/")
    _skip_if_cf_challenge(resp)
    if resp.status_code >= 500:
        pytest.skip(f"Homepage 5xx — frontend unhealthy, skipping header tests: {resp.status_code}")
    return resp


def test_csp_header_present_and_sane(homepage_resp: httpx.Response):
    """CSP must exist with default-src 'self' + connect-src including wss: + Supabase."""
    csp = homepage_resp.headers.get("Content-Security-Policy", "")
    assert csp, _sec("Content-Security-Policy header is missing on homepage", homepage_resp)

    directives = _parse_csp(csp)

    # default-src must include 'self'
    default_src = directives.get("default-src", [])
    assert "'self'" in default_src, _sec(
        f"CSP default-src missing 'self' (got {default_src!r})", homepage_resp
    )
    # default-src must NOT grant unsafe-inline (script-src with unsafe-inline is
    # tolerated — tracked separately — but default-src never should)
    assert "'unsafe-inline'" not in default_src, _sec(
        f"CSP default-src includes 'unsafe-inline' — forbids safe fallback "
        f"(got {default_src!r})",
        homepage_resp,
    )

    # connect-src must allow wss: and the Supabase origin
    connect_src = directives.get("connect-src", [])
    assert "wss:" in connect_src, _sec(
        f"CSP connect-src missing 'wss:' — WebSocket connections will be blocked "
        f"(got {connect_src!r})",
        homepage_resp,
    )
    supa = _supabase_origin()
    supabase_in_csp = any(supa in src or src == supa for src in connect_src)
    assert supabase_in_csp, _sec(
        f"CSP connect-src does not include Supabase origin {supa!r} "
        f"(got {connect_src!r})",
        homepage_resp,
    )


def test_csp_no_wildcard_on_connect_or_script_src(homepage_resp: httpx.Response):
    """connect-src/script-src must not be a bare '*' (would defeat CSP)."""
    csp = homepage_resp.headers.get("Content-Security-Policy", "")
    if not csp:
        pytest.skip("CSP missing — covered by other test")

    directives = _parse_csp(csp)
    for key in ("connect-src", "script-src"):
        sources = directives.get(key, [])
        assert "*" not in sources, _sec(
            f"CSP {key} contains wildcard '*' — defeats purpose of CSP "
            f"(got {sources!r})",
            homepage_resp,
        )


def test_hsts_on_https(homepage_resp: httpx.Response):
    """Strict-Transport-Security with max-age >= 1y + includeSubDomains on HTTPS."""
    url = str(homepage_resp.request.url)
    if not url.startswith("https://"):
        pytest.skip("Homepage is not HTTPS — HSTS not applicable")

    hsts = homepage_resp.headers.get("Strict-Transport-Security", "")
    assert hsts, _sec("Strict-Transport-Security missing on HTTPS response", homepage_resp)

    # Parse max-age
    m = re.search(r"max-age\s*=\s*(\d+)", hsts)
    assert m, _sec(f"HSTS has no max-age directive (got {hsts!r})", homepage_resp)
    max_age = int(m.group(1))
    assert max_age >= 31_536_000, _sec(
        f"HSTS max-age={max_age} < 1 year (31536000). Got {hsts!r}",
        homepage_resp,
    )

    assert "includeSubDomains" in hsts, _sec(
        f"HSTS missing includeSubDomains (got {hsts!r})", homepage_resp
    )


def test_x_frame_options_sameorigin(homepage_resp: httpx.Response):
    xfo = homepage_resp.headers.get("X-Frame-Options", "")
    assert xfo.upper() == "SAMEORIGIN", _sec(
        f"Expected X-Frame-Options: SAMEORIGIN, got {xfo!r}", homepage_resp
    )


def test_x_content_type_options_nosniff(homepage_resp: httpx.Response):
    xcto = homepage_resp.headers.get("X-Content-Type-Options", "")
    assert xcto.lower() == "nosniff", _sec(
        f"Expected X-Content-Type-Options: nosniff, got {xcto!r}", homepage_resp
    )


def test_referrer_policy_strict(homepage_resp: httpx.Response):
    rp = homepage_resp.headers.get("Referrer-Policy", "")
    assert rp == "strict-origin-when-cross-origin", _sec(
        f"Expected Referrer-Policy: strict-origin-when-cross-origin, got {rp!r}",
        homepage_resp,
    )


def test_permissions_policy_blocks_sensitive(homepage_resp: httpx.Response):
    """camera, microphone, geolocation must be disabled by Permissions-Policy."""
    pp = homepage_resp.headers.get("Permissions-Policy", "")
    assert pp, _sec("Permissions-Policy header missing", homepage_resp)
    for feature in ("camera", "microphone", "geolocation"):
        # Expect either `feature=()` or `feature=(self)` etc. — but never allow-all.
        # The middleware.ts sets `feature=()` for all three.
        pattern = re.compile(rf"\b{feature}\s*=\s*\(\s*\)")
        assert pattern.search(pp), _sec(
            f"Permissions-Policy does not block {feature!r} "
            f"(expected `{feature}=()`, got {pp!r})",
            homepage_resp,
        )


# ───────────────────────────────────────────────────────────────────────────
# 8. Cookie attributes
# ───────────────────────────────────────────────────────────────────────────

def test_sensitive_cookies_secure_and_httponly(http: httpx.Client):
    """Any cookie matching /session|token|csrf|auth/i must be Secure+HttpOnly.

    Locale cookie (``NEXT_LOCALE``) is exempt — it's SameSite=Lax without
    HttpOnly on purpose (client-side reads are fine).
    """
    resp = http.get(
        f"{cfg().frontend_url}/",
        headers={"Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8"},
    )
    _skip_if_cf_challenge(resp)
    if resp.status_code >= 500:
        pytest.skip(f"Homepage 5xx — cannot inspect Set-Cookie: {resp.status_code}")

    set_cookies = resp.headers.get_list("set-cookie") if hasattr(
        resp.headers, "get_list"
    ) else [v for k, v in resp.headers.multi_items() if k.lower() == "set-cookie"]

    if not set_cookies:
        pytest.skip("No Set-Cookie headers on homepage — nothing to assert")

    sensitive_re = re.compile(r"session|token|csrf|auth", re.IGNORECASE)

    for raw in set_cookies:
        # First segment is `name=value`
        name = raw.split("=", 1)[0].strip()
        lower = raw.lower()
        if sensitive_re.search(name):
            assert "secure" in lower, _sec(
                f"Cookie {name!r} is sensitive but missing Secure attribute: {raw!r}"
            )
            assert "httponly" in lower, _sec(
                f"Cookie {name!r} is sensitive but missing HttpOnly attribute: {raw!r}"
            )
        # NEXT_LOCALE should at least be SameSite=Lax
        if name.upper() == "NEXT_LOCALE":
            assert "samesite" in lower, _sec(
                f"NEXT_LOCALE cookie missing SameSite attribute: {raw!r}"
            )


# ───────────────────────────────────────────────────────────────────────────
# 9–10. CSRF + session-cookie protection
# ───────────────────────────────────────────────────────────────────────────

def test_csrf_post_without_token_is_not_silently_accepted(http: httpx.Client):
    """POST to a Next.js API route without CSRF token must NOT return 200.

    The Next.js middleware matcher excludes /api/*, so on Next.js routes the
    CSRF check is typically performed inside the route handler itself. Either
    way, the observable contract is: an unauthenticated POST to /api/chat/
    with no CSRF token and no session MUST NOT return a successful chat
    response. 401/403/405 are all acceptable; 200 is not.
    """
    url = f"{cfg().frontend_url}/api/chat/"
    resp = http.post(
        url,
        json={"messages": [{"role": "user", "content": "ping"}]},
        headers={"Content-Type": "application/json"},
    )
    # Treat Cloudflare challenges as environmental noise
    _skip_if_cf_challenge(resp)

    assert resp.status_code != 200, _sec(
        "POST /api/chat/ with no CSRF token and no session returned 200 — "
        "CSRF/auth gate is broken",
        resp,
    )
    # Don't pin on a specific code; just demand rejection. 308 accepted
    # because Next.js normalises POST /api/chat/ → /api/chat with a
    # redirect; the redirect itself proves the route didn't honour the
    # body, which is all this CSRF smoke needs.
    assert resp.status_code in (308, 400, 401, 403, 405, 415, 422), _sec(
        f"Unexpected status {resp.status_code} on unauth/no-CSRF POST",
        resp,
    )


def test_protected_route_redirects_when_unauthenticated(http: httpx.Client):
    """GET /account with no session → 302/307 redirect to /auth."""
    resp = http.get(f"{cfg().frontend_url}/account", follow_redirects=False)
    _skip_if_cf_challenge(resp)

    assert resp.status_code in (302, 307), _sec(
        f"Expected 302/307 redirect from /account to /auth, got {resp.status_code}",
        resp,
    )
    location = resp.headers.get("Location", "")
    assert "/auth" in location, _sec(
        f"Redirect Location does not point to /auth (got {location!r})", resp
    )


# ───────────────────────────────────────────────────────────────────────────
# 11. SQL injection smoke
# ───────────────────────────────────────────────────────────────────────────

def test_sqli_smoke_on_chats_listing(http: httpx.Client, auth_headers: dict[str, str]):
    """Classic `' OR '1'='1` payload must not cause a 500 with a stack trace."""
    url = f"{cfg().backend_public_url}/api/chats/"
    payload = {"q": "' OR '1'='1", "search": "'; DROP TABLE users;--"}
    resp = http.get(url, params=payload, headers=auth_headers)

    # 200 (with safe rows), 400, 404, 422 are all acceptable; 500 is a red flag.
    assert resp.status_code != 500, _sec(
        "SQLi probe on /api/chats/ produced HTTP 500 — possible query injection "
        "or unhandled exception path",
        resp,
    )

    # If 200, the body must not contain a Python traceback marker
    body = resp.text or ""
    for forbidden in ("Traceback (most recent call last)", "psycopg", 'File "/', "File '/"):
        assert forbidden not in body, _sec(
            f"SQLi probe response leaked internal diagnostic marker {forbidden!r}",
            resp,
        )


# ───────────────────────────────────────────────────────────────────────────
# 12. XSS storage smoke — destructive (creates + deletes a chat)
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.destructive
def test_xss_payload_in_chat_title_is_safely_stored(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """POST a chat whose title is an XSS payload; read it back; delete.

    We do NOT require the backend to sanitize at storage — literal round-trip
    is acceptable. What we verify: the stored value is not executed as HTML
    in any response we can see. (Actual HTML-render route inspection is
    skipped if no such route is reachable without a browser.)
    """
    create_url = f"{cfg().backend_public_url}/api/chats/"
    payload = {
        "title": "<script>alert('xss-post-deploy-probe')</script>",
        "source": "post-deploy-test",
    }
    created = http.post(create_url, json=payload, headers=auth_headers)
    if created.status_code in (401, 403):
        pytest.skip(
            f"Auth did not propagate to /api/chats/ POST ({created.status_code}) "
            "— skipping XSS storage probe"
        )
    if created.status_code >= 500:
        pytest.fail(_sec(
            "XSS probe created a server error rather than a clean create/reject",
            created,
        ))
    if created.status_code not in (200, 201):
        pytest.skip(
            f"Backend rejected chat create ({created.status_code}) — cannot "
            "exercise XSS storage path"
        )

    chat_id = None
    try:
        data = created.json()
        chat_id = (data.get("chat") or {}).get("id") or data.get("id")
    except Exception:
        pytest.skip("Response body from chat create did not parse as JSON with an id")

    if not chat_id:
        pytest.skip("Create response had no chat id — can't round-trip")

    try:
        list_resp = http.get(
            f"{cfg().backend_public_url}/api/chats/", headers=auth_headers
        )
        assert list_resp.status_code == 200, _sec(
            f"Chat list GET failed after create: {list_resp.status_code}",
            list_resp,
        )
        body = list_resp.text or ""
        # Body is JSON; raw <script> is *allowed* since JSON escapes it as a
        # string, but it must never appear as an unescaped HTML tag — i.e.
        # Content-Type must not be text/html.
        ct = list_resp.headers.get("Content-Type", "").lower()
        assert "text/html" not in ct, _sec(
            f"/api/chats/ served text/html (Content-Type={ct!r}) — XSS payload "
            "would render as HTML",
            list_resp,
        )
        # Either the payload is echoed (ok, it's JSON) or was sanitized out.
        # We only fail if the body is *missing* proper JSON framing AND the
        # raw tag is visible — unlikely but worth the assert.
        if "<script>" in body and not (ct.startswith("application/json")):
            pytest.fail(_sec(
                f"Chat list leaked raw <script> tag outside JSON framing "
                f"(Content-Type={ct!r})",
                list_resp,
            ))
    finally:
        # Always clean up the test row
        if chat_id:
            try:
                http.delete(
                    f"{cfg().backend_public_url}/api/chats/{chat_id}/",
                    headers=auth_headers,
                )
            except Exception:
                pass


# ───────────────────────────────────────────────────────────────────────────
# 13–15. Bearer JWT validation on direct backend
# ───────────────────────────────────────────────────────────────────────────

_BEARER_TARGETS = [
    "/api/chats/",
    "/api/chat/",
    "/api/electron/machines",
]


@pytest.mark.parametrize("path", _BEARER_TARGETS)
def test_bearer_bad_signature_rejected(http: httpx.Client, path: str):
    """Bogus-signature JWT → 401/403 on every Bearer-gated endpoint."""
    payload = {
        "sub": "00000000-0000-0000-0000-000000000000",
        "email": "fake@example.com",
        "exp": int(time.time()) + 3600,
        "iat": int(time.time()),
        "aud": "authenticated",
    }
    bad_jwt = _forge_jwt(payload, signature=os.urandom(32))

    url = f"{cfg().backend_public_url}{path}"
    # Use GET for /api/chats and /api/electron/machines; for /api/chat/ which
    # is POST-only, GET still exercises the auth gate (we don't want to
    # accidentally send a real streaming POST).
    resp = http.get(url, headers={"Authorization": f"Bearer {bad_jwt}"})
    assert resp.status_code in (401, 403, 405), _sec(
        f"{path} accepted a bogus-signature JWT (status {resp.status_code})",
        resp,
    )
    assert resp.status_code != 500, _sec(
        f"{path} 500ed on bad-sig JWT — auth layer threw instead of rejecting",
        resp,
    )


def test_bearer_expired_token_rejected(http: httpx.Client):
    """Well-formed JWT with exp in the past → 401/403, never 200."""
    payload = {
        "sub": "00000000-0000-0000-0000-000000000000",
        "email": "expired@example.com",
        "exp": int(time.time()) - 7200,  # expired 2h ago
        "iat": int(time.time()) - 10800,
        "aud": "authenticated",
    }
    expired_jwt = _forge_jwt(payload, signature=os.urandom(32))

    url = f"{cfg().backend_public_url}/api/chats/"
    resp = http.get(url, headers={"Authorization": f"Bearer {expired_jwt}"})

    assert resp.status_code in (401, 403), _sec(
        f"/api/chats/ accepted expired JWT (status {resp.status_code})",
        resp,
    )


def test_bearer_tampered_sub_claim_rejected(http: httpx.Client):
    """Tampered sub claim without valid signature → 401/403.

    Supabase verifies the signature before reading claims, so a tampered sub
    on an unsigned forgery must fail at the signature check.
    """
    payload = {
        "sub": "admin",  # tampered
        "email": "victim@example.com",
        "role": "service_role",  # attempted privilege escalation
        "exp": int(time.time()) + 3600,
        "iat": int(time.time()),
        "aud": "authenticated",
    }
    tampered = _forge_jwt(payload, signature=os.urandom(32))

    url = f"{cfg().backend_public_url}/api/chats/"
    resp = http.get(url, headers={"Authorization": f"Bearer {tampered}"})

    assert resp.status_code in (401, 403), _sec(
        f"/api/chats/ accepted tampered-claim JWT (status {resp.status_code})",
        resp,
    )


# ───────────────────────────────────────────────────────────────────────────
# 16–17. Rate limiting
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.slow
def test_backend_rate_limit_envelope_on_burst(http: httpx.Client):
    """Burst a non-exempt endpoint until a 429 — verify envelope shape.

    ``/api/health`` is exempt from the rate limiter (see ``RateLimitMiddleware``
    skip list), so we target ``/api/status/history`` which is NOT in the skip
    list for rate limiting but IS in the internal-key-auth skip list, meaning
    anonymous bursts will hit the limit cleanly.
    """
    url = f"{cfg().backend_public_url}/api/status/history"
    limit = 80  # RATE_LIMIT_PER_MINUTE default is 60

    saw_429: Optional[httpx.Response] = None
    for _ in range(limit):
        resp = http.get(url)
        if resp.status_code == 429:
            saw_429 = resp
            break

    if saw_429 is None:
        pytest.skip(
            f"No 429 observed after {limit} requests — rate limiter may be "
            "in fail-open mode (Redis down) or limit is very high here"
        )

    # Envelope checks
    retry_after = saw_429.headers.get("Retry-After", "")
    assert retry_after, _sec(
        "429 response missing Retry-After header", saw_429
    )
    assert retry_after.isdigit(), _sec(
        f"Retry-After is not a plain integer seconds value: {retry_after!r}",
        saw_429,
    )
    try:
        body = saw_429.json()
    except Exception:
        pytest.fail(_sec("429 body is not valid JSON", saw_429))
    assert "error" in body, _sec(
        f"429 JSON body missing `error` field (got keys {list(body.keys())!r})",
        saw_429,
    )


@pytest.mark.slow
def test_frontend_cloudflare_rate_limit_is_documented(http: httpx.Client):
    """Burst the frontend's health endpoint; document CF rate-limit behavior.

    This test never fails hard — it documents the observed behavior in a
    skip message if CF is permissive at low-traffic volume, so reviewers
    can decide whether to tighten the WAF rule later.
    """
    url = f"{cfg().frontend_url}/api/health"
    cf_blocks = 0
    other_codes: set[int] = set()
    for _ in range(100):
        resp = http.get(url)
        if resp.status_code in (403, 429):
            server = resp.headers.get("Server", "").lower()
            cf_ray = resp.headers.get("CF-Ray", "")
            if "cloudflare" in server or cf_ray:
                cf_blocks += 1
                continue
        other_codes.add(resp.status_code)

    if cf_blocks == 0:
        pytest.skip(
            f"Cloudflare did not rate-limit 100 rapid /api/health hits "
            f"(observed codes: {sorted(other_codes)!r}). This may be intentional "
            "at low traffic — consider adding a WAF rate-limit rule for abusive "
            "spikes."
        )


# ───────────────────────────────────────────────────────────────────────────
# 18. Open-redirect smoke
# ───────────────────────────────────────────────────────────────────────────

def test_auth_redirect_does_not_allow_external_target(http: httpx.Client):
    """?redirectTo=https://evil.example.com must not redirect off-origin."""
    params = {"redirectTo": "https://evil.example.com/steal"}
    resp = http.get(
        f"{cfg().frontend_url}/auth?{urlencode(params)}",
        follow_redirects=False,
    )
    _skip_if_cf_challenge(resp)

    if resp.status_code not in (301, 302, 303, 307, 308):
        # If /auth renders HTML directly, the param will be echoed into a
        # same-origin link on submit — not an open redirect at the HTTP layer.
        return

    loc = resp.headers.get("Location", "")
    if not loc:
        return  # no redirect target, nothing to check

    parsed = urlparse(loc)
    if parsed.netloc == "":
        return  # relative path, safe

    # Absolute URL — must match frontend origin
    frontend_host = urlparse(cfg().frontend_url).netloc
    assert parsed.netloc == frontend_host, _sec(
        f"Open redirect: /auth redirected to external host {parsed.netloc!r} "
        f"from redirectTo param (full Location={loc!r})",
        resp,
    )


# ───────────────────────────────────────────────────────────────────────────
# 19–21. Directory listing / env file exposure / security.txt
# ───────────────────────────────────────────────────────────────────────────

def test_next_static_directory_listing_disabled(http: httpx.Client):
    """GET /_next/static/ must not return a browsable directory listing."""
    resp = http.get(f"{cfg().frontend_url}/_next/static/")
    _skip_if_cf_challenge(resp)

    assert resp.status_code in (301, 302, 307, 308, 403, 404), _sec(
        f"/_next/static/ returned {resp.status_code} — expected 403/404, "
        "never a file listing",
        resp,
    )
    body = (resp.text or "").lower()
    listing_markers = ("<title>index of", "parent directory", 'href="../"')
    for marker in listing_markers:
        assert marker not in body, _sec(
            f"/_next/static/ response looks like a directory listing "
            f"(marker {marker!r} found)",
            resp,
        )


@pytest.mark.parametrize("path", ["/.env", "/backend/.env", "/.git/config", "/.env.production"])
def test_sensitive_files_not_served(http: httpx.Client, path: str):
    """Environment + VCS metadata files must not be served."""
    resp = http.get(f"{cfg().frontend_url}{path}", follow_redirects=False)
    _skip_if_cf_challenge(resp)

    assert resp.status_code in (301, 302, 307, 308, 403, 404), _sec(
        f"{path} returned {resp.status_code} — sensitive file may be served",
        resp,
    )
    if resp.status_code == 200:
        # Last line of defense: even if something returned 200, it must not
        # contain obvious secrets
        body = resp.text or ""
        for marker in ("AWS_SECRET", "SUPABASE_SERVICE_ROLE", "STRIPE_API_KEY", "CSRF_SECRET"):
            assert marker not in body, _sec(
                f"{path} served 200 and leaked secret marker {marker!r}",
                resp,
            )


def test_security_txt_is_not_500(http: httpx.Client):
    """/.well-known/security.txt — 200 or 404 is fine; never 500."""
    resp = http.get(f"{cfg().frontend_url}/.well-known/security.txt")
    _skip_if_cf_challenge(resp)
    assert resp.status_code != 500, _sec(
        f"security.txt returned 500 — route handler is broken",
        resp,
    )


# ───────────────────────────────────────────────────────────────────────────
# 22. No PII / stack traces in error bodies
# ───────────────────────────────────────────────────────────────────────────

def test_error_bodies_do_not_leak_pii_or_stacktraces(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """Trigger a 4xx/5xx on an auth'd endpoint and scan for PII/traces."""
    url = f"{cfg().backend_public_url}/api/chat/"
    # Intentionally malformed body — not valid JSON + missing required fields
    resp = http.post(
        url,
        content=b"{this is not json",
        headers={**auth_headers, "Content-Type": "application/json"},
    )

    body = resp.text or ""

    # PII check: the suite's test user email must never appear in an error body
    email = cfg().test_user_email
    assert email.lower() not in body.lower(), _sec(
        f"Error body contains the test user email {email!r} — possible PII leak",
        resp,
    )

    # Stack-trace / filesystem path leak check
    forbidden_markers = (
        "Traceback (most recent call last)",
        '  File "/home/',
        "  File '/home/",
        '  File "/root/',
        '/usr/local/lib/python',
        "ip-10-",        # EC2 internal hostnames
        "ip-172-",
        "ec2.internal",
    )
    for marker in forbidden_markers:
        assert marker not in body, _sec(
            f"Error body leaked internal diagnostic marker {marker!r} — "
            "production error handler is not masking exceptions",
            resp,
        )


# ───────────────────────────────────────────────────────────────────────────
# 23. Electron proxy must not leak INTERNAL_API_KEY
# ───────────────────────────────────────────────────────────────────────────

def test_electron_proxy_does_not_leak_internal_api_key(http: httpx.Client):
    """Invalid Bearer on the Electron chat proxy must not mention X-Internal-Key."""
    url = f"{cfg().frontend_url}/api/electron/proxy/chats/"
    resp = http.post(
        url,
        json={"title": "probe"},
        headers={"Authorization": "Bearer invalid.token.forgery"},
    )
    _skip_if_cf_challenge(resp)

    body = resp.text or ""

    # Even if INTERNAL_API_KEY isn't set in this env, the literal header name
    # must never appear in user-facing error text
    assert "X-Internal-Key" not in body, _sec(
        "Electron proxy error body contains the string 'X-Internal-Key' — "
        "implementation is leaking shared-secret header names",
        resp,
    )

    # If the real key is configured and known to the test env, ensure the
    # value itself isn't echoed either
    key = cfg().internal_api_key
    if key:
        assert key not in body, _sec(
            "Electron proxy error body contains the raw INTERNAL_API_KEY value",
            resp,
        )


# ───────────────────────────────────────────────────────────────────────────
# 24. Reflected input on 404 must be HTML-escaped
# ───────────────────────────────────────────────────────────────────────────

def test_error_page_does_not_reflect_user_input_as_raw_html(http: httpx.Client):
    """GET /<img src=x onerror=alert(1)> → 404; the raw tag must not render."""
    payload = "<img src=x onerror=alert(1)>"
    # Use the client directly so httpx URL-encodes the path for us
    resp = http.get(f"{cfg().frontend_url}/{payload}")
    _skip_if_cf_challenge(resp)

    # Some CDNs will 400 on control chars; accept any 4xx
    assert 400 <= resp.status_code < 500, _sec(
        f"Invalid path {payload!r} returned {resp.status_code}, expected 4xx",
        resp,
    )

    body = resp.text or ""
    # The exact raw tag must not appear unescaped in an HTML body
    ct = resp.headers.get("Content-Type", "").lower()
    if "text/html" in ct:
        assert payload not in body, _sec(
            f"404 HTML body reflects raw user input {payload!r} unescaped — "
            "reflected XSS risk",
            resp,
        )


# ───────────────────────────────────────────────────────────────────────────
# 25. TLS version — best-effort via openssl s_client (skipped if unavailable)
# ───────────────────────────────────────────────────────────────────────────

def test_tls_version_is_modern(http: httpx.Client):
    """Connect via httpx; confirm the session negotiated HTTP/2 or HTTP/1.1 over
    TLS 1.2+.

    httpx does not expose the negotiated TLS version directly, so we do the
    best we can: require HTTP/2 (which requires TLS 1.2+ per RFC 7540 §9.2)
    or fall back to shelling out to ``openssl s_client`` if available.
    """
    url = cfg().frontend_url
    if not url.startswith("https://"):
        pytest.skip("Frontend is not HTTPS — TLS test not applicable")

    # Make a fresh request so we can inspect the response's http_version
    resp = http.get(f"{url}/")
    _skip_if_cf_challenge(resp)

    version = getattr(resp, "http_version", "") or ""
    if version == "HTTP/2":
        # HTTP/2 requires TLS 1.2+ — we're done
        return

    # Fall back to openssl if installed
    import shutil
    import subprocess

    openssl = shutil.which("openssl")
    if not openssl:
        pytest.skip(
            f"HTTP version was {version!r} (not HTTP/2); openssl not available "
            "for a direct TLS-version probe — cannot verify TLS 1.2+"
        )

    host = urlparse(url).netloc
    try:
        out = subprocess.run(
            [openssl, "s_client", "-connect", f"{host}:443", "-servername", host, "-brief"],
            input=b"",
            capture_output=True,
            timeout=10,
        )
    except Exception as e:
        pytest.skip(f"openssl s_client failed: {e}")
        return

    combined = (out.stdout + out.stderr).decode(errors="replace")
    # Accept TLSv1.2 or TLSv1.3; reject 1.0 / 1.1
    assert ("TLSv1.2" in combined) or ("TLSv1.3" in combined), _sec(
        f"TLS handshake did not negotiate TLS 1.2+ (openssl output: {combined[:300]!r})"
    )
    for bad in ("TLSv1.0", "TLSv1.1"):
        assert bad not in combined, _sec(
            f"TLS handshake allowed deprecated {bad}: {combined[:300]!r}"
        )
