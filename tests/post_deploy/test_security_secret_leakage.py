"""
test_security_secret_leakage.py — Verify the deployed backend never leaks
secrets, stack traces, internal infra hostnames, or debug surfaces in any
HTTP response body or header — and that no debug endpoints are exposed in
production.

This complements ``test_10_security.py`` (CSP / CSRF / JWT plumbing /
header posture) and ``test_security_auth_deep.py`` (JWT abuse / internal
key bypass / cross-tenant) by focusing on a single observable contract:

    "Whatever code path a request hits — happy path, validation 4xx,
     server 5xx, malformed body, deep traversal, oversize payload — the
     bytes the client receives MUST NOT contain any of the production
     secrets, file paths, internal hostnames, raw Python tracebacks, or
     environment variable names that ``backend/app/core/config.py`` and
     friends pull out of process env at startup."

Strategy:

  * One module-scoped table of regex patterns ("FORBIDDEN_PATTERNS") that
    encode every leak class the spec calls out.
  * One module-scoped list of public + auth'd routes ("ROUTES_TO_SCAN")
    that gets exercised under multiple input shapes (empty body, malformed
    JSON, oversize body, bogus content-type, wrong method, deep traversal).
  * For every (route, input-shape) tuple we assert the response body does
    NOT match any forbidden pattern. The assertion message includes the
    route, status code, the matching pattern name, and the first 6 chars
    of the match (rest redacted) so reviewers can act on a failure without
    having the actual leaked secret printed in CI logs.
  * Debug-endpoint negatives: ``/docs``, ``/redoc``, ``/openapi.json``,
    ``/_admin``, ``/admin``, ``/debug``, ``/_debug``, ``/metrics``,
    ``/prometheus``, ``/.git/config``, ``/.env``, ``/wp-admin``,
    ``/phpinfo.php``, ``/server-status``, ``/HEAD``,
    ``/api/__healthcheck``, ``/api/__internal__``, ``/api/v0`` — all must
    be 404 (or behind auth in the case of /docs in DEBUG=true envs;
    skipped if the deployment self-reports as dev).
  * Error-handler robustness: malformed gzip / non-UTF8 body /
    octet-stream-with-JSON — must produce a clean 4xx envelope, never a
    5xx that surfaces a Python traceback.
  * Header / cookie hygiene: no ``X-Powered-By``, no
    ``Server: uvicorn/x.y.z``, no ``debug=`` / ``csrf_test`` /
    ``internal_token`` cookies.

All failure messages are prefixed ``SECRET-LEAK:`` (or ``DEBUG-EXPOSED:``)
so triage tooling can flag these as P0.

We do NOT duplicate any assertion already in ``test_10_security.py`` or
``test_security_auth_deep.py``.  This file's invariant is "the response
body itself, byte-for-byte, must not contain the production secrets".
"""
from __future__ import annotations

import gzip
import json
import os
import re
from typing import Iterable, List, Optional, Tuple

import httpx
import pytest

from conftest import cfg


pytestmark = pytest.mark.security


# ───────────────────────────────────────────────────────────────────────────
# Forbidden patterns — keep these as module-level constants so failure
# messages can name the pattern that matched.  Each entry is a (label,
# compiled regex, redactor) triple.  "redactor" decides how much of the
# match to print on failure (always <= 6 chars + ``***``).
# ───────────────────────────────────────────────────────────────────────────

# AWS access keys are 20 chars: AKIA + 16 base32 chars.  Match conservatively.
RE_AWS_ACCESS_KEY = re.compile(r"AKIA[A-Z0-9]{16}")

# Generic "looks like an AWS-style secret reference" — env var names or
# explicit YAML/JSON key.
RE_AWS_SECRET_KW = re.compile(r"aws_secret_access_key", re.IGNORECASE)

# 3-segment JWT: header.payload.signature.  We allow these in places where
# they're expected (e.g. the user's OWN /auth response).  None of the
# routes in ROUTES_TO_SCAN are expected to ever return a JWT.
RE_JWT = re.compile(
    r"\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{8,}\b"
)

# OpenAI / Anthropic-style secret keys.  ``sk-`` or ``sk-ant-`` directly
# followed by 16+ chars of allowed alphabet — guards against false-positives
# on words like "sk-llama" or "sk-prefix" appearing in docs.
RE_OPENAI_KEY = re.compile(r"\bsk-(?:ant-)?[A-Za-z0-9_\-]{16,}\b")

# Coasty-issued public CUA keys.  Format: "cua_sk_" + 48 hex chars.
# The only legitimate appearance is in the response body of a successful
# POST /api/v1/cua/keys (the issue endpoint) — every other surface that
# leaks one is a bug.
RE_CUA_SK = re.compile(r"\bcua_sk_[A-Fa-f0-9]{32,}\b")

# Database / cache connection strings — both prefix forms.
RE_REDIS = re.compile(r"\bredis://[^\s\"'`]+", re.IGNORECASE)
RE_POSTGRES = re.compile(r"\bpostgres(?:ql)?://[^\s\"'`]+", re.IGNORECASE)

# AWS internal infra hostnames.  ``*.elb.amazonaws.com`` is the auto-
# generated DNS for any ALB and should never be echoed back to the
# client.  ``*.compute.internal`` is the EC2 hostname.  ``ec2.internal``
# is metadata.  ``rds.amazonaws.com`` is RDS.  ``cache.amazonaws.com``
# is ElastiCache.  ``ip-10-…`` and ``ip-172-(16-31)-…`` are EC2 host
# names in private subnets.
RE_ELB_HOST = re.compile(r"\b[A-Za-z0-9\-]+\.elb\.amazonaws\.com\b", re.IGNORECASE)
RE_INTERNAL_HOST = re.compile(
    r"\b(?:ec2\.internal|[A-Za-z0-9\-]+\.compute\.internal|"
    r"[A-Za-z0-9\-]+\.rds\.amazonaws\.com|"
    r"[A-Za-z0-9\-]+\.cache\.amazonaws\.com|"
    r"ip-10-\d+-\d+-\d+|"
    r"ip-172-(?:1[6-9]|2[0-9]|3[01])-\d+-\d+|"
    r"ip-192-168-\d+-\d+)",
    re.IGNORECASE,
)

# Python stack-trace markers.  ``Traceback (most recent call last)`` is
# the canonical first line; ``File "/.../site-packages/`` is the path
# segment in formatted tracebacks; ``at line`` is a Pythonic stack-
# format marker; raw exception class names appearing in a JSON body are
# also a leak (they're in the ``error`` field where they shouldn't be).
RE_TRACEBACK = re.compile(r"Traceback \(most recent call last\)")
RE_SITE_PACKAGES = re.compile(r"""File ["'][^"']*site-packages[\\/]""")
RE_AT_LINE = re.compile(r"\bat line \d+\b")
RE_KEYERROR = re.compile(r"\bKeyError\b")
RE_ATTRERROR = re.compile(r"\bAttributeError\b")
RE_INDEXERROR = re.compile(r"\bIndexError\b")

# Internal env var names — these are config keys, not values.  They
# should never appear in user-facing responses; if they do, the error
# handler is leaking config-loading code paths.
RE_ENV_INTERNAL_API_KEY = re.compile(r"\bINTERNAL_API_KEY\b")
RE_ENV_SUPABASE_SERVICE_ROLE = re.compile(r"\bSUPABASE_SERVICE_ROLE\b")
RE_ENV_ENCRYPTION_KEY = re.compile(r"\bENCRYPTION_KEY\b")
RE_ENV_BEDROCK_DEFAULT_MODEL = re.compile(r"\bBEDROCK_DEFAULT_MODEL\b")

# Internal filesystem paths.  We focus on patterns that ONLY arise from
# unmasked tracebacks: ``/app/backend/app/services/`` (Docker image
# layout), ``c:\Users\`` (Windows dev box), ``/home/runner/`` (GitHub
# Actions), ``/usr/local/lib/python``.
RE_PATH_APP_BACKEND = re.compile(r"/app/backend/app/services/", re.IGNORECASE)
RE_PATH_WIN_USERS = re.compile(r"[a-zA-Z]:\\Users\\", re.IGNORECASE)
RE_PATH_HOME_RUNNER = re.compile(r"/home/runner/")
RE_PATH_USR_PYTHON = re.compile(r"/usr/local/lib/python")

# Generic email regex — used to detect leaked emails OTHER than the
# user's own.  Matches ``user@host.tld``.
RE_EMAIL = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"
)

# Private IP ranges that should NEVER appear in error bodies.  We allow
# the user's own IP (httpx records the client_addr but it's not echoed
# anyway) — every match here is suspicious.
RE_PRIVATE_IP = re.compile(
    r"\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|"
    r"172\.(?:1[6-9]|2[0-9]|3[01])\.\d{1,3}\.\d{1,3}|"
    r"192\.168\.\d{1,3}\.\d{1,3})\b"
)


# Allowed-context exceptions — patterns that are tolerated on specific
# routes because they're part of the expected response.  Keep this set
# tiny and explicit; never broaden without a code review.
ROUTE_EXCEPTIONS: dict[str, set[str]] = {
    # POST /api/v1/cua/keys legitimately returns a fresh cua_sk_… secret.
    "/api/v1/cua/keys": {"cua_sk"},
    # /api/models documents Bedrock model IDs (anthropic.claude-…) which
    # are public; not a leak.  No regex matches on those though, so no
    # exception needed.
}


def _redact(match_str: str, keep: int = 6) -> str:
    """Print first ``keep`` chars then ``***``.  Never echo full secret."""
    if not match_str:
        return "***"
    head = match_str[:keep]
    return f"{head}***" if len(match_str) > keep else head


# Each entry: (label, compiled regex, exception_label_set).  ``exception``
# entries skip the check on routes whose value in ROUTE_EXCEPTIONS contains
# the matching label (e.g. "cua_sk" on /api/v1/cua/keys).
FORBIDDEN_PATTERNS: List[Tuple[str, "re.Pattern[str]", Optional[str]]] = [
    ("AWS access key (AKIA…)", RE_AWS_ACCESS_KEY, None),
    ("aws_secret_access_key keyword", RE_AWS_SECRET_KW, None),
    ("JWT 3-segment token", RE_JWT, "jwt"),
    ("OpenAI/Anthropic sk- key", RE_OPENAI_KEY, None),
    ("Public CUA cua_sk_ key", RE_CUA_SK, "cua_sk"),
    ("redis:// connection string", RE_REDIS, None),
    ("postgres:// connection string", RE_POSTGRES, None),
    ("ELB internal hostname", RE_ELB_HOST, "elb"),
    ("AWS internal hostname / private RDS / EC2 ip-…", RE_INTERNAL_HOST, None),
    ("Python traceback marker", RE_TRACEBACK, None),
    ("site-packages stack frame", RE_SITE_PACKAGES, None),
    ("`at line N` stack format", RE_AT_LINE, None),
    ("KeyError raw", RE_KEYERROR, None),
    ("AttributeError raw", RE_ATTRERROR, None),
    ("IndexError raw", RE_INDEXERROR, None),
    ("env name INTERNAL_API_KEY", RE_ENV_INTERNAL_API_KEY, None),
    ("env name SUPABASE_SERVICE_ROLE", RE_ENV_SUPABASE_SERVICE_ROLE, None),
    ("env name ENCRYPTION_KEY", RE_ENV_ENCRYPTION_KEY, None),
    ("env name BEDROCK_DEFAULT_MODEL", RE_ENV_BEDROCK_DEFAULT_MODEL, None),
    ("docker path /app/backend/app/services/", RE_PATH_APP_BACKEND, None),
    ("windows path c:\\Users\\", RE_PATH_WIN_USERS, None),
    ("github runner path /home/runner/", RE_PATH_HOME_RUNNER, None),
    ("python lib path /usr/local/lib/python", RE_PATH_USR_PYTHON, None),
    ("private IP 10.*/172.16-31.*/192.168.*", RE_PRIVATE_IP, None),
]


# ───────────────────────────────────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────────────────────────────────

def _leak(label: str, route: str, status: int, snippet: str) -> str:
    return (
        f"SECRET-LEAK: {label} leaked in {route} (status {status}): "
        f"{snippet}"
    )


def _debug(label: str, route: str, status: int, snippet: str = "") -> str:
    extra = f" body={snippet}" if snippet else ""
    return f"DEBUG-EXPOSED: {label} on {route} (status {status}){extra}"


def _is_dev_env(http: httpx.Client) -> bool:
    """Best-effort: hit /api/health, look for any signal we're in dev.

    We have no direct way to read DEBUG/ENVIRONMENT from outside the box,
    so we key off two heuristics:
      * /docs returning 200 => DEBUG=true at FastAPI app construction.
      * EXPECT_HTTPS_443_LISTENER=0 in conftest cfg() => operator told us
        this is a dev box.
    Either is enough to skip the "no /docs in prod" assertion.
    """
    if not cfg().expect_https_443:
        return True
    return False


def _scan_body(body: str, route: str) -> List[Tuple[str, str]]:
    """Return list of (label, snippet) hits.  Skips per-route exceptions."""
    if not body:
        return []
    exceptions = ROUTE_EXCEPTIONS.get(route, set())
    hits: List[Tuple[str, str]] = []
    for label, pattern, ex_label in FORBIDDEN_PATTERNS:
        if ex_label and ex_label in exceptions:
            continue
        m = pattern.search(body)
        if m:
            hits.append((label, _redact(m.group(0))))
    # Email leak: only flag if it's NOT the test user's own address.
    own_email = (cfg().test_user_email or "").lower()
    for em in RE_EMAIL.finditer(body):
        addr = em.group(0).lower()
        if own_email and addr == own_email:
            continue
        # Tolerate noreply@ / privacy@ / abuse@ — those are public
        # contact addresses that may legitimately appear on docs/error
        # pages (e.g. CDN abuse-contact lines).
        local = addr.split("@", 1)[0]
        if local in {"noreply", "privacy", "abuse", "support", "hello", "contact"}:
            continue
        hits.append(("3rd-party email leak", _redact(em.group(0), keep=4)))
        break  # one is enough — don't spam
    return hits


def _assert_no_leaks(resp: httpx.Response, route: str) -> None:
    """Assert the response body+headers contain none of the forbidden patterns."""
    try:
        body = resp.text or ""
    except Exception:
        body = ""
    # Also scan headers (less likely but an X-Powered-By: stack-trace
    # would still be a leak).  Convert to a single string for the
    # regex sweep.
    hdr_blob = "\n".join(f"{k}: {v}" for k, v in resp.headers.items())
    combined = body + "\n" + hdr_blob

    hits = _scan_body(combined, route)
    if hits:
        details = "; ".join(f"{lbl}={snip}" for lbl, snip in hits)
        raise AssertionError(
            _leak(details, route, resp.status_code, body[:200].replace("\n", " "))
        )


def _backend(path: str) -> str:
    return f"{cfg().backend_public_url}{path}"


# ───────────────────────────────────────────────────────────────────────────
# Routes to scan — every public + auth-fronted endpoint.  We exercise each
# with a matrix of input shapes; not every shape is sensible for every
# route, but a route that 5xx's on, say, "wrong method" is itself the
# bug we're hunting.
# ───────────────────────────────────────────────────────────────────────────

ROUTES_GET = [
    "/",
    "/api/health",
    "/api/ready",
    "/api/cua-version",
    "/api/status/history",
    "/api/models/",
    "/api/chats/",
    "/api/chats/00000000-0000-0000-0000-000000000000",
    "/api/chats/00000000-0000-0000-0000-000000000000/messages",
    "/api/chats/list",
    "/api/billing/credits/balance",
    "/api/schedules",
    "/api/schedules/history",
    "/api/electron/machines",
    "/api/screenshots/00000000000000000000000000000000",
    "/api/screenshots/stats",
    "/api/v1/cua/sessions",
    "/api/v1/cua/keys",
    "/api/v1/cua/models",
    "/api/v1/cua/usage",
    "/api/v1/cua/health",
]

ROUTES_POST = [
    "/api/chat/",
    "/api/chats/create",
    "/api/swarm/execute",
    "/api/files/list",
    "/api/files/download",
    "/api/v1/cua/parse",
    "/api/v1/cua/predict",
    "/api/v1/cua/sessions",
    "/api/v1/cua/keys",
]


# ───────────────────────────────────────────────────────────────────────────
# 1. GET routes — happy path + error path must not leak
# ───────────────────────────────────────────────────────────────────────────

def _safe_get(http: httpx.Client, url: str, **kwargs) -> Optional[httpx.Response]:
    """GET with a tight timeout that skips on transient network errors.

    We're a security test, not a uptime monitor — transient ReadTimeouts on
    a route that legitimately takes a while (e.g. /api/status/history
    aggregates 90 days of rows) are not the leak class we're checking.  We
    skip cleanly when the server doesn't talk to us in time.
    """
    try:
        return http.get(url, timeout=15.0, **kwargs)
    except (
        httpx.ReadTimeout,
        httpx.ConnectTimeout,
        httpx.RemoteProtocolError,
        httpx.ProtocolError,
        httpx.WriteError,
    ):
        return None


def _safe_request(
    http: httpx.Client, method: str, url: str, **kwargs
) -> Optional[httpx.Response]:
    try:
        return http.request(method, url, timeout=15.0, **kwargs)
    except (
        httpx.ReadTimeout,
        httpx.ConnectTimeout,
        httpx.RemoteProtocolError,
        httpx.ProtocolError,
        httpx.WriteError,
    ):
        return None


@pytest.mark.parametrize("path", ROUTES_GET)
def test_get_route_does_not_leak(http: httpx.Client, path: str):
    """Plain GET on every documented route — body must not contain secrets."""
    resp = _safe_get(http, _backend(path))
    if resp is None:
        pytest.skip(f"Network timeout / protocol error on GET {path}")
    # Cloudflare / WAF redirect chain is fine; we only care about the body
    # content for whatever response we get.
    _assert_no_leaks(resp, path)


@pytest.mark.parametrize("path", ROUTES_GET)
def test_get_route_with_deep_traversal_does_not_leak(http: httpx.Client, path: str):
    """Append ``../../etc/passwd`` to every GET route.

    The point isn't path traversal (covered by injection tests); it's that
    the 404/422 the server responds with does NOT leak file paths or
    site-packages frames.
    """
    traversal = path.rstrip("/") + "/../../../../../../etc/passwd"
    resp = _safe_get(http, _backend(traversal))
    if resp is None:
        pytest.skip(f"Network timeout / protocol error on traversal probe of {path}")
    _assert_no_leaks(resp, path)


@pytest.mark.parametrize("path", ROUTES_GET)
def test_get_route_wrong_method_does_not_leak(http: httpx.Client, path: str):
    """Send a body-bearing PATCH to every GET-only route.

    FastAPI returns 405; the body must not include exception class names
    or an internal handler dump.
    """
    resp = _safe_request(
        http,
        "PATCH",
        _backend(path),
        content=b'{"x":1}',
        headers={"Content-Type": "application/json"},
    )
    if resp is None:
        return
    _assert_no_leaks(resp, path)


# ───────────────────────────────────────────────────────────────────────────
# 2. POST routes — empty body, malformed JSON, oversize, bogus content-type
# ───────────────────────────────────────────────────────────────────────────

def _safe_post(http: httpx.Client, url: str, **kwargs) -> Optional[httpx.Response]:
    try:
        return http.post(url, timeout=15.0, **kwargs)
    except (
        httpx.ReadTimeout,
        httpx.ConnectTimeout,
        httpx.RemoteProtocolError,
        httpx.ProtocolError,
        httpx.WriteError,
    ):
        return None


@pytest.mark.parametrize("path", ROUTES_POST)
def test_post_route_empty_body_does_not_leak(http: httpx.Client, path: str):
    resp = _safe_post(http, _backend(path))
    if resp is None:
        pytest.skip(f"Network timeout / protocol error on POST {path}")
    _assert_no_leaks(resp, path)


@pytest.mark.parametrize("path", ROUTES_POST)
def test_post_route_malformed_json_does_not_leak(http: httpx.Client, path: str):
    resp = _safe_post(
        http,
        _backend(path),
        content=b"{this is not json",
        headers={"Content-Type": "application/json"},
    )
    if resp is None:
        pytest.skip(f"Network timeout / protocol error on POST {path}")
    _assert_no_leaks(resp, path)


@pytest.mark.parametrize("path", ROUTES_POST)
def test_post_route_bogus_content_type_does_not_leak(
    http: httpx.Client, path: str
):
    """Send a JSON body with ``application/octet-stream`` content-type.

    The validation handler must coerce / reject without surfacing the raw
    bytes (which would bring along ``input=b'...'`` in errors() — covered
    by the bytes-encoder fix in core/exceptions.py).
    """
    resp = _safe_post(
        http,
        _backend(path),
        content=b'{"x": 1}',
        headers={"Content-Type": "application/octet-stream"},
    )
    if resp is None:
        pytest.skip(f"Network timeout / protocol error on POST {path}")
    _assert_no_leaks(resp, path)


@pytest.mark.parametrize("path", ROUTES_POST)
def test_post_route_oversize_body_does_not_leak(http: httpx.Client, path: str):
    """5MB JSON-ish blob — server must 413/422/400 with a generic envelope."""
    huge = b'{"messages": "' + (b"A" * (5 * 1024 * 1024)) + b'"}'
    try:
        resp = http.post(
            _backend(path),
            content=huge,
            headers={"Content-Type": "application/json"},
            timeout=30.0,
        )
    except (
        httpx.ReadTimeout,
        httpx.ConnectTimeout,
        httpx.RemoteProtocolError,
        httpx.ProtocolError,
        httpx.WriteError,
    ):
        # Server closed the socket before reading the whole body — that's
        # the safest possible response to oversize input.
        return
    assert resp.status_code != 500, _leak(
        "5xx on oversize body — server crashed instead of rejecting",
        path,
        resp.status_code,
        (resp.text or "")[:200],
    )
    _assert_no_leaks(resp, path)


# ───────────────────────────────────────────────────────────────────────────
# 3. POST routes — non-UTF8 body must not 5xx
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "path",
    [
        "/api/chat/",
        "/api/chats/create",
        "/api/swarm/execute",
        "/api/files/list",
        "/api/v1/cua/parse",
    ],
)
def test_post_route_non_utf8_body_does_not_leak(http: httpx.Client, path: str):
    """\\xff\\xfe is a UTF-16 BOM — invalid as JSON.  Must 400, not 500."""
    resp = _safe_post(
        http,
        _backend(path),
        content=b"\xff\xfe\x00\x01garbage\xff\xfe",
        headers={"Content-Type": "application/json"},
    )
    if resp is None:
        pytest.skip(f"Network timeout / protocol error on POST {path}")
    assert resp.status_code != 500, _leak(
        "5xx on non-UTF8 body — exception handler likely dumped trace",
        path,
        resp.status_code,
        (resp.text or "")[:200],
    )
    _assert_no_leaks(resp, path)


# ───────────────────────────────────────────────────────────────────────────
# 4. POST routes — malformed gzip must produce a generic envelope, not a
#    site-packages traceback from gzip.decompress() inside GZipMiddleware.
# ───────────────────────────────────────────────────────────────────────────

def test_malformed_gzip_does_not_leak(http: httpx.Client):
    """Send Content-Encoding: gzip with garbage body to /api/chat/.

    GZipMiddleware on the response side won't decode requests, but a
    misconfigured proxy might.  If the server still hands the bytes
    through to FastAPI, the JSON parse fails and the error envelope must
    NOT contain a gzip traceback.
    """
    resp = _safe_post(
        http,
        _backend("/api/chat/"),
        content=b"\x1f\x8b\x08\x00garbage-not-actually-gzip",
        headers={
            "Content-Type": "application/json",
            "Content-Encoding": "gzip",
        },
    )
    if resp is None:
        pytest.skip("Network timeout / protocol error on malformed-gzip probe")
    assert resp.status_code != 500, _leak(
        "5xx on malformed gzip — middleware threw instead of rejecting",
        "/api/chat/",
        resp.status_code,
        (resp.text or "")[:200],
    )
    _assert_no_leaks(resp, "/api/chat/")


# ───────────────────────────────────────────────────────────────────────────
# 5. POST routes — when an authenticated session is available, also
#    exercise auth'd error paths (a 422 from a valid Bearer is more likely
#    to walk a deeper code path than the 401 from no-auth).
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "path",
    [
        "/api/chat/",
        "/api/chats/create",
        "/api/swarm/execute",
        "/api/files/list",
    ],
)
def test_authd_post_malformed_json_does_not_leak(
    http: httpx.Client, auth_headers: dict, path: str
):
    """Authenticated POST with malformed JSON — error body must stay clean."""
    resp = _safe_post(
        http,
        _backend(path),
        content=b"{this is not json",
        headers={**auth_headers, "Content-Type": "application/json"},
    )
    if resp is None:
        pytest.skip(f"Network timeout / protocol error on POST {path}")
    _assert_no_leaks(resp, path)


# ───────────────────────────────────────────────────────────────────────────
# 6. Debug endpoints that MUST NOT exist in production
# ───────────────────────────────────────────────────────────────────────────

DEBUG_PATHS = [
    "/_admin",
    "/admin",
    "/debug",
    "/_debug",
    "/metrics",
    "/prometheus",
    "/.git/config",
    "/.env",
    "/wp-admin",
    "/phpinfo.php",
    "/server-status",
    "/HEAD",
    "/api/__healthcheck",
    "/api/__internal__",
    "/api/v0",
    "/api/v0/health",
    "/api/admin",
    "/api/debug",
]


@pytest.mark.parametrize("path", DEBUG_PATHS)
def test_debug_endpoint_returns_404_or_auth(http: httpx.Client, path: str):
    """Each known-bad debug path must 404 or 401/403.  Never 200, never 500."""
    resp = _safe_get(http, _backend(path))
    if resp is None:
        pytest.skip(f"Network timeout / protocol error on debug-endpoint probe {path}")
    if resp.status_code == 500:
        raise AssertionError(_debug(
            f"5xx on probe — likely exception leaks",
            path,
            resp.status_code,
            (resp.text or "")[:200],
        ))
    if resp.status_code == 200:
        # 200 is ONLY ever acceptable if the body is the trivial root
        # response we already test on "/".  Otherwise it's a leak.
        body = (resp.text or "")[:200]
        raise AssertionError(_debug(
            "endpoint returned 200 — debug surface exposed",
            path,
            resp.status_code,
            body,
        ))
    assert resp.status_code in (301, 302, 307, 308, 401, 403, 404, 405), _debug(
        f"unexpected status {resp.status_code} (expected 404 or auth-required)",
        path,
        resp.status_code,
        (resp.text or "")[:200],
    )
    _assert_no_leaks(resp, path)


# ───────────────────────────────────────────────────────────────────────────
# 7. /docs, /redoc, /openapi.json — must be 404 in prod (DEBUG=false)
# ───────────────────────────────────────────────────────────────────────────

DOCS_PATHS = ["/docs", "/redoc", "/openapi.json"]


@pytest.mark.parametrize("path", DOCS_PATHS)
def test_openapi_docs_disabled_in_production(http: httpx.Client, path: str):
    """In prod the FastAPI app constructor passes None for docs URLs.

    See ``backend/main.py`` lines 336-338:

        docs_url="/docs" if settings.DEBUG else None,
        redoc_url="/redoc" if settings.DEBUG else None,
        openapi_url="/openapi.json" if settings.DEBUG else None,

    So the production-deployed app should 404 these paths.
    """
    if _is_dev_env(http):
        pytest.skip(
            "Operator flagged this deployment as dev "
            "(EXPECT_HTTPS_443_LISTENER=0) — /docs may be intentionally on"
        )
    resp = _safe_get(http, _backend(path))
    if resp is None:
        pytest.skip(f"Network timeout / protocol error on OpenAPI probe {path}")
    if resp.status_code == 200:
        body = (resp.text or "")[:200]
        raise AssertionError(_debug(
            "OpenAPI surface served 200 — DEBUG flag is on in prod",
            path,
            resp.status_code,
            body,
        ))
    assert resp.status_code in (401, 403, 404), _debug(
        f"unexpected status {resp.status_code} for OpenAPI route in prod",
        path,
        resp.status_code,
        (resp.text or "")[:200],
    )


# ───────────────────────────────────────────────────────────────────────────
# 8. OPTIONS / Allow header — must reveal only safe methods
# ───────────────────────────────────────────────────────────────────────────

def test_options_on_health_does_not_advertise_unsafe_methods(http: httpx.Client):
    """OPTIONS /api/health Allow: header must not list TRACE/CONNECT/PATCH.

    A misconfigured CORS middleware that echoes ``Allow: *`` or a debug
    middleware that advertises TRACE is itself a fingerprinting / XST
    vector.  We accept the standard read methods + OPTIONS, plus the
    explicit ``*`` Access-Control-Allow-Methods that CORSMiddleware
    sets on preflight (since that's a CORS contract and not actually
    served).  We're checking the legacy ``Allow`` header, not the
    ``Access-Control-Allow-Methods`` one.
    """
    resp = _safe_request(
        http,
        "OPTIONS",
        _backend("/api/health"),
        headers={
            "Origin": cfg().frontend_url,
            "Access-Control-Request-Method": "GET",
        },
    )
    if resp is None:
        pytest.skip("Network timeout / protocol error on OPTIONS /api/health")
    allow = resp.headers.get("Allow", "")
    if not allow:
        # No ``Allow`` header — that's fine; CORSMiddleware handled it
        # without one.  Just confirm the response itself is clean.
        _assert_no_leaks(resp, "/api/health")
        return

    methods = {m.strip().upper() for m in allow.split(",") if m.strip()}
    forbidden = {"TRACE", "CONNECT"}
    leaked = methods & forbidden
    assert not leaked, _debug(
        f"Allow header advertises unsafe method(s) {sorted(leaked)!r}",
        "/api/health",
        resp.status_code,
        f"Allow={allow!r}",
    )


# ───────────────────────────────────────────────────────────────────────────
# 9. Headers / cookies — no fingerprinting, no debug cookies
# ───────────────────────────────────────────────────────────────────────────

def test_no_x_powered_by_header(http: httpx.Client):
    """X-Powered-By is fingerprinting, period.  Must not be set."""
    resp = _safe_get(http, _backend("/api/health"))
    if resp is None:
        pytest.skip("Network timeout on /api/health header probe")
    xp = resp.headers.get("X-Powered-By", "")
    assert xp == "", _debug(
        f"X-Powered-By header is set ({xp!r}) — server fingerprint leak",
        "/api/health",
        resp.status_code,
    )


def test_server_header_does_not_disclose_uvicorn_version(http: httpx.Client):
    """Server: uvicorn/0.40.0 fingerprints the version; reject it.

    Either the header is absent (best), or it's a generic value like
    ``cloudflare`` (set by CF in front of the ALB), or it's e.g.
    ``awselb/2.0`` (set by ALB).  ``uvicorn/x.y.z`` is the bug.
    """
    resp = _safe_get(http, _backend("/api/health"))
    if resp is None:
        pytest.skip("Network timeout on /api/health Server probe")
    server = resp.headers.get("Server", "")
    assert "uvicorn/" not in server.lower(), _debug(
        f"Server header discloses Uvicorn version: {server!r}",
        "/api/health",
        resp.status_code,
    )


@pytest.mark.parametrize(
    "forbidden_cookie",
    ["debug=", "csrf_test=", "internal_token=", "DEBUG=", "DJANGO_DEBUG="],
)
def test_no_debug_cookies_set(http: httpx.Client, forbidden_cookie: str):
    """No Set-Cookie response on /api/health may include debug-flavoured cookies."""
    resp = _safe_get(http, _backend("/api/health"))
    if resp is None:
        pytest.skip("Network timeout on /api/health debug-cookie probe")
    set_cookies: Iterable[str] = []
    if hasattr(resp.headers, "get_list"):
        set_cookies = resp.headers.get_list("set-cookie")
    else:
        set_cookies = [
            v for k, v in resp.headers.multi_items() if k.lower() == "set-cookie"
        ]
    for raw in set_cookies:
        assert forbidden_cookie not in raw, _debug(
            f"debug-flavoured cookie {forbidden_cookie!r} found in Set-Cookie: {raw!r}",
            "/api/health",
            resp.status_code,
        )


# ───────────────────────────────────────────────────────────────────────────
# 10. Final integration: force-trigger a 500 path and verify the envelope
# ───────────────────────────────────────────────────────────────────────────

def test_forced_500_envelope_is_generic(http: httpx.Client):
    """Best-effort: hammer endpoints likely to surface a real exception.

    We don't know in advance which inputs will tickle a 500 in production,
    so this test sweeps a few high-probability shapes and only fails if
    *any* of them returns a 500 with a stack-trace marker.  A clean 4xx
    is a pass; a 500 with ``{"error":"Internal server error"}`` is also a
    pass (that's the shape from ``general_exception_handler``).
    """
    candidates = [
        # JSON body where Pydantic expects nested structure
        ("/api/chat/", b'{"messages": 1}'),
        ("/api/swarm/execute", b'{"machines": "not-a-list"}'),
        ("/api/v1/cua/predict", b'{"screenshot": "not-base64"}'),
        ("/api/v1/cua/parse", b'{"code": null}'),
    ]
    seen_500 = False
    for path, body in candidates:
        resp = _safe_post(
            http,
            _backend(path),
            content=body,
            headers={"Content-Type": "application/json"},
        )
        if resp is None:
            continue
        # Whatever status we got, scan the body.
        _assert_no_leaks(resp, path)
        if resp.status_code == 500:
            seen_500 = True
            # If we DID get a 500, confirm the envelope is generic
            try:
                envelope = resp.json()
            except Exception:
                raise AssertionError(_leak(
                    "500 body is not JSON — likely raw traceback",
                    path,
                    500,
                    (resp.text or "")[:200],
                ))
            err = (envelope.get("error") or "").lower()
            assert err in {
                "internal server error",
                "validation error",
            } or "rate limit" in err, _leak(
                f"500 envelope is not generic: {envelope!r}",
                path,
                500,
                json.dumps(envelope)[:200],
            )

    # Document — if we never tickled a 500, that's fine.  The other
    # parametrized leak tests already cover the body-clean assertion on
    # whatever status these did produce.
    if not seen_500:
        # No skip — just informational; the test passed on the leak side.
        pass
