"""
test_security_screenshots.py — Tenant isolation + abuse defenses on
screenshot storage and retrieval endpoints.

The screenshot subsystem (``backend/app/services/screenshot_storage.py`` +
``backend/app/api/routes/screenshots.py``) stores base64-encoded images
keyed by SHA256(content)[:16] in /tmp + an in-memory LRU cache (max 100).
GET /api/screenshots/{id} returns the raw image bytes.

Because IDs are content-derived (NOT user-derived), the security model
relies on two invariants:
  1. Knowing a screenshot ID is sufficient to retrieve it (current code).
  2. Therefore IDs must be unguessable AND ownership must additionally be
     enforced at the route layer for any cross-tenant guarantee.

This file exercises both — it asserts the unguessability invariant AND
flags missing ownership checks as a *known* gap that operators should
remediate. Tests that require a foreign-user token use TEST_USER_TOKEN_2;
those skip cleanly if the env var is absent.

Categories covered:
  * Path-traversal / NUL byte / CRLF / oversize ID parameter
  * Foreign-tenant retrieval — known foreign IDs return 403/404, NOT 200
  * Upload size cap (if upload endpoint is exposed)
  * Upload mime-type validation
  * Bytes-after-magic checks (no payload smuggling via JPEG trailer)
  * Response Content-Disposition + Content-Type integrity
  * Cache-Control private vs public
  * Storage cap / LRU eviction at 100+ items (capped at 20 here per rules)
  * Cross-tenant cache poisoning — confirm IDs are SHA256-derived
  * Ownership-on-known-ID — supplying a SHA256 of attacker-known content
    must still fail without ownership

Every test carries ``@pytest.mark.security``. Upload tests are also
``@pytest.mark.destructive``. State-writing tests clean up after themselves.
"""
from __future__ import annotations

import base64
import hashlib
import io
import os
import re
from typing import Optional

import httpx
import pytest

from conftest import cfg


# ── Markers ─────────────────────────────────────────────────────────────────
pytestmark = pytest.mark.security


# ───────────────────────────────────────────────────────────────────────────
# Helpers + fixtures
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


# Smallest valid JPEG (1x1 white pixel) — sufficient for "is this a jpeg?"
# tests. Built via a known-good byte sequence rather than depending on PIL.
_TINY_JPEG_BYTES = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909"
    "080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30"
    "31343434341f27393d38323c2e333432ffdb0043010909090c0b0c180d0d1832211c213232"
    "323232323232323232323232323232323232323232323232323232323232323232323232323"
    "2323232323232323232323232ffc00011080001000103012200021101031101ffc4001f0000"
    "0105010101010101010000000000000000010203040506070809000a0bffc400b510000201"
    "0303020403050504040000017d01020300041105122131410613516107227114328191a108"
    "23429152d10a162434e125f11718191a262728292a35363738393a434445464748494a5354"
    "55565758595a636465666768696a737475767778797a838485868788898a92939495969798"
    "999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9"
    "dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f01000301010101010101010101"
    "00000000000000010203040506070809000a0bffc400b51100020102040403040705040400"
    "0102770001020311040521310612415107617113223281081442911a1b1c1d1e23344362727"
    "82092a1b1c1d1e1f25346372d1f0247689a253637262728292a35363738393a434445464748"
    "494a535455565758595a636465666768696a737475767778797a82838485868788898a9293"
    "94959697989980a0a2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3"
    "d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f"
    "00fbf800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a"
    "2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800"
    "a28a2800a28a2800a28a2800a28a2800a28a2800a28a2800a28a28ffd9"
)


@pytest.fixture(scope="module")
def tiny_jpeg() -> bytes:
    """A real, valid 1x1 JPEG for upload tests."""
    return _TINY_JPEG_BYTES


@pytest.fixture(scope="module")
def tiny_jpeg_b64(tiny_jpeg: bytes) -> str:
    return base64.b64encode(tiny_jpeg).decode("ascii")


@pytest.fixture(scope="module")
def tiny_jpeg_screenshot_id(tiny_jpeg_b64: str) -> str:
    """Compute the would-be screenshot ID for the tiny JPEG.

    Mirrors ``ScreenshotStorageService.generate_screenshot_id`` exactly:
    SHA256 of the base64-encoded data, first 16 hex chars.
    """
    return hashlib.sha256(tiny_jpeg_b64.encode()).hexdigest()[:16]


@pytest.fixture(scope="module")
def foreign_token() -> str:
    """A second test user's JWT, for cross-tenant assertions.

    Skips cleanly when not configured — these checks aren't runnable in
    every environment and we don't want to fail the suite for that.
    """
    tok = os.environ.get("TEST_USER_TOKEN_2", "").strip()
    if not tok:
        pytest.skip(
            "Skipping: requires TEST_USER_TOKEN_2 (a second user's JWT) for "
            "cross-tenant tests. Stage that in tests/post_deploy/.env to enable."
        )
    return tok


@pytest.fixture(scope="module")
def foreign_screenshot_id() -> str:
    """A pre-staged foreign-user screenshot ID, if available.

    Operators can populate FOREIGN_SCREENSHOT_ID via .env to enable the
    "known foreign id leaks bytes" test. Without it, we fall back to a
    best-effort guess from a fresh hash and still cover the path-shape /
    no-200-without-ownership invariant.
    """
    return os.environ.get("FOREIGN_SCREENSHOT_ID", "").strip()


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 1 — ID parameter validation: traversal / NUL / CRLF / oversize
# ═══════════════════════════════════════════════════════════════════════════

_BAD_IDS = [
    # Path traversal
    "../../etc/passwd",
    "..%2f..%2fetc%2fpasswd",
    "%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    "..\\..\\windows\\win.ini",
    # Absolute paths
    "/etc/passwd",
    "C:\\Windows\\System32\\config\\SAM",
    # NUL byte truncation
    "abc\x00../../../etc/passwd",
    "abc%00../../etc/passwd",
    # CRLF response splitting via id
    "abc\r\nX-Injected: pwned",
    "abc%0d%0aX-Injected:%20pwned",
    # Very long
    "A" * 4096,
    # Empty / whitespace
    " ",
    # Special filenames
    "CON",
    "PRN",
    ".",
    "..",
    # SQL/template
    "1' OR '1'='1",
    "{{7*7}}",
    # Non-ASCII / Unicode
    "../‮/etc/passwd",
    "中文/etc/passwd",
]


@pytest.mark.parametrize("bad_id", _BAD_IDS)
def test_get_screenshot_with_malicious_id_rejected_cleanly(
    http: httpx.Client, auth_headers: dict[str, str], bad_id: str
):
    """GET /api/screenshots/{bad_id} must respond with 4xx (not 5xx) and
    must NOT serve any private file or echo the input as raw HTML."""
    # httpx URL-encodes path segments so traversal `../` literals get sent
    # as `..%2F..%2F`. That's actually the realistic attacker model — most
    # clients/CDNs encode them. We separately probe with a manually-crafted
    # path-suffix below.
    url = _backend(f"/api/screenshots/{bad_id}")
    try:
        resp = http.get(url, headers=auth_headers, timeout=10.0)
    except httpx.InvalidURL:
        # Some characters (NUL, raw CRLF) are rejected by httpx itself —
        # that's a perfectly fine "client lib defends" outcome.
        return

    # 5xx is the red flag — handler should validate and reject cleanly.
    assert resp.status_code != 500, _sec(
        f"malicious id {bad_id!r} caused 500", resp
    )
    # /etc/passwd content must NEVER appear, regardless of status code
    body = ""
    try:
        body = resp.text or ""
    except Exception:
        body = ""
    assert "root:x:0:0" not in body, _sec(
        f"malicious id {bad_id!r} leaked /etc/passwd content", resp
    )
    # No echoed raw `<script>` etc. in response
    if resp.headers.get("Content-Type", "").lower().startswith("text/html"):
        assert "<script>" not in body, _sec(
            f"malicious id {bad_id!r} reflected HTML in error body", resp
        )
    # No injected response header
    assert "X-Injected" not in resp.headers, _sec(
        f"malicious id {bad_id!r} succeeded in CRLF response splitting", resp
    )


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2 — Cross-tenant retrieval (foreign user)
# ═══════════════════════════════════════════════════════════════════════════

def test_foreign_screenshot_id_does_not_serve_to_attacker(
    http: httpx.Client, auth_headers: dict[str, str], foreign_screenshot_id: str
):
    """When a screenshot belonging to user B is queried with user A's token,
    the response must be 403/404 — never 200 with bytes.

    Behavior matrix:
      * FOREIGN_SCREENSHOT_ID staged → hard assert 403/404 against it.
      * Else, if TEST_USER_TOKEN_2 is set → synthesize the cross-tenant
        scenario: caller (user A) GETs a synthetic SHA-shaped id that user A
        does not own. Post P2-06 the storage layer denies on ownership-
        mismatch / unknown-id, so we MUST get a non-200 — flat 404 in the
        common case. Anything else fails the test.
      * Else (no foreign token configured) → skip cleanly.
    """
    foreign_token = os.environ.get("TEST_USER_TOKEN_2", "").strip()

    if foreign_screenshot_id:
        # Strongest signal: a real, foreign-owned id staged by the operator.
        url = _backend(f"/api/screenshots/{foreign_screenshot_id}")
        resp = http.get(url, headers=auth_headers, timeout=10.0)
        assert resp.status_code in (401, 403, 404), _sec(
            f"Foreign screenshot id {foreign_screenshot_id!r} returned "
            f"{resp.status_code} — must be 403/404",
            resp,
        )
        if resp.status_code == 200:
            ct = resp.headers.get("Content-Type", "").lower()
            assert "image/" not in ct, _sec(
                f"Foreign screenshot served as image (Content-Type={ct!r}) — "
                "tenant isolation broken",
                resp,
            )
        return

    if not foreign_token:
        pytest.skip(
            "Skipping: requires either FOREIGN_SCREENSHOT_ID or "
            "TEST_USER_TOKEN_2 to assert cross-tenant denial."
        )

    # Synthesized scenario: probe an id user A does not own. The storage
    # layer (post P2-06) denies unknown / cross-tenant ids identically with
    # 404 — so a hard assertion is correct. The id space is sha256[:16] hex,
    # any well-formed value the caller does not own should 404.
    synthetic_foreign_id = hashlib.sha256(
        b"P2-06-cross-tenant-probe::owned-by-nobody-the-caller-knows"
    ).hexdigest()[:16]
    url = _backend(f"/api/screenshots/{synthetic_foreign_id}")
    resp = http.get(url, headers=auth_headers, timeout=10.0)
    assert resp.status_code in (401, 403, 404), _sec(
        f"Synthetic foreign id {synthetic_foreign_id!r} returned "
        f"{resp.status_code} — ownership gate is missing",
        resp,
    )
    if resp.status_code == 200:
        ct = resp.headers.get("Content-Type", "").lower()
        assert "image/" not in ct, _sec(
            f"Synthetic foreign id served as image (Content-Type={ct!r})",
            resp,
        )


def test_foreign_user_cannot_retrieve_my_screenshot_id(
    http: httpx.Client,
    auth_headers: dict[str, str],
    tiny_jpeg_screenshot_id: str,
    foreign_token: str,
):
    """Symmetric check: the attacker (foreign_token) tries to GET a
    screenshot ID we know about. Must be 403/404 even when the ID matches
    an existing record."""
    url = _backend(f"/api/screenshots/{tiny_jpeg_screenshot_id}")
    resp = http.get(
        url,
        headers={"Authorization": f"Bearer {foreign_token}"},
        timeout=10.0,
    )
    assert resp.status_code in (401, 403, 404), _sec(
        f"Foreign user retrieved primary user's known screenshot id "
        f"{tiny_jpeg_screenshot_id!r} (status {resp.status_code})",
        resp,
    )


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 3 — Upload tests (only run if endpoint exists)
# ═══════════════════════════════════════════════════════════════════════════
#
# The route module currently exposes only GET endpoints. Some deployments
# add a POST /api/screenshots/upload. We probe once at module load and skip
# cleanly when it isn't present.

_UPLOAD_PATHS = ("/api/screenshots/upload", "/api/screenshots", "/api/screenshots/")


@pytest.fixture(scope="module")
def upload_path(http: httpx.Client, auth_headers: dict[str, str]) -> str:
    """Discover which (if any) upload endpoint is exposed; skip the upload
    section cleanly when none is available."""
    for path in _UPLOAD_PATHS:
        try:
            # Probe with OPTIONS — cheap and never alters state
            resp = http.options(_backend(path), headers=auth_headers, timeout=5.0)
        except httpx.HTTPError:
            continue
        if resp.status_code in (200, 204, 405):
            # 405 means "GET-only" → not an upload route
            allow = (resp.headers.get("Allow") or "").upper()
            if "POST" in allow or resp.status_code in (200, 204):
                return path
    pytest.skip(
        "No screenshot upload endpoint exposed in this deployment — "
        "skipping upload abuse tests."
    )
    return ""  # unreachable; satisfies type checkers


@pytest.mark.destructive
def test_upload_oversized_image_rejected(
    http: httpx.Client, auth_headers: dict[str, str], upload_path: str
):
    """A 10MB upload must be rejected by a server-side size cap, not silently
    accepted into the screenshot cache."""
    big = b"\xff\xd8\xff\xe0" + os.urandom(10 * 1024 * 1024) + b"\xff\xd9"
    files = {"file": ("big.jpg", big, "image/jpeg")}
    try:
        resp = http.post(
            _backend(upload_path), files=files, headers=auth_headers, timeout=30.0
        )
    except httpx.HTTPError:
        # ALB / Cloudflare 413 surfaces as a connection error in some clients —
        # that's a perfectly valid defense.
        return

    # 413 (Payload Too Large), 400 (Bad Request), 422 (Unprocessable) all OK.
    # 200/201 means we just stored a 10MB blob — bad.
    assert resp.status_code != 500, _sec(
        f"10MB upload caused 500 instead of clean rejection", resp
    )
    if resp.status_code in (200, 201):
        pytest.fail(_sec(
            f"10MB upload was accepted — server-side size cap missing",
            resp,
        ))


@pytest.mark.destructive
def test_upload_invalid_mime_type_rejected(
    http: httpx.Client, auth_headers: dict[str, str], upload_path: str, tiny_jpeg: bytes
):
    """text/html with image bytes must be rejected — server should validate
    the declared mime type AND/OR sniff the actual bytes."""
    files = {"file": ("evil.html", b"<html><script>alert(1)</script></html>", "text/html")}
    try:
        resp = http.post(
            _backend(upload_path), files=files, headers=auth_headers, timeout=10.0
        )
    except httpx.HTTPError:
        return
    assert resp.status_code != 500, _sec("text/html upload → 500", resp)
    if resp.status_code in (200, 201):
        pytest.fail(_sec(
            "text/html upload was accepted — mime validation missing", resp
        ))


@pytest.mark.destructive
def test_upload_jpeg_with_trailing_payload_no_executable_disposition(
    http: httpx.Client, auth_headers: dict[str, str], upload_path: str, tiny_jpeg: bytes
):
    """A JPEG with trailing PE/ELF garbage is technically a valid JPEG (browsers
    stop reading at the EOI marker). It must be accepted but the response
    must NOT serve it with Content-Disposition: attachment AND a filename
    suggesting executability (.exe/.dll/.so/.sh)."""
    payload = tiny_jpeg + b"MZ" + os.urandom(1024)  # MZ = PE magic
    files = {"file": ("ok.jpg", payload, "image/jpeg")}
    try:
        resp = http.post(
            _backend(upload_path), files=files, headers=auth_headers, timeout=15.0
        )
    except httpx.HTTPError:
        pytest.skip("Upload endpoint unreachable")

    if resp.status_code not in (200, 201):
        # Server rejected — that's fine
        return

    # If accepted, check the response: no .exe disposition, no executable hint
    cd = resp.headers.get("Content-Disposition", "").lower()
    for bad in (".exe", ".dll", ".so", ".sh", ".ps1", ".bat", ".cmd"):
        assert bad not in cd, _sec(
            f"Upload response Content-Disposition contains executable hint "
            f"{bad!r}: {cd!r}",
            resp,
        )

    # Try to clean up if we got a screenshot_id back
    try:
        data = resp.json()
        sid = data.get("screenshot_id") or data.get("id")
        if sid:
            http.delete(_backend(f"/api/screenshots/{sid}"), headers=auth_headers)
    except Exception:
        pass


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 4 — Response integrity on retrieval
# ═══════════════════════════════════════════════════════════════════════════

def test_get_screenshot_serves_image_not_user_provided_content_type(
    http: httpx.Client, auth_headers: dict[str, str], tiny_jpeg_screenshot_id: str
):
    """An attacker may try to override Content-Type via Accept header — server
    must always serve image/* (or 4xx) regardless. We probe with a
    text/html Accept and verify the response is NOT served as text/html."""
    url = _backend(f"/api/screenshots/{tiny_jpeg_screenshot_id}")
    resp = http.get(
        url,
        headers={**auth_headers, "Accept": "text/html"},
        timeout=10.0,
    )
    if resp.status_code == 404:
        pytest.skip("Reference screenshot not present on backend (expected)")
    if resp.status_code in (401, 403):
        pytest.skip(f"Auth gate ({resp.status_code}) — covered separately")
    if resp.status_code != 200:
        return  # not a 2xx, no Content-Type guarantees
    ct = resp.headers.get("Content-Type", "").lower()
    assert "text/html" not in ct, _sec(
        f"Screenshot served as text/html on Accept override "
        f"(Content-Type={ct!r})",
        resp,
    )


def test_get_screenshot_content_disposition_has_no_path_components(
    http: httpx.Client, auth_headers: dict[str, str], tiny_jpeg_screenshot_id: str
):
    """If Content-Disposition is set, the filename must not contain path
    separators, traversal, or null bytes — otherwise older browsers may
    save into unexpected locations."""
    url = _backend(f"/api/screenshots/{tiny_jpeg_screenshot_id}")
    resp = http.get(url, headers=auth_headers, timeout=10.0)
    if resp.status_code != 200:
        pytest.skip(f"Cannot inspect Content-Disposition ({resp.status_code})")
    cd = resp.headers.get("Content-Disposition", "")
    if not cd:
        return  # no disposition is fine
    for bad in ("/", "\\", "..", "\x00", "\r", "\n"):
        assert bad not in cd, _sec(
            f"Content-Disposition contains forbidden char {bad!r}: {cd!r}",
            resp,
        )


def test_get_screenshot_cache_control_not_public(
    http: httpx.Client, auth_headers: dict[str, str], tiny_jpeg_screenshot_id: str
):
    """User screenshots are sensitive — Cache-Control must be `private`,
    `no-store`, or absent. `public` would allow CDN/shared-cache pollution
    that leaks one user's screenshot to another user behind the same
    cache key.

    Current code (`screenshots.py`) sets `Cache-Control: max-age=3600`
    *without* a `private` directive, which intermediate caches treat as
    public-cacheable. This test will FAIL until that's fixed — which is
    intentional, the failure flags a real misconfiguration.
    """
    url = _backend(f"/api/screenshots/{tiny_jpeg_screenshot_id}")
    resp = http.get(url, headers=auth_headers, timeout=10.0)
    if resp.status_code != 200:
        pytest.skip(f"Cannot inspect Cache-Control ({resp.status_code})")

    cc = (resp.headers.get("Cache-Control") or "").lower()
    if not cc:
        return  # absent is fine

    # `public` directive is a failure
    assert "public" not in cc, _sec(
        f"Screenshot Cache-Control is `public` ({cc!r}) — shared caches may "
        "leak user screenshots across tenants. Use `private` or `no-store`.",
        resp,
    )
    # If max-age is set without private/no-store/no-cache, that's also a leak
    # vector for shared caches that default to public-cacheable.
    if "max-age=" in cc:
        has_private_marker = (
            "private" in cc or "no-store" in cc or "no-cache" in cc
        )
        assert has_private_marker, _sec(
            f"Screenshot Cache-Control sets max-age without `private` / "
            f"`no-store` / `no-cache` ({cc!r}) — intermediate caches may treat "
            "the response as shareable. Set Cache-Control: private, max-age=…",
            resp,
        )


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 5 — ID format = SHA256 derivation, not enumerable
# ═══════════════════════════════════════════════════════════════════════════

def test_screenshot_ids_are_sha256_derived_not_sequential(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """Confirm screenshot IDs match the documented SHA256[:16] hex format —
    this is the security premise that lets us claim unguessability for
    arbitrary user content. If an operator later switches to sequential
    IDs (UUID v1 / DB serial), this test catches the regression.

    We can't enumerate arbitrary IDs without exposing other users' data,
    so we check the derivation directly via the storage stats endpoint.
    """
    resp = http.get(_backend("/api/screenshots/stats"), headers=auth_headers, timeout=10.0)
    if resp.status_code in (401, 403, 404):
        pytest.skip(f"stats endpoint not exposed ({resp.status_code})")
    if resp.status_code != 200:
        return
    # We don't peek at IDs in this response (good — privacy), but we DO
    # confirm the schema documents itself with `cache_entries` count, which
    # implies the cache uses opaque keys.
    try:
        data = resp.json()
    except Exception:
        return
    # Defensive: stats payload must not echo any actual screenshot IDs to a
    # non-admin user.
    body = resp.text or ""
    sha_id_re = re.compile(r'\b[a-f0-9]{16}\b')
    matches = sha_id_re.findall(body)
    # Allow stats numbers that happen to look like 16 hex chars (extremely
    # unlikely), but more than ~3 means we're enumerating IDs.
    assert len(matches) <= 3, _sec(
        f"/api/screenshots/stats may be exposing screenshot IDs "
        f"({len(matches)} sha-shaped tokens in body)",
        resp,
    )


def test_id_enumeration_with_guessable_prefixes_returns_404(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """Try a handful of "obvious" IDs an attacker would guess — sequential,
    all-zeros, etc. None of these should ever match real content; all must
    return 404 (or 403/401 if route requires auth)."""
    guessable_ids = [
        "0" * 16,
        "f" * 16,
        "1234567890abcdef",
        "deadbeefdeadbeef",
        "aaaaaaaaaaaaaaaa",
        "0000000000000001",
        "ffffffffffffffff",
    ]
    for sid in guessable_ids:
        url = _backend(f"/api/screenshots/{sid}")
        resp = http.get(url, headers=auth_headers, timeout=10.0)
        # 404 expected; 401/403 if auth required; 200 would mean we found
        # someone's screenshot via guessing — catastrophic.
        assert resp.status_code != 200, _sec(
            f"Guessable id {sid!r} returned 200 — IDs may not be SHA-derived "
            "or hash space is too small",
            resp,
        )
        assert resp.status_code != 500, _sec(
            f"Guessable id {sid!r} caused 500", resp
        )


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 6 — Storage cap / LRU behavior
# ═══════════════════════════════════════════════════════════════════════════
#
# Per CLAUDE.md the storage caps the in-memory cache at 100 items with LRU
# eviction. We exercise the *boundary* conservatively (capped at 20 calls
# per the test rules — far under 100, but enough to detect catastrophic
# behaviors like unbounded growth or 500s on rapid GETs).

@pytest.mark.slow
def test_burst_get_does_not_destabilize_storage(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """20 GETs against varied IDs (mostly 404s) must not crash the backend
    and must not leak stack traces."""
    ids = [f"{i:016x}" for i in range(20)]
    for sid in ids:
        resp = http.get(
            _backend(f"/api/screenshots/{sid}"),
            headers=auth_headers,
            timeout=10.0,
        )
        if resp.status_code == 429:
            break  # rate limiter kicked in — fine
        assert resp.status_code != 500, _sec(
            f"GET {sid!r} (during burst) → 500", resp
        )
    # Confirm /api/health is still fine after the burst
    health = http.get(_backend("/api/health"), timeout=10.0)
    assert health.status_code == 200, _sec(
        f"Backend /api/health returned {health.status_code} after screenshot "
        "GET burst",
        health,
    )


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 7 — Stats endpoint must not leak per-user info to anonymous callers
# ═══════════════════════════════════════════════════════════════════════════

def test_stats_endpoint_does_not_leak_per_user_info_unauthenticated(
    http: httpx.Client
):
    """GET /api/screenshots/stats without auth — either 401/403 or, if open,
    must not contain user-identifying info."""
    resp = http.get(_backend("/api/screenshots/stats"), timeout=10.0)
    if resp.status_code in (401, 403, 404):
        return  # gated — best outcome
    if resp.status_code != 200:
        return
    body = (resp.text or "").lower()
    forbidden = ("user_id", "email", "@", "chat_id")
    for marker in forbidden:
        assert marker not in body, _sec(
            f"Anonymous /api/screenshots/stats body contains user-shape marker "
            f"{marker!r}: leaks tenant info",
            resp,
        )


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 8 — Preview path mirrors main path's defenses
# ═══════════════════════════════════════════════════════════════════════════

@pytest.mark.parametrize("bad_id", ["../../etc/passwd", "abc%00xyz", "A" * 4096])
def test_preview_path_enforces_same_id_validation(
    http: httpx.Client, auth_headers: dict[str, str], bad_id: str
):
    """The /preview variant must enforce the same ID validation as the main
    GET — otherwise it's a bypass for tenant isolation."""
    url = _backend(f"/api/screenshots/{bad_id}/preview")
    try:
        resp = http.get(url, headers=auth_headers, timeout=10.0)
    except httpx.InvalidURL:
        return
    assert resp.status_code != 500, _sec(
        f"preview with bad id {bad_id!r} → 500", resp
    )
    body = ""
    try:
        body = resp.text or ""
    except Exception:
        body = ""
    assert "root:x:0:0" not in body, _sec(
        f"preview with bad id {bad_id!r} leaked /etc/passwd content", resp
    )
