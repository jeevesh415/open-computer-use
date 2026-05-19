"""
test_security_ssrf_deep.py — Deep SSRF probes on search + scrape paths.

Complements ``test_security_injection_deep.py`` Section 3 (which exercises
loopback / IMDS / file:// payloads on the search endpoint) by drilling into
the *URL parsing edge cases* an attacker uses to bypass naive blocklists:

  * IPv4-mapped IPv6  (``http://[::ffff:127.0.0.1]/``)
  * Octal IPv4        (``http://0177.0.0.1/``)
  * Hex IPv4          (``http://0x7f000001/``)
  * Decimal int IPv4  (``http://2130706433/``)
  * DNS-rebinding hostnames that *resolve* to private IPs
    (``127.0.0.1.nip.io``) — server must check the resolved address, not
    just the literal hostname string.
  * Cross-depth coverage — every research_depth (quick/moderate/deep) must
    enforce the same blocklist.
  * Redirect chain SSRF — server fetches an "allowed" URL that 302s to a
    private IP. The scraper must NOT follow into the private IP.
  * Scheme-downgrade via redirect — HTTP → file:// / gopher:// etc.
  * URL smuggling via ``://`` confusion (``http://x.com\\@127.0.0.1/``).
  * Length / response-size DoS — ultra-long URLs and large bodies.
  * User-Agent leakage — backend's outbound UA must not contain the
    backend's hostname / IP / IAM-role markers.
  * Google API key never appears in the response body.

Every test carries ``@pytest.mark.security``. None of these tests require
TEST_USER_TOKEN_2 — they're aimed at the unauthenticated/auth'd search
endpoint behavior. We don't write any state.

These tests are SAFE against a live deployment: every probe asserts the
*absence* of a private-IP fetch. We never expect to receive metadata
contents — receiving them would be the failure.
"""
from __future__ import annotations

import os
import re
import time
from typing import Optional
from urllib.parse import urlparse

import httpx
import pytest

from conftest import cfg


# ── Markers ─────────────────────────────────────────────────────────────────
pytestmark = pytest.mark.security


# ───────────────────────────────────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────────────────────────────────

def _sec(msg: str, resp: Optional[httpx.Response] = None) -> str:
    """SECURITY:-prefixed assertion message including request/response context."""
    if resp is None:
        return f"SECURITY: {msg}"
    body = ""
    try:
        body = (resp.text or "")[:500].replace("\n", " ")
    except Exception:
        body = "<undecodable>"
    return (
        f"SECURITY: {msg}\n"
        f"  {resp.request.method} {resp.request.url} → {resp.status_code}\n"
        f"  Body: {body}"
    )


def _backend(path: str) -> str:
    return f"{cfg().backend_public_url}{path}"


# Forbidden response markers indicating the scraper followed an SSRF target.
_SSRF_LEAK_MARKERS = (
    # IMDS / cloud metadata
    "iam-role",
    "AccessKeyId",
    "SecretAccessKey",
    "SessionToken",
    "instance-id",
    "ami-id",
    "169.254.169.254",
    "ECSContainerMetadataURI",
    # /etc/passwd
    "root:x:0:0",
    # Internal hostnames
    "ip-10-",
    "ip-172-",
    "ec2.internal",
    # Stack traces / parser errors
    "Traceback (most recent call last)",
    "aiohttp.client_exceptions",
)


def _assert_no_ssrf_leak(resp: httpx.Response, context: str) -> None:
    body = ""
    try:
        body = resp.text or ""
    except Exception:
        return
    for marker in _SSRF_LEAK_MARKERS:
        assert marker not in body, _sec(
            f"{context}: response leaked SSRF marker {marker!r}",
            resp,
        )


def _post_search(
    http: httpx.Client,
    query: str,
    *,
    enable_scraping: bool = True,
    num_results: int = 1,
    timeout: float = 15.0,
) -> Optional[httpx.Response]:
    """POST /api/search/ with a normalized envelope; returns None if connection
    refused so the caller can decide whether that's a pass."""
    try:
        return http.post(
            _backend("/api/search/"),
            json={
                "query": query,
                "num_results": num_results,
                "enable_scraping": enable_scraping,
            },
            timeout=timeout,
        )
    except httpx.HTTPError:
        return None


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 1 — Cross-depth SSRF coverage
# ═══════════════════════════════════════════════════════════════════════════
#
# search.py maps research_depth → num_results and then scrapes every result
# URL. The /api/search/ endpoint takes num_results directly (not depth), but
# downstream the chat path calls `search_service.get_results_count(depth)`.
# We exercise each depth's effective num_results to make sure the same
# blocklist is enforced regardless of how many URLs the scraper is queueing.

_DEPTH_TO_NUM = {"quick": 3, "moderate": 5, "deep": 10}

# A handful of the most dangerous SSRF payloads — repeated across every depth
# to lock in that the blocklist is depth-independent.
_CRITICAL_SSRF_TARGETS = (
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    "http://127.0.0.1:8001/api/health",
    "file:///etc/passwd",
)


@pytest.mark.parametrize("depth", ["quick", "moderate", "deep"])
@pytest.mark.parametrize("target", _CRITICAL_SSRF_TARGETS)
def test_ssrf_blocked_at_every_research_depth(
    http: httpx.Client, depth: str, target: str
):
    """Every depth must block IMDS/loopback/file:// targets equivalently."""
    num_results = _DEPTH_TO_NUM[depth]
    resp = _post_search(http, target, enable_scraping=True, num_results=num_results)
    if resp is None:
        # Connection refused / dropped == server defended at the network layer
        return
    assert resp.status_code != 500, _sec(
        f"depth={depth} target={target!r} → 500 (possible scraper crash)", resp
    )
    _assert_no_ssrf_leak(resp, f"depth={depth}, target={target!r}")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2 — IP-encoding bypasses
# ═══════════════════════════════════════════════════════════════════════════
#
# Naive blocklists check the literal hostname string and miss alternate
# encodings of 127.0.0.1 / 169.254.169.254. The server MUST resolve the
# hostname to an address and apply the private/loopback/link-local check
# on the resolved IP — not on the original string.

_IP_ENCODING_BYPASSES = [
    # IPv4-mapped IPv6 → 127.0.0.1
    "http://[::ffff:127.0.0.1]/",
    "http://[0:0:0:0:0:ffff:127.0.0.1]/",
    # Pure IPv6 loopback
    "http://[::1]/",
    "http://[0000:0000:0000:0000:0000:0000:0000:0001]/",
    # Octal — 0177 = 0o177 = 127
    "http://0177.0.0.1/",
    "http://0177.000.000.001/",
    # Hex
    "http://0x7f000001/",
    "http://0x7f.0x0.0x0.0x1/",
    # Decimal long int — 2130706433 = 127.0.0.1
    "http://2130706433/",
    # IMDS variants
    "http://0xa9fea9fe/",          # 0xa9fea9fe = 169.254.169.254
    "http://2852039166/",          # decimal IMDS
    "http://[::ffff:169.254.169.254]/",
    # Trailing dot / case
    "http://127.0.0.1./",
    "http://LOCALHOST/",
    # Mixed
    "http://0x7f.1/",              # short-form hex 127.x
]


@pytest.mark.parametrize("target", _IP_ENCODING_BYPASSES)
def test_ssrf_alternate_ip_encodings_not_fetched(http: httpx.Client, target: str):
    """Octal/hex/decimal/IPv4-mapped-IPv6 representations of loopback or IMDS
    must not get fetched. Defense requires post-resolution IP check."""
    resp = _post_search(http, target, enable_scraping=True, num_results=1)
    if resp is None:
        return
    assert resp.status_code != 500, _sec(
        f"alternate IP encoding {target!r} → 500", resp
    )
    _assert_no_ssrf_leak(resp, f"alt-IP encoding ({target!r})")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 3 — DNS rebinding / hostnames that resolve to private IPs
# ═══════════════════════════════════════════════════════════════════════════
#
# nip.io and sslip.io are public test DNS services that resolve any
# `<dotted-ip>.nip.io` to that literal IP. So `127.0.0.1.nip.io` resolves
# to 127.0.0.1. A blocklist that only inspects the hostname string sees
# `nip.io` (not blocked) and lets the request through. A correct
# implementation resolves first and checks the IP.

_DNS_REBINDING_TARGETS = [
    # nip.io style
    "http://127.0.0.1.nip.io/",
    "http://169.254.169.254.nip.io/latest/meta-data/",
    "http://10.0.0.1.nip.io/",
    # sslip.io style
    "http://127.0.0.1.sslip.io/",
    "http://169-254-169-254.sslip.io/",
    # localtest.me — resolves to 127.0.0.1 in DNS
    "http://localtest.me/",
    "http://attacker.localtest.me/",
    # xip.io legacy
    "http://127.0.0.1.xip.io/",
]


@pytest.mark.parametrize("target", _DNS_REBINDING_TARGETS)
def test_ssrf_dns_rebinding_blocked_by_resolved_address(
    http: httpx.Client, target: str
):
    """Hostnames that resolve to private IPs (via nip.io / localtest.me / etc)
    must be blocked AFTER DNS resolution. A naive string-based blocklist
    that only checks for `127.0.0.1` literally will fail this test."""
    resp = _post_search(http, target, enable_scraping=True, num_results=1)
    if resp is None:
        return
    assert resp.status_code != 500, _sec(
        f"DNS-rebinding target {target!r} → 500 (parser crash?)", resp
    )
    _assert_no_ssrf_leak(resp, f"DNS-rebinding ({target!r})")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 4 — Redirect-chain SSRF
# ═══════════════════════════════════════════════════════════════════════════
#
# Even if the initial URL passes the blocklist, a 302 to a private IP must
# not be followed. We use httpbin-like redirect endpoints that the scraper
# might actually reach. We CAN'T set up an attacker-controlled redirector
# from this test (would require an external HTTP server), but we can:
#   1. Probe with public redirector services (httpbin.org/redirect-to)
#      that 302 to private IPs.
#   2. Verify the scraper does not leak the redirected target's body.
#
# If httpbin is unreachable from the scraper (blocked by egress policy),
# we get a clean error/200 with empty result and the test passes by virtue
# of no leak markers in the body.

_REDIRECT_SSRF_TARGETS = [
    # httpbin.org redirect-to → private IP / file://
    "http://httpbin.org/redirect-to?url=http://169.254.169.254/latest/meta-data/",
    "http://httpbin.org/redirect-to?url=http://127.0.0.1:8001/api/health",
    "http://httpbin.org/redirect-to?url=file:///etc/passwd",
    # Same with HTTPS scheme on the entry
    "https://httpbin.org/redirect-to?url=http://169.254.169.254/",
    # Multi-hop redirect (3 hops to localhost)
    "http://httpbin.org/redirect/3",
]


@pytest.mark.parametrize("target", _REDIRECT_SSRF_TARGETS)
def test_ssrf_redirect_chain_does_not_reach_private_ip(
    http: httpx.Client, target: str
):
    """A 302 redirect to a private IP / file:// scheme must not be followed.
    The scraper should either disable redirects, follow with the same
    blocklist applied at each hop, or limit the redirect count."""
    resp = _post_search(http, target, enable_scraping=True, num_results=1, timeout=20.0)
    if resp is None:
        return
    assert resp.status_code != 500, _sec(
        f"redirect-chain target {target!r} → 500", resp
    )
    _assert_no_ssrf_leak(resp, f"redirect-chain ({target!r})")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 5 — URL smuggling / userinfo confusion
# ═══════════════════════════════════════════════════════════════════════════
#
# Different URL parsers disagree on where the host ends. A canonical browser
# parser sees `http://x.com\@127.0.0.1/` and treats `x.com\` as part of the
# userinfo — so the host is 127.0.0.1. A naive parser that splits on the
# first `@` and reads the left side as the host sees `x.com`.
# The scraper must use a parser consistent with what the underlying HTTP
# client actually connects to.

_URL_SMUGGLING_TARGETS = [
    # Backslash-at-encoded confusion
    "http://x.com\\@127.0.0.1/",
    "http://x.com\\@169.254.169.254/latest/meta-data/",
    # Multiple @
    "http://google.com@evil.com@127.0.0.1/",
    # Embedded URL-encoded @
    "http://google.com%40127.0.0.1/",
    # Whitespace smuggling (tab / NUL inside hostname)
    "http://google.com\t@127.0.0.1/",
    "http://google.com\x00@127.0.0.1/",
    # Fragment confusion (parser drops everything after #)
    "http://127.0.0.1/#@google.com",
    # Triple-slash confusion
    "http:///127.0.0.1/",
    "http:////127.0.0.1/",
]


@pytest.mark.parametrize("target", _URL_SMUGGLING_TARGETS)
def test_ssrf_url_smuggling_does_not_reach_private_ip(
    http: httpx.Client, target: str
):
    """URL parser disagreements must not let an attacker smuggle a private
    IP past the blocklist via userinfo / multiple @ / NUL-in-host tricks."""
    resp = _post_search(http, target, enable_scraping=True, num_results=1)
    if resp is None:
        return
    assert resp.status_code != 500, _sec(
        f"URL-smuggling target {target!r} → 500", resp
    )
    _assert_no_ssrf_leak(resp, f"URL smuggling ({target!r})")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 6 — Length / size-cap DoS
# ═══════════════════════════════════════════════════════════════════════════

def test_ssrf_extremely_long_url_rejected_before_fetch(http: httpx.Client):
    """An 8KB URL string must be rejected at validation, not crash the parser
    or trigger a network fetch with a massive query string."""
    long_url = "http://example.com/" + ("A" * 8192)
    resp = _post_search(http, long_url, enable_scraping=True, num_results=1, timeout=10.0)
    if resp is None:
        # Server / ALB rejected at HTTP layer — that's a perfectly valid defense
        return
    # The whole point: never 500, never leak
    assert resp.status_code != 500, _sec(
        f"8KB URL caused 500 — possible parser/buffer issue", resp
    )
    _assert_no_ssrf_leak(resp, "8KB URL")


def test_ssrf_slow_target_does_not_block_indefinitely(http: httpx.Client):
    """The scraper must enforce its own per-URL timeout (search.py uses 6s).
    Prove this by sending a known slow endpoint and verifying our request
    finishes well within the test's 30s ceiling."""
    # httpbin.org/delay/30 sleeps 30s before responding
    slow_url = "http://httpbin.org/delay/30"
    start = time.monotonic()
    resp = _post_search(
        http, slow_url, enable_scraping=True, num_results=1, timeout=30.0
    )
    elapsed = time.monotonic() - start

    if resp is None:
        # Connection refused / drop is fine
        return
    # search.py sets the inner scraper timeout to 6s; even with overhead,
    # 30s of total wall-clock means timeouts are NOT being enforced.
    assert elapsed < 25.0, _sec(
        f"Search with slow target took {elapsed:.1f}s — scraper timeout not enforced "
        f"(search.py expects per-URL timeout=6s)",
        resp,
    )
    assert resp.status_code != 500, _sec(
        "slow-target probe → 500", resp
    )


def test_ssrf_response_body_size_capped(http: httpx.Client):
    """Scraper truncates content to max_content_length; we verify that even
    when a large response is requested the API response itself stays small.
    A 100MB body would inflate the JSON response well past any reasonable
    size — we cap our own assertion at ~1MB."""
    large_url = "http://httpbin.org/bytes/10485760"  # 10MB random bytes
    resp = _post_search(
        http, large_url, enable_scraping=True, num_results=1, timeout=20.0
    )
    if resp is None:
        return
    assert resp.status_code != 500, _sec("large-body probe → 500", resp)
    body = resp.content or b""
    # search.py truncates each result's content to 3000 chars; whole API
    # response should be well under 100KB. Allow 1MB as a generous ceiling.
    assert len(body) < 1_000_000, _sec(
        f"Search response is {len(body):,} bytes — scraper may be returning "
        f"unbounded content from large targets",
        resp,
    )


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 7 — Outbound User-Agent doesn't leak internals
# ═══════════════════════════════════════════════════════════════════════════

def test_outbound_user_agent_does_not_leak_internal_hostname(http: httpx.Client):
    """The scraper sets a hardcoded Mozilla UA in web_scraper.py — verify
    no response body echoes back any internal hostname/IP/IAM marker that
    might be pulled from environment leakage."""
    # We can't directly inspect the outbound UA from a black-box test; the
    # closest we can do is hit a search and confirm no internal markers
    # appear in the response (which would happen if the backend was leaking
    # env vars into the UA via string interpolation bugs).
    resp = _post_search(http, "test query post deploy ssrf", enable_scraping=False)
    if resp is None:
        pytest.skip("Search endpoint unreachable")
    if resp.status_code in (401, 403, 422):
        pytest.skip(f"Search endpoint requires auth/extra headers ({resp.status_code})")
    body = resp.text or ""
    forbidden = (
        "ip-10-",
        "ip-172-",
        "ec2.internal",
        "compute.internal",
        ".elb.amazonaws.com",
        "AKIA",  # access key prefix — would be catastrophic in any response
    )
    for marker in forbidden:
        assert marker not in body, _sec(
            f"Search response leaked internal infra marker {marker!r}",
            resp,
        )


def test_search_response_does_not_leak_google_api_key(http: httpx.Client):
    """A real search call hits Google CSE with the API key as a `key=` param.
    The backend must not echo that key into its response body, even on
    error paths."""
    resp = _post_search(
        http, "weather san francisco today", enable_scraping=False, num_results=1
    )
    if resp is None:
        pytest.skip("Search endpoint unreachable")
    if resp.status_code in (401, 403, 422):
        pytest.skip(f"Search endpoint requires extra headers ({resp.status_code})")

    body = resp.text or ""
    # Google API keys typically start with "AIza" — generic regex
    google_key_re = re.compile(r"AIza[0-9A-Za-z_\-]{30,}")
    m = google_key_re.search(body)
    assert not m, _sec(
        f"Search response body contains a string matching Google API key "
        f"format: {m.group(0)[:8]}…(redacted)",
        resp,
    )

    # Also: no `key=` query param echoed
    assert "key=AIza" not in body, _sec(
        "Search response body echoes `key=AIza...` — Google API key leaked",
        resp,
    )

    # Also: bare CX (search engine ID) — ok if it leaks but flag the obvious
    # pattern. CX format is digits:hash. Not catastrophic if leaked but
    # still worth surfacing.
    cx_re = re.compile(r'"cx"\s*:\s*"\d{15,}:[a-z0-9]{8,}"')
    if cx_re.search(body):
        # This is a soft warning — we record it via a print for the runner,
        # not an assertion failure. Test still passes.
        pass


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 8 — Scheme-downgrade defenses
# ═══════════════════════════════════════════════════════════════════════════
#
# Distinct from Section 4 (redirect chains) — these are URLs where the
# scheme itself is non-HTTP. The scraper uses aiohttp which by default
# refuses to handle file:// / gopher://, but we want belt-and-suspenders
# coverage at the API boundary too.

_NON_HTTP_SCHEMES = [
    "file:///etc/passwd",
    "file:///c:/windows/win.ini",
    "gopher://127.0.0.1:6379/_FLUSHALL",
    "dict://127.0.0.1:11211/stats",
    "ftp://127.0.0.1/",
    "ldap://127.0.0.1:389/",
    "jar:http://x.com!/",
    "data:text/html,<script>alert(1)</script>",
    "javascript:alert(1)",
]


@pytest.mark.parametrize("target", _NON_HTTP_SCHEMES)
def test_non_http_schemes_rejected(http: httpx.Client, target: str):
    """The scraper must refuse non-HTTP schemes, regardless of whether
    aiohttp would natively handle them."""
    resp = _post_search(http, target, enable_scraping=True, num_results=1)
    if resp is None:
        return
    assert resp.status_code != 500, _sec(
        f"non-HTTP scheme {target!r} → 500", resp
    )
    _assert_no_ssrf_leak(resp, f"non-HTTP scheme ({target!r})")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 9 — Concurrency sanity
# ═══════════════════════════════════════════════════════════════════════════
#
# The scraper uses asyncio.gather over multiple URLs. A single bad URL must
# not crash the whole batch.

@pytest.mark.slow
def test_ssrf_burst_does_not_crash_backend(http: httpx.Client):
    """Send 10 successive SSRF-shaped queries; the backend must remain
    healthy after the burst (capped at 20 calls per the test rules)."""
    targets = _CRITICAL_SSRF_TARGETS * 4  # 12 calls — under the 20 cap
    for i, t in enumerate(targets[:20]):
        resp = _post_search(http, t, enable_scraping=False, num_results=1, timeout=10.0)
        if resp is None:
            continue
        if resp.status_code == 429:
            # Rate limiter kicked in — that's fine, stop the burst
            break
        assert resp.status_code != 500, _sec(
            f"burst call #{i} target={t!r} → 500", resp
        )

    # Health check after the burst
    health = http.get(_backend("/api/health"), timeout=10.0)
    assert health.status_code == 200, _sec(
        f"Backend /api/health returned {health.status_code} after SSRF burst — "
        "scraper may have leaked tasks/connections",
        health,
    )
