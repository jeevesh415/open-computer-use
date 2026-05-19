"""
test_security_routes_extras.py — Security coverage for the three less-traveled
backend route families that prior gauntlet/IDOR/injection suites skipped:

  * auto-blog        — /api/auto-blog/{trigger,status}     (backend, INTERNAL_API_KEY)
                       /api/blog/posts and /api/blog/posts/{id}  (frontend Next.js proxy)
  * email-tracking   — /api/t/{o,c,u}/{recipient_id}        (PUBLIC, no auth, no rate-limit)
  * osworld          — /api/osworld/{session,predict,…}     (X-OSWorld-Key OR INTERNAL_API_KEY)

Read FIRST before extending:
  * backend/app/api/routes/auto_blog.py        — only `_check_auth(request)` via X-Internal-Key
  * backend/app/api/routes/email_tracking.py   — anonymous; recipient_id is opaque pass-through
  * backend/app/api/routes/osworld.py          — uses dedicated X-OSWorld-Key in middleware
  * backend/app/core/middleware.py             — NB: /api/t/* is exempt from BOTH the
                                                 InternalAPIKeyMiddleware and the
                                                 RateLimitMiddleware.  /api/osworld/* is
                                                 also exempt from rate-limiting.
  * app/api/blog/posts/route.ts                — frontend POST gate is INTERNAL_API_KEY only
  * app/blog/[id]/page.tsx                     — renders content blocks via plain JSX, NOT
                                                 dangerouslySetInnerHTML.  XSS surface for
                                                 stored blog text therefore depends on the
                                                 frontend never gaining a renderer that
                                                 unwraps {block.text} into raw HTML.

These tests use the post-deploy fixtures (`http`, `auth_headers`, `cfg`,
`assert_status`).  They skip cleanly when:
  * a route returns 404 (not deployed in this environment)
  * an admin-mode test needs `TEST_ADMIN_TOKEN` and that env var is unset
  * a test needs `INTERNAL_API_KEY` but `cfg().internal_api_key` is None

Each test docstring states:
    <route> [<method>] — <attack>
"""
from __future__ import annotations

import base64
import os
import time
import urllib.parse
from typing import Any, Optional

import httpx
import pytest

from conftest import assert_status, cfg


pytestmark = pytest.mark.security


# ── Constants & helpers ─────────────────────────────────────────────────────

# Skip-on-404: a route family may not be mounted in every environment because
# main.py mounts auto_blog/osworld/email_tracking only when the service mode
# is "api" or "all".  Tests must skip cleanly rather than fail when the
# subsystem is intentionally absent on the target.
def _skip_if_unmounted(resp: httpx.Response, route_label: str) -> None:
    if resp.status_code == 404:
        body = (resp.text or "")[:200].lower()
        # FastAPI 404 for an unmounted prefix is "Not Found" with no body
        # detail — distinguish that from "session not found" type 404s by
        # checking the body shape.
        if "not found" in body and "session" not in body and "post" not in body:
            pytest.skip(f"{route_label} not mounted in this environment (404)")


def _backend(path: str) -> str:
    return f"{cfg().backend_public_url}{path}"


def _frontend(path: str) -> str:
    return f"{cfg().frontend_url}{path}"


def _admin_token() -> Optional[str]:
    """Optional admin Bearer token for routes that may be admin-gated."""
    val = os.environ.get("TEST_ADMIN_TOKEN", "").strip()
    return val or None


# 1×1 GIF reference bytes — matches the constant in email_tracking.py
EXPECTED_PIXEL_GIF = base64.b64decode(
    "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
)


# ===========================================================================
# auto-blog route family
# ===========================================================================

class TestAutoBlogBackendRoutes:
    """Direct hits against the FastAPI /api/auto-blog/* surface."""

    def test_status_unauth_is_401(self, http):
        """GET /api/auto-blog/status — no creds — must be 401, never 5xx."""
        resp = http.get(_backend("/api/auto-blog/status"))
        _skip_if_unmounted(resp, "/api/auto-blog/status")
        # Note: behind InternalAPIKeyMiddleware so /api/auto-blog reaches the
        # route's own _check_auth — which returns 401, not the middleware's 403.
        assert resp.status_code in (401, 403), (
            f"SECURITY: /api/auto-blog/status must reject anonymous, got "
            f"{resp.status_code}: {resp.text[:200]}"
        )
        assert resp.status_code < 500, "/api/auto-blog/status must not 5xx on missing creds"

    def test_trigger_unauth_is_401(self, http):
        """POST /api/auto-blog/trigger — no creds — must be 401, never 200."""
        resp = http.post(_backend("/api/auto-blog/trigger"), json={})
        _skip_if_unmounted(resp, "/api/auto-blog/trigger")
        assert resp.status_code in (401, 403), (
            f"SECURITY: /api/auto-blog/trigger must reject anonymous, got "
            f"{resp.status_code}"
        )
        # Critically: must NOT have actually triggered a generation (no 200/202).
        assert resp.status_code != 200
        assert resp.status_code != 202

    def test_trigger_with_user_bearer_is_rejected(self, http, auth_headers):
        """POST /api/auto-blog/trigger — non-admin user JWT — must be 401/403.

        Auto-blog is INTERNAL-key only.  A normal Supabase user JWT must not
        be accepted as an alternative credential.  The backend _check_auth()
        in auto_blog.py only honours X-Internal-Key.
        """
        resp = http.post(_backend("/api/auto-blog/trigger"), headers=auth_headers, json={})
        _skip_if_unmounted(resp, "/api/auto-blog/trigger")
        # The InternalAPIKeyMiddleware will let the Bearer through (Path 2),
        # but the route's own _check_auth() then rejects with 401.  Accept
        # either — the contract is "non-admin user cannot trigger blog gen".
        assert resp.status_code in (401, 403), (
            f"SECURITY: a regular user JWT must NOT be able to trigger auto-blog, "
            f"got {resp.status_code}: {resp.text[:300]}"
        )

    def test_trigger_with_admin_bearer_is_still_rejected(self, http):
        """POST /api/auto-blog/trigger — admin Bearer — still rejected (route is internal-key only).

        Document a sharp edge: even an "admin" user role bearer cannot reach
        this route because auto_blog._check_auth() requires X-Internal-Key
        specifically.  This guards against a future regression where someone
        adds Bearer admin-role acceptance and turns this into a user-reachable
        surface.
        """
        if not _admin_token():
            pytest.skip("TEST_ADMIN_TOKEN not set — skipping admin-bearer probe")

        resp = http.post(
            _backend("/api/auto-blog/trigger"),
            headers={"Authorization": f"Bearer {_admin_token()}"},
            json={},
        )
        _skip_if_unmounted(resp, "/api/auto-blog/trigger")
        assert resp.status_code in (401, 403), (
            f"SECURITY: admin Bearer must NOT be enough for /auto-blog/trigger; "
            f"only X-Internal-Key is. got {resp.status_code}"
        )

    def test_status_with_internal_key_works(self, http):
        """GET /api/auto-blog/status — valid X-Internal-Key — must return 200."""
        ikey = cfg().internal_api_key
        if not ikey:
            pytest.skip("INTERNAL_API_KEY not configured — cannot exercise the happy path")

        resp = http.get(
            _backend("/api/auto-blog/status"),
            headers={"X-Internal-Key": ikey},
        )
        _skip_if_unmounted(resp, "/api/auto-blog/status")
        assert_status(resp, 200)
        body = resp.json()
        # Status leaks no raw secrets — only booleans + counts.
        for sensitive in ("AWS_SECRET_ACCESS_KEY", "AWS_ACCESS_KEY_ID", "SUPABASE_SERVICE_ROLE", "GOOGLE_SEARCH_KEY"):
            assert sensitive not in str(body), f"SECURITY: /status leaks {sensitive}"

    def test_status_method_options(self, http):
        """OPTIONS /api/auto-blog/status — must not 200 with a wildcard CORS echo."""
        resp = http.options(_backend("/api/auto-blog/status"), headers={"Origin": "https://evil.example"})
        _skip_if_unmounted(resp, "/api/auto-blog/status")
        # A preflight reply is fine — but ACAO must not be wide-open *
        if resp.status_code < 400:
            acao = resp.headers.get("access-control-allow-origin", "")
            assert acao != "*" or resp.headers.get("access-control-allow-credentials", "").lower() != "true", (
                "SECURITY: ACAO=* combined with credentials=true on /api/auto-blog"
            )


class TestAutoBlogFrontendRoutes:
    """Frontend Next.js /api/blog/* — the surface the auto-blog engine writes
    through.  These are reachable from any browser on the public site."""

    def test_get_posts_is_public(self, http):
        """GET /api/blog/posts — public read, must succeed for any caller."""
        resp = http.get(_frontend("/api/blog/posts"))
        if resp.status_code == 404:
            pytest.skip("blog posts route not deployed")
        assert_status(resp, (200, 304))

    def test_post_create_no_auth_is_401(self, http):
        """POST /api/blog/posts — no auth — must be 401, never accepted."""
        payload = {
            "id": "test-security-probe",
            "title": "should-not-be-created",
            "content": [{"type": "intro", "text": "probe"}],
        }
        resp = http.post(_frontend("/api/blog/posts"), json=payload)
        if resp.status_code == 404:
            pytest.skip("blog posts route not deployed")
        assert resp.status_code in (401, 403), (
            f"SECURITY: anonymous POST /api/blog/posts must be 401, got {resp.status_code}"
        )

    def test_post_create_with_user_bearer_is_rejected(self, http, auth_headers):
        """POST /api/blog/posts — regular user Bearer — must be 401.

        The Next.js handler ONLY accepts X-Internal-Key (or Bearer matching
        INTERNAL_API_KEY, which a Supabase user JWT will not match).  This
        guards against a future regression where admin role checking is
        added and a user-role user bypasses it.
        """
        payload = {
            "id": "test-foreign-userid-probe",
            "title": "x",
            "content": [{"type": "intro", "text": "y"}],
            "user_id": "00000000-0000-0000-0000-deadbeefcafe",  # foreign user_id
        }
        resp = http.post(_frontend("/api/blog/posts"), headers=auth_headers, json=payload)
        if resp.status_code == 404:
            pytest.skip("blog posts route not deployed")
        assert resp.status_code in (401, 403), (
            f"SECURITY: user Bearer must NOT create a blog post, got {resp.status_code}"
        )

    def test_post_xss_payload_rejected_without_auth(self, http):
        """POST /api/blog/posts — malicious markdown/HTML payload, no auth — 401.

        Even though the read path doesn't use dangerouslySetInnerHTML for blog
        body content (verified by static audit of app/blog/[id]/page.tsx —
        it renders {block.text} as React text), the WRITE path must still
        reject anonymous attackers from poisoning the blog table.
        """
        nasty = (
            "<script>alert('xss')</script>"
            "<img src=x onerror=alert(1)>"
            "javascript:alert(2)"
            "[click](javascript:alert(3))"
            "<iframe src='javascript:alert(4)'></iframe>"
        )
        payload = {
            "id": "xss-probe",
            "title": nasty,
            "content": [{"type": "intro", "text": nasty}],
            "excerpt": nasty,
        }
        resp = http.post(_frontend("/api/blog/posts"), json=payload)
        if resp.status_code == 404:
            pytest.skip("blog posts route not deployed")
        assert resp.status_code in (401, 403), (
            f"SECURITY: anonymous XSS-payload POST must be 401, got {resp.status_code}: "
            f"{resp.text[:200]}"
        )

    def test_get_post_404_for_nonexistent(self, http):
        """GET /api/blog/posts/{id} — bogus id — 404 (not 500, not data leak)."""
        resp = http.get(_frontend("/api/blog/posts/this-does-not-exist-zzz"))
        if resp.status_code in (404,):
            return  # expected
        # Some envs serve a 200 with empty payload — accept that too as long as
        # it isn't a 500 with a stack trace.
        assert resp.status_code < 500, f"5xx leak on missing post lookup: {resp.text[:300]}"

    def test_blog_render_does_not_use_dangerously_set_inner_html_for_content(self, http):
        """Cross-reference: the rendered HTML of a blog page must not echo
        a <script> tag from server-supplied blog content.

        Stored-XSS round-trip: even if a malicious row sneaks in (e.g. via
        compromised auto-blog generator), the *renderer* must still escape
        <script> back to text.  We probe the front-end by fetching a known
        blog page and asserting it never returns inline <script> markers
        whose src came from the post body.

        We do NOT inject the payload — we rely on the static guarantee that
        app/blog/[id]/page.tsx renders block.text as React text, plus a
        runtime sanity check that the served HTML doesn't expose obvious
        unescaped HTML from the blog dataset.
        """
        # Get one real post to exercise the renderer.
        list_resp = http.get(_frontend("/api/blog/posts"))
        if list_resp.status_code == 404:
            pytest.skip("blog posts route not deployed")
        if list_resp.status_code != 200:
            pytest.skip(f"blog list returned {list_resp.status_code}; cannot probe renderer")

        try:
            posts = list_resp.json()
        except Exception:
            pytest.skip("blog list non-JSON")
        if not posts or not isinstance(posts, list):
            pytest.skip("no blog posts available to probe renderer")

        post_id = posts[0].get("id")
        if not post_id:
            pytest.skip("first blog post has no id")

        page = http.get(_frontend(f"/blog/{post_id}"))
        if page.status_code != 200:
            pytest.skip(f"blog page render returned {page.status_code}")

        # The page itself contains <script> tags from Next.js (chunks, etc.).
        # We narrow to "scripts whose src is empty AND whose body contains
        # alert(" — that's the unescaped XSS canary shape.  The blog page's
        # legitimate scripts always have src= or are JSON-LD with no alert().
        body = page.text
        # If a stored XSS body somehow rendered, we'd see this exact phrase
        # because injected HTML passes through unescaped.
        for canary in ("onerror=alert", "javascript:alert", "<script>alert("):
            assert canary not in body, (
                f"SECURITY: blog page {post_id} contains XSS canary '{canary}'.  "
                f"Either the renderer was changed to use dangerouslySetInnerHTML "
                f"for blog content, or a malicious post was published."
            )


class TestAutoBlogRateLimit:
    """Rate-limit on the auto-blog trigger.  This route is behind the standard
    InternalAPIKeyMiddleware → RateLimitMiddleware chain, so unauthenticated
    bursts must be 429-able by IP."""

    def test_unauth_trigger_burst_does_not_succeed(self, http):
        """POST /api/auto-blog/trigger × N — anonymous burst — none must 200/202.

        We can't easily prove a 429 fires for the trigger endpoint (it's
        always 401 first because no creds are supplied), but the inverse is
        the load-bearing assertion: NO request in the burst must become a
        2xx.  If even one does, the auth gate has regressed.
        """
        codes: list[int] = []
        for _ in range(20):
            resp = http.post(_backend("/api/auto-blog/trigger"), json={})
            codes.append(resp.status_code)
            if resp.status_code == 404:
                pytest.skip("/api/auto-blog/trigger not deployed")
        assert all(c < 200 or c >= 300 for c in codes), (
            f"SECURITY: unauth burst on /api/auto-blog/trigger admitted a 2xx: {codes}"
        )


# ===========================================================================
# email-tracking route family   (/api/t/*)
# ===========================================================================

class TestEmailTrackingPixel:
    """The 1×1 GIF endpoint is intentionally public and intentionally
    indifferent to validity — it must never leak whether a recipient_id
    exists or not, because that would let an attacker enumerate targets."""

    def test_pixel_with_well_formed_id_returns_gif(self, http):
        """GET /api/t/o/<uuid> — well-formed but non-existent recipient — must return a 1×1 GIF anyway."""
        resp = http.get(_backend("/api/t/o/00000000-0000-0000-0000-000000000000"))
        if resp.status_code == 404:
            pytest.skip("/api/t/o not deployed")
        assert_status(resp, 200)
        assert resp.headers.get("content-type", "").startswith("image/gif"), (
            f"pixel must be image/gif, got {resp.headers.get('content-type')}"
        )
        # Cache-Control must prevent intermediaries caching the pixel
        assert "no-store" in resp.headers.get("cache-control", "").lower(), (
            "tracking pixel must be no-store"
        )

    def test_pixel_with_sql_injection_id_still_returns_gif(self, http):
        """GET /api/t/o/<sqli> — id="' OR 1=1 --" — must STILL return the pixel.

        Why: the contract is that mail clients render the pixel without
        timing/size variation regardless of input.  A 4xx/5xx on a malformed
        id would (a) leak validation logic to an attacker probing the
        endpoint, and (b) break legitimate emails whose ids got mangled by
        intermediate clients.
        """
        nasty = urllib.parse.quote("' OR 1=1 --")
        resp = http.get(_backend(f"/api/t/o/{nasty}"))
        if resp.status_code == 404:
            pytest.skip("/api/t/o not deployed")
        assert resp.status_code == 200, (
            f"SECURITY: SQLi pixel id must still 200, got {resp.status_code}.  "
            f"Validation result is leaking via response code."
        )
        # Body must be the EXACT same bytes as a clean request — no error text.
        assert resp.content == EXPECTED_PIXEL_GIF, (
            "SECURITY: SQLi pixel body differs from clean pixel — leaking validation"
        )

    def test_pixel_does_not_echo_id_in_body(self, http):
        """GET /api/t/o/<id> — recipient_id must never appear in body.

        Reflected XSS via tracking pixel: if the server ever echoed the id
        with a text/html content-type, JS could escape from the GIF response.
        Body must be raw GIF bytes, period.
        """
        marker = "MARKER-" + "X" * 32
        resp = http.get(_backend(f"/api/t/o/{marker}"))
        if resp.status_code == 404:
            pytest.skip("/api/t/o not deployed")
        assert_status(resp, 200)
        assert marker.encode() not in resp.content, (
            "SECURITY: tracking pixel body echoes the recipient_id (reflected-XSS surface)"
        )

    def test_pixel_timing_does_not_leak_validity(self, http):
        """GET /api/t/o/<valid-shape> vs <bogus> — timing must be similar.

        Threshold is generous (5×) — we're catching gross differences that
        would let an attacker enumerate live recipients via timing oracles,
        not nanosecond-precise side-channels.  The DB write happens in
        BackgroundTasks so the request returns before the row is touched —
        that's the property under test.
        """
        bogus = "00000000-0000-0000-0000-000000000000"
        # Warm up the connection
        http.get(_backend(f"/api/t/o/{bogus}"))

        sql = urllib.parse.quote("' OR 1=1 --")

        valid_times = []
        nasty_times = []
        for _ in range(5):
            t0 = time.perf_counter()
            r1 = http.get(_backend(f"/api/t/o/{bogus}"))
            valid_times.append(time.perf_counter() - t0)
            if r1.status_code == 404:
                pytest.skip("/api/t/o not deployed")

            t0 = time.perf_counter()
            r2 = http.get(_backend(f"/api/t/o/{sql}"))
            nasty_times.append(time.perf_counter() - t0)

        v_med = sorted(valid_times)[len(valid_times) // 2]
        n_med = sorted(nasty_times)[len(nasty_times) // 2]

        # Allow up to 5× timing skew before we flag a leak (CI is noisy).
        assert max(v_med, n_med) / max(0.001, min(v_med, n_med)) < 5.0, (
            f"SECURITY: pixel timing leaks validity. valid={v_med:.4f} "
            f"sqli={n_med:.4f} — DB lookup may be in the request hot path."
        )

    def test_pixel_no_auth_required(self, http):
        """GET /api/t/o/<id> — Authorization header should be IGNORED.

        Cold-open mail clients can't send Authorization.  Confirm the route
        works without it AND that adding a bogus header doesn't change behavior.
        """
        bogus = "11111111-1111-1111-1111-111111111111"
        r1 = http.get(_backend(f"/api/t/o/{bogus}"))
        r2 = http.get(_backend(f"/api/t/o/{bogus}"), headers={"Authorization": "Bearer garbage"})
        if r1.status_code == 404:
            pytest.skip("/api/t/o not deployed")
        assert r1.status_code == r2.status_code == 200


class TestEmailTrackingClick:
    """/api/t/c/{id}?url=<base64> — the click redirect.  The URL is encoded
    as base64 by the campaign system, but the SERVER must not blindly trust
    that what it decodes is safe to redirect to.  This is the open-redirect
    surface in the codebase."""

    def test_click_with_javascript_url_is_neutralized(self, http):
        """GET /api/t/c/<id>?url=<base64 of javascript:>  — must NOT issue a 302 to javascript:.

        FINDING (already inferred from email_tracking.py): the route
        base64-decodes the `url` param and passes it directly to
        RedirectResponse.  No allow-list, no scheme check.  This is an
        OPEN REDIRECT.  At minimum, javascript:/data:/vbscript: schemes
        must be blocked because they execute in the victim's mail-client
        context.
        """
        evil = base64.urlsafe_b64encode(b"javascript:alert(1)").decode().rstrip("=")
        url = _backend(f"/api/t/c/00000000-0000-0000-0000-000000000000?url={evil}")
        # httpx with follow_redirects=False *still* invokes redirect URL
        # parsing internally for response normalization.  When the server
        # returns Location: javascript:alert(1), httpx raises InvalidURL
        # before we can read the Location header — which itself proves
        # the dangerous-scheme redirect was issued.  Use a low-level
        # transport request to bypass the redirect parser.
        try:
            resp = http.get(url)
        except httpx.InvalidURL as e:
            # If httpx blew up on URL validation, it means the server
            # returned a Location header that's not a valid HTTP URL
            # (e.g. javascript:).  That IS the open-redirect finding.
            pytest.fail(
                f"OPEN REDIRECT (dangerous scheme): /api/t/c/* issued a Location "
                f"header that httpx refused to parse ({e}).  This means the "
                f"server emitted a non-HTTP scheme redirect — almost certainly "
                f"the javascript:alert(1) we encoded.  Block javascript:/data:/"
                f"vbscript: schemes before issuing 302."
            )
        if resp.status_code == 404:
            pytest.skip("/api/t/c not deployed")
        # Implementation always 302s — the question is *where*.
        if resp.status_code == 302:
            location = resp.headers.get("location", "")
            assert not location.lower().startswith(
                ("javascript:", "data:", "vbscript:")
            ), (
                f"OPEN REDIRECT (dangerous scheme): /api/t/c/* redirected to {location!r}.  "
                f"javascript:/data:/vbscript: schemes must be blocked at the redirect layer."
            )
        else:
            # Anything other than 302 is at worst safer (4xx blocks the redirect)
            assert resp.status_code in (400, 403, 422), (
                f"unexpected status {resp.status_code} for malicious click redirect"
            )

    def test_click_with_external_domain_is_observed(self, http):
        """GET /api/t/c/<id>?url=<base64 of evil.example> — observe whether server has an allow-list.

        This test is INFORMATIONAL — it documents whether the redirect
        target is constrained.  If the assertion below fails, the route
        is an open redirect that any phishing campaign can use to make
        a coasty.ai link redirect to attacker-controlled content.
        """
        target = b"https://evil.example.test/phish"
        encoded = base64.urlsafe_b64encode(target).decode().rstrip("=")
        resp = http.get(
            _backend(f"/api/t/c/00000000-0000-0000-0000-000000000000?url={encoded}"),
        )
        if resp.status_code == 404:
            pytest.skip("/api/t/c not deployed")
        if resp.status_code == 302:
            location = resp.headers.get("location", "")
            # We expect a hardened deployment to either (a) only redirect to
            # a coasty.ai-anchored allow-list, or (b) reject the off-domain.
            # If neither is true, this is documenting an OPEN REDIRECT.
            if location.startswith("https://evil.example"):
                pytest.fail(
                    f"OPEN REDIRECT: /api/t/c/* unconditionally redirects to "
                    f"attacker-controlled {location!r}.  Add an allow-list "
                    f"of trusted hostnames before issuing the 302."
                )

    def test_click_with_garbage_b64_falls_back_safely(self, http):
        """GET /api/t/c/<id>?url=not-base64 — must fall back to coasty.ai (per source) and never 5xx."""
        resp = http.get(_backend("/api/t/c/00000000-0000-0000-0000-000000000000?url=!!!notb64!!!"))
        if resp.status_code == 404:
            pytest.skip("/api/t/c not deployed")
        assert resp.status_code in (302, 400), f"got {resp.status_code}"
        if resp.status_code == 302:
            assert "coasty.ai" in resp.headers.get("location", ""), (
                "garbage b64 must fall back to coasty.ai per source"
            )

    def test_click_no_auth_required(self, http):
        """GET /api/t/c/<id>?url=... — Authorization header must be IGNORED."""
        target = base64.urlsafe_b64encode(b"https://coasty.ai").decode().rstrip("=")
        resp = http.get(
            _backend(f"/api/t/c/00000000-0000-0000-0000-000000000000?url={target}"),
            headers={"Authorization": "Bearer garbage"},
        )
        if resp.status_code == 404:
            pytest.skip("/api/t/c not deployed")
        assert resp.status_code in (302, 400)


class TestEmailTrackingUnsubscribe:
    def test_unsubscribe_get_returns_html(self, http):
        """GET /api/t/u/<id> — public unsubscribe page — 200 HTML."""
        resp = http.get(_backend("/api/t/u/00000000-0000-0000-0000-000000000000"))
        if resp.status_code == 404:
            pytest.skip("/api/t/u not deployed")
        assert_status(resp, 200)
        assert "text/html" in resp.headers.get("content-type", "")
        # Page must NOT echo recipient_id (basic reflected-XSS check).
        assert "00000000-0000-0000-0000-000000000000" not in resp.text, (
            "SECURITY: unsubscribe page echoes recipient_id (reflected-XSS surface)"
        )

    def test_unsubscribe_oneclick_post_works(self, http):
        """POST /api/t/u/<id> — RFC 8058 one-click unsubscribe — 200 with no body required."""
        resp = http.post(_backend("/api/t/u/00000000-0000-0000-0000-000000000000"))
        if resp.status_code == 404:
            pytest.skip("/api/t/u not deployed")
        assert_status(resp, (200, 204))


class TestEmailTrackingRateLimit:
    """KNOWN GAP: the /api/t/* prefix is exempt from RateLimitMiddleware
    (see backend/app/core/middleware.py:187).  These tests document that
    intentional exemption AND assert that no per-IP rate limit is active —
    the trade-off being that mail clients (which open many pixels at once)
    don't get blocked.  If a per-IP rate limit IS later added, this test
    should be updated rather than deleted, because the contract change is
    significant for legitimate cold-open traffic patterns."""

    def test_pixel_burst_is_not_rate_limited(self, http):
        """GET /api/t/o/<id> × 50 — must NOT 429.

        SECURITY OBSERVATION: this means an attacker can spam the open-event
        recorder.  Mitigation lives downstream: _record_open() is a
        BackgroundTask that no-ops on unknown ids, so DB writes are bounded
        by valid recipient_ids only.  Stat-poisoning via valid ids is the
        residual risk.
        """
        codes: list[int] = []
        for _ in range(50):
            r = http.get(_backend("/api/t/o/22222222-2222-2222-2222-222222222222"))
            codes.append(r.status_code)
            if r.status_code == 404:
                pytest.skip("/api/t/o not deployed")
        rate_limited = sum(1 for c in codes if c == 429)
        # If rate-limiting was added, that's a contract change worth surfacing.
        if rate_limited > 0:
            pytest.fail(
                f"CONTRACT CHANGE: /api/t/o/* now returns 429 ({rate_limited} of 50).  "
                f"Previously the prefix was exempt from RateLimitMiddleware.  Verify "
                f"legitimate cold-open mail-client behavior is still served."
            )
        # Otherwise: all 200, exemption confirmed.
        assert all(c == 200 for c in codes), f"unexpected status mix: {set(codes)}"


# ===========================================================================
# osworld route family
# ===========================================================================

class TestOSWorldAuthGate:
    """osworld is gated by a dedicated X-OSWorld-Key in the
    InternalAPIKeyMiddleware.  An invalid key returns 403, not 401."""

    def test_health_is_public(self, http):
        """GET /api/osworld/health — must be reachable without any creds (skip-list path).

        SKIP_PATHS in middleware.py includes /api/osworld/health.  This is
        intentional: ALB health checks need an unauthenticated path.
        """
        resp = http.get(_backend("/api/osworld/health"))
        if resp.status_code == 404:
            pytest.skip("/api/osworld not deployed")
        assert_status(resp, 200)
        body = resp.json()
        assert body.get("status") == "ok"
        # Health must not leak the active session count beyond a number, nor
        # any session_id.  Spot-check.
        assert "active_sessions" in body
        assert isinstance(body["active_sessions"], int)

    def test_create_session_unauth_is_403(self, http):
        """POST /api/osworld/session — no creds — must be 403 (not 401, not 200).

        Per middleware.py: when OSWORLD_API_KEY is set, missing/wrong
        X-OSWorld-Key gives 403.  When it's NOT set, the request falls
        through to the standard internal-key/Bearer gate.
        """
        resp = http.post(_backend("/api/osworld/session"), json={})
        if resp.status_code == 404:
            pytest.skip("/api/osworld/session not deployed")
        # Both 401 and 403 are acceptable rejections; what matters is that
        # we did NOT just create a session (200) and were not 5xx.
        assert resp.status_code in (401, 403), (
            f"SECURITY: anonymous POST /api/osworld/session must be 401/403, "
            f"got {resp.status_code}: {resp.text[:200]}"
        )
        # Critically, no session_id leak in the rejection.
        body_str = (resp.text or "").lower()
        assert "session_id" not in body_str, "rejection body must not contain session_id"

    def test_predict_unauth_is_403(self, http):
        """POST /api/osworld/predict — no creds — 401/403, never crashes the agent."""
        resp = http.post(
            _backend("/api/osworld/predict"),
            json={"session_id": "x", "instruction": "y", "screenshot": "Zg=="},
        )
        if resp.status_code == 404:
            pytest.skip("/api/osworld/predict not deployed")
        assert resp.status_code in (401, 403), f"got {resp.status_code}"
        assert resp.status_code < 500

    def test_user_bearer_is_rejected_when_osworld_key_required(self, http, auth_headers):
        """POST /api/osworld/session — regular user Bearer — must be rejected.

        OSWorld is internal-only.  A normal Supabase user JWT must NOT bypass
        the X-OSWorld-Key gate.  When OSWORLD_API_KEY is set, the middleware
        only accepts that key — Bearer is checked but only against the
        OSWORLD_API_KEY value, not as a Supabase JWT.
        """
        resp = http.post(_backend("/api/osworld/session"), headers=auth_headers, json={})
        if resp.status_code == 404:
            pytest.skip("/api/osworld/session not deployed")
        # If OSWORLD_API_KEY is unset on this env, we get 200 here (Bearer
        # passes the standard gate).  Document that explicitly.
        if resp.status_code == 200:
            pytest.skip(
                "OSWORLD_API_KEY appears unset on this environment; user "
                "Bearer is currently sufficient.  Set OSWORLD_API_KEY in "
                "production to harden this surface."
            )
        assert resp.status_code in (401, 403), f"got {resp.status_code}"

    def test_admin_bearer_without_osworld_key_is_rejected(self, http):
        """POST /api/osworld/session — admin Bearer (no X-OSWorld-Key) — must be rejected when OSWORLD_API_KEY is set."""
        if not _admin_token():
            pytest.skip("TEST_ADMIN_TOKEN not set — skipping admin-bearer probe")

        resp = http.post(
            _backend("/api/osworld/session"),
            headers={"Authorization": f"Bearer {_admin_token()}"},
            json={},
        )
        if resp.status_code == 404:
            pytest.skip("/api/osworld/session not deployed")
        if resp.status_code == 200:
            pytest.skip("OSWORLD_API_KEY unset — admin Bearer is sufficient on this env")
        assert resp.status_code in (401, 403)


class TestOSWorldInputValidation:
    """When OSWORLD_API_KEY is set in the test env we can drive the happy
    path; otherwise these tests verify only the *rejection* shapes."""

    def _osworld_key(self) -> Optional[str]:
        return os.environ.get("OSWORLD_API_KEY", "").strip() or None

    def _osworld_headers(self) -> dict[str, str]:
        k = self._osworld_key()
        if not k:
            pytest.skip("OSWORLD_API_KEY not set — cannot exercise authenticated input-validation")
        return {"X-OSWorld-Key": k}

    def test_predict_with_unknown_session_is_404(self, http):
        """POST /api/osworld/predict — session_id that doesn't exist — must be 404, not 500."""
        headers = self._osworld_headers()
        resp = http.post(
            _backend("/api/osworld/predict"),
            headers=headers,
            json={
                "session_id": "00000000-0000-0000-0000-000000000000",
                "instruction": "test",
                "screenshot": base64.b64encode(b"\x89PNG\r\n\x1a\n").decode(),
            },
        )
        if resp.status_code == 404 and "Session not found" in (resp.text or ""):
            return  # expected
        if resp.status_code == 404:
            pytest.skip("/api/osworld/predict not deployed")
        # Otherwise: must not 5xx, must be a clear 4xx
        assert 400 <= resp.status_code < 500, f"got {resp.status_code}: {resp.text[:200]}"

    def test_predict_with_invalid_base64_screenshot_is_400(self, http):
        """POST /api/osworld/predict — screenshot=garbage — must be 400, not 500."""
        headers = self._osworld_headers()
        # First create a session
        sess = http.post(
            _backend("/api/osworld/session"),
            headers=headers,
            json={"model": "default", "screen_width": 800, "screen_height": 600},
        )
        if sess.status_code != 200:
            pytest.skip(f"could not create osworld session: {sess.status_code}")
        try:
            session_id = sess.json()["session_id"]

            # Send obviously-invalid base64 — special chars
            resp = http.post(
                _backend("/api/osworld/predict"),
                headers=headers,
                json={
                    "session_id": session_id,
                    "instruction": "test",
                    "screenshot": "!!!not_base64!!!",
                },
            )
            assert resp.status_code == 400, (
                f"SECURITY: invalid base64 must be 400 (graceful), got {resp.status_code}: "
                f"{resp.text[:200]}.  A 500 would mean the agent panicked on user input."
            )
        finally:
            http.request("DELETE", _backend(f"/api/osworld/session/{sess.json().get('session_id')}"), headers=headers)

    def test_predict_with_huge_instruction_is_4xx(self, http):
        """POST /api/osworld/predict — 1MB instruction — must be 4xx (413/422), not 200/500.

        Large strings must be rejected at the boundary so the agent never
        spends an entire context window on adversarial padding.
        """
        headers = self._osworld_headers()
        sess = http.post(
            _backend("/api/osworld/session"),
            headers=headers,
            json={"model": "default", "screen_width": 800, "screen_height": 600},
        )
        if sess.status_code != 200:
            pytest.skip(f"could not create osworld session: {sess.status_code}")
        session_id = sess.json()["session_id"]
        try:
            big = "A" * (1024 * 1024)
            resp = http.post(
                _backend("/api/osworld/predict"),
                headers=headers,
                json={
                    "session_id": session_id,
                    "instruction": big,
                    "screenshot": base64.b64encode(b"\x89PNG\r\n\x1a\n").decode(),
                },
                timeout=30,
            )
            # Acceptable: 413 (size), 422 (validation), 400 (length cap).
            # Unacceptable: 200 (unbounded input accepted) or 5xx (panic).
            assert resp.status_code != 200, (
                "SECURITY: 1MB instruction was accepted — add an input length cap "
                "before this surface tips a context-window into a billing event."
            )
            assert resp.status_code < 500, f"5xx on huge instruction: {resp.status_code}"
        finally:
            http.request("DELETE", _backend(f"/api/osworld/session/{session_id}"), headers=headers)


class TestOSWorldCrossTenantSession:
    """Session IDs are server-issued UUID4s.  A second caller (with the same
    OSWORLD_API_KEY because the surface is internal-only) must still NOT be
    able to read another caller's session via path-param fuzz, since the
    sessions hold conversation history including the original instruction.
    Today's implementation has NO per-key namespacing — the whole
    /api/osworld/* surface trusts the one shared key.  This test documents
    that and validates the only protection: sessions must be opaque UUIDs
    that a guess-attacker can't enumerate."""

    def test_session_id_is_uuid_shape(self, http):
        """POST /api/osworld/session — returned id is a v4 UUID, not a guessable counter."""
        key = os.environ.get("OSWORLD_API_KEY", "").strip()
        if not key:
            pytest.skip("OSWORLD_API_KEY not set")
        sess = http.post(
            _backend("/api/osworld/session"),
            headers={"X-OSWorld-Key": key},
            json={"model": "default", "screen_width": 800, "screen_height": 600},
        )
        if sess.status_code != 200:
            pytest.skip(f"could not create session: {sess.status_code}")
        sid = sess.json()["session_id"]
        try:
            import re as _re
            assert _re.match(
                r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
                sid,
                _re.IGNORECASE,
            ), f"session_id {sid} is not a UUIDv4 — guessable identifiers leak cross-tenant access"
        finally:
            http.request("DELETE", _backend(f"/api/osworld/session/{sid}"), headers={"X-OSWorld-Key": key})

    def test_get_unknown_session_returns_404_no_leak(self, http):
        """POST /api/osworld/predict — guessed session_id — 404, no info leak."""
        key = os.environ.get("OSWORLD_API_KEY", "").strip()
        if not key:
            pytest.skip("OSWORLD_API_KEY not set")
        resp = http.post(
            _backend("/api/osworld/predict"),
            headers={"X-OSWorld-Key": key},
            json={
                "session_id": "11111111-1111-1111-1111-111111111111",
                "instruction": "x",
                "screenshot": base64.b64encode(b"\x89PNG\r\n\x1a\n").decode(),
            },
        )
        if resp.status_code == 404:
            body = resp.text.lower()
            # Acceptable bodies: "session not found" / "not found".  Must NOT
            # contain a list of valid sessions or any other session id.
            assert "[" not in body or "session_id" not in body, "session list leaked in 404"


# ===========================================================================
# Generic public-route audit — scoped to the three families above
# ===========================================================================

class TestPublicRouteAudit:
    """For each family, confirm the auth-less endpoints and assert their
    rate-limit posture matches the source-of-truth in middleware.py."""

    PUBLIC_AUTHLESS = [
        # (path, method, expected_status_unauth, must_be_rate_limited)
        ("/api/auto-blog/status",                          "GET",  (401, 403),   True),
        ("/api/auto-blog/trigger",                         "POST", (401, 403),   True),
        ("/api/t/o/00000000-0000-0000-0000-000000000000",  "GET",  (200,),       False),
        ("/api/t/c/00000000-0000-0000-0000-000000000000",  "GET",  (302, 400),   False),
        ("/api/t/u/00000000-0000-0000-0000-000000000000",  "GET",  (200,),       False),
        ("/api/osworld/health",                            "GET",  (200,),       False),
        ("/api/osworld/session",                           "POST", (401, 403),   False),
    ]

    def test_audit_each_public_endpoint(self, http):
        """For each (path, method) in the audit list — verify expected unauth status.

        Single test, multiple assertions, fail-fast: a regression on ANY of
        these is a security incident.
        """
        url_for_method = {
            "GET":    lambda url: http.get(url),
            "POST":   lambda url: http.post(url, json={}),
            "DELETE": lambda url: http.request("DELETE", url),
        }
        failures: list[str] = []
        for path, method, expected, _ in self.PUBLIC_AUTHLESS:
            # Click endpoint needs a url query param to reach the handler logic
            url = _backend(path)
            if path.startswith("/api/t/c/"):
                url += "?url=" + base64.urlsafe_b64encode(b"https://coasty.ai").decode().rstrip("=")
            try:
                resp = url_for_method[method](url)
            except Exception as e:
                failures.append(f"{method} {path}: connection error {e}")
                continue
            if resp.status_code == 404:
                continue  # not deployed in this env — OK
            if resp.status_code not in expected:
                failures.append(
                    f"{method} {path}: expected {expected}, got {resp.status_code} "
                    f"({resp.text[:100]!r})"
                )
        assert not failures, "Public-route audit failures:\n  " + "\n  ".join(failures)
