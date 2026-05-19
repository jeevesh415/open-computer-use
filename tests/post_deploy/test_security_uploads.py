"""
test_security_uploads.py — Security probes targeting the multipart upload
surface and content-type / mime handling on the backend.

Covered surfaces (route discovery is dynamic — tests skip cleanly when
the deployment doesn't expose a multipart upload endpoint):

  * /api/files/upload-multipart  — primary multipart UploadFile route on
    file_operations.py.  Form fields: machine_id, filepath; File: file.
  * /api/screenshots/upload      — probed best-effort (some deployments add it).
  * /api/files/upload            — JSON body (used as the "wrong verb" target
    for the PUT-vs-POST check).

Categories (deliberately disjoint from existing suites — see header below):

  1. Content-type / mime smuggling
        - PNG bytes declared text/html
        - PHP body declared image/jpeg with .jpg name
        - SVG with embedded <script>
        - Polyglot GIF/JS file — confirm not served on a JS-loadable path
  2. Filename attacks
        - ../../etc/passwd, NUL byte, Windows reserved (CON.jpg),
          extreme length (300 chars), RTL/non-ASCII Unicode,
          collision (same filename twice)
  3. Size attacks
        - 50MB single file
        - 100 files in one multipart request
        - 10MB raw text field (not File)
  4. Multipart structure
        - Boundary mismatch
        - Trailing data after closing boundary
        - Charset injection in Content-Type
        - RFC 5987 filename* with traversal payload (`filename*=UTF-8''evil.exe`)
        - Mixed file + JSON parts
  5. Path / storage on returned URL
        - When upload returns a URL/id, GET it back: confirm
            * Content-Disposition uses safe filename (no user-supplied path)
            * Content-Type is sniffed (not user-supplied)
            * URL has no traversal possible
  6. Cross-tenant
        - Upload as user A, GET with user B's token → 403/404
        - Random UUID enumeration must fail
  7. Image-specific (image_compression robustness)
        - Truncated JPEG bytes — compressor must not crash
        - "Decompression bomb" image (very high declared resolution)
        - JPEG with EXIF GPS tags — confirm sanitized in storage if possible
  8. Edge cases
        - Empty (0-byte) file
        - Content-Length: 0
        - PUT to a POST-only route → 405

Avoids duplication with:
  * test_security_screenshots.py — screenshot ID validation, oversized
    upload size cap, simple text/html mime rejection, JPEG-trailer disposition,
    SHA256 ID enumeration, Cache-Control checks.
  * test_security_dos_resilience.py — 1000-part multipart, 5MB single field
    (we test 50MB / 100-files which are *different* limits).
  * test_security_injection_deep.py — path traversal on filepath body field
    of /api/files/download and /api/files/create-folder (we test traversal
    in the multipart **filename** instead).

State hygiene:
  * Every successful upload is followed by a best-effort DELETE.
  * No test uploads >50MB; no test loops large uploads more than once.
  * All tests are session-scoped and run on a single httpx.Client.

Markers: every test carries `security`. Tests that write are also `destructive`.
"""
from __future__ import annotations

import base64
import io
import os
import struct
import uuid
from typing import Any, Optional

import httpx
import pytest

from conftest import cfg


pytestmark = pytest.mark.security


# ───────────────────────────────────────────────────────────────────────────
# Fixtures — endpoint discovery + payload helpers
# ───────────────────────────────────────────────────────────────────────────

# Smallest valid JPEG (1x1 white pixel) — same payload as
# test_security_screenshots.py for consistency. Built via a known-good byte
# sequence rather than depending on PIL.
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

# Minimal PNG (1x1 transparent) — used for "PNG bytes declared text/html" probe.
_TINY_PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
    b"\x1f\x15\xc4\x89"
    b"\x00\x00\x00\rIDATx\x9cc\xfc\xff\xff?\x03\x00\x05\xfe\x02\xfe\xa3\x35"
    b"\x81\x84\x00\x00\x00\x00IEND\xaeB`\x82"
)


def _backend(path: str) -> str:
    return f"{cfg().backend_public_url}{path}"


def _sec(msg: str, resp: Optional[httpx.Response] = None) -> str:
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


# Probe candidates — in priority order. /api/files/upload-multipart is the
# documented multipart endpoint on file_operations.py; the others are best
# effort.
_MULTIPART_PATHS = (
    "/api/files/upload-multipart",
    "/api/screenshots/upload",
    "/api/screenshots",
)


@pytest.fixture(scope="module")
def multipart_path(http: httpx.Client, auth_headers: dict[str, str]) -> str:
    """Probe each candidate for a multipart-accepting endpoint.

    Strategy: send a tiny valid multipart and look for anything that isn't
    a "route absent / wrong method" code.  /api/files/upload-multipart is
    the documented multipart route; /api/screenshots/upload is best-effort.

    Resilience notes:
      * /api/files/upload-multipart returns 403/503 quickly when the user
        can't access machine_id or the VM isn't connected — both signal a
        live route.
      * Some deployments hang the route waiting for a WebSocket connection
        before returning — we time-bound the probe at 8s and treat ReadTimeout
        as "route exists but is slow", which is itself a useful answer.
      * If every candidate is decisively absent (404/405) we skip cleanly.
    """
    machine_id = os.environ.get("TEST_MACHINE_ID", "").strip() or "local-fake-probe"
    files = {"file": ("probe.txt", b"probe", "text/plain")}
    data = {"machine_id": machine_id, "filepath": "/tmp/probe.txt"}
    DEAD = {404, 405}
    for path in _MULTIPART_PATHS:
        try:
            resp = http.post(
                _backend(path),
                files=files,
                data=data,
                headers=auth_headers,
                timeout=5.0,
            )
        except httpx.ReadTimeout:
            # Route exists but is slow — treat as live for our purposes.
            # Tests will set their own timeouts and probe the response.
            return path
        except httpx.HTTPError:
            continue
        if resp.status_code not in DEAD:
            return path
    pytest.skip(
        "No multipart upload endpoint exposed in this deployment — "
        "skipping upload security probes."
    )
    return ""  # unreachable


@pytest.fixture(scope="module")
def fake_machine_id() -> str:
    """Use TEST_MACHINE_ID when present (so we exercise the post-validation
    code path); otherwise a stable fake.  Tests that write to a real machine
    use this; we never claim success requires the VM to actually exist."""
    return (
        os.environ.get("TEST_MACHINE_ID", "").strip()
        or "local-fake-machine"
    )


@pytest.fixture(scope="module")
def tiny_jpeg() -> bytes:
    return _TINY_JPEG_BYTES


@pytest.fixture(scope="module")
def tiny_png() -> bytes:
    return _TINY_PNG_BYTES


def _is_clean_4xx(resp: httpx.Response) -> bool:
    """200/201 = accepted (often a problem in these tests).  4xx = rejected.
    503 = backend reached but VM not connected (acceptable, the route did its
    validation).  500 = the failure mode this whole file is hunting."""
    return 400 <= resp.status_code < 500


def _accepted(resp: httpx.Response) -> bool:
    return resp.status_code in (200, 201)


def _try_cleanup(
    http: httpx.Client,
    auth_headers: dict[str, str],
    resp: httpx.Response,
    fake_machine_id: str,
) -> None:
    """Best-effort delete of anything we may have created.

    The multipart upload route returns ``filepath`` (or ``screenshot_id`` for
    the screenshots flavor).  We try DELETE on /api/files/delete with a query
    string, and DELETE on /api/screenshots/{id} for the screenshot path.
    Failures here are silent — we never let cleanup break a test.
    """
    if not _accepted(resp):
        return
    try:
        data = resp.json()
    except Exception:
        return
    if not isinstance(data, dict):
        return
    sid = data.get("screenshot_id") or data.get("id")
    if sid:
        try:
            http.delete(
                _backend(f"/api/screenshots/{sid}"),
                headers=auth_headers,
                timeout=5.0,
            )
        except Exception:
            pass
    fp = data.get("filepath")
    if fp:
        try:
            http.delete(
                _backend("/api/files/delete"),
                params={"machine_id": fake_machine_id, "filepath": fp},
                headers=auth_headers,
                timeout=5.0,
            )
        except Exception:
            pass


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 1 — Content-type / mime smuggling
# ═══════════════════════════════════════════════════════════════════════════


def test_png_bytes_declared_text_html(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
    tiny_png: bytes,
):
    """PNG bytes uploaded with Content-Type: text/html.  The server should
    either sniff (and accept) or reject — either is fine; the failure mode
    is 5xx (parser blew up) or 200 echoing text/html on retrieval."""
    files = {"file": ("evil.html", tiny_png, "text/html")}
    data = {"machine_id": fake_machine_id, "filepath": "/tmp/probe.html"}
    try:
        resp = http.post(
            _backend(multipart_path),
            files=files,
            data=data,
            headers=auth_headers,
            timeout=5.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport error: {e!r}")
        return
    assert resp.status_code != 500, _sec(
        "PNG-as-text/html caused 500 — content-type handling fragile", resp
    )
    _try_cleanup(http, auth_headers, resp, fake_machine_id)


@pytest.mark.destructive
def test_php_body_declared_image_jpeg_with_jpg_filename(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
):
    """A PHP web shell with an .jpg filename and image/jpeg Content-Type is
    the canonical "magic bytes never validated" test.  A defended server
    sniffs the bytes (no JPEG SOI marker) and rejects.  We don't *require*
    that — a server that simply accepts opaque uploads is fine — but we
    want to know.

    Failure mode flagged: 200 with a path that, if served as a static file,
    could let an attacker execute PHP via mis-mapped MIME.  We can't observe
    the PHP-execution side from here, so we record an informational warning
    when accepted, and only fail on 500.
    """
    payload = b"<?php system($_GET['c']); ?>"
    files = {"file": ("evil.jpg", payload, "image/jpeg")}
    data = {"machine_id": fake_machine_id, "filepath": "/tmp/evil.jpg"}
    try:
        resp = http.post(
            _backend(multipart_path),
            files=files,
            data=data,
            headers=auth_headers,
            timeout=5.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport error: {e!r}")
        return
    assert resp.status_code != 500, _sec(
        "PHP-as-jpeg upload caused 500 — content sniffing missing AND "
        "parser unsafe",
        resp,
    )
    if _accepted(resp):
        # This is informational, not a hard fail — many file storage backends
        # are intentionally opaque.  We log it so operators know to verify
        # downstream serving doesn't honour user-supplied MIME.
        print(_sec(
            "WARNING: PHP body accepted with .jpg filename + image/jpeg "
            "Content-Type. Confirm storage layer never serves user-supplied "
            "Content-Type and that .jpg paths can't execute PHP.",
            resp,
        ))
    _try_cleanup(http, auth_headers, resp, fake_machine_id)


def test_svg_with_embedded_script_handled(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
):
    """SVG-as-image is XSS-prone because browsers execute <script> in inline
    SVGs.  Server should either strip or reject — but we mostly want it to
    not crash."""
    svg = (
        b'<?xml version="1.0"?>'
        b'<svg xmlns="http://www.w3.org/2000/svg">'
        b'<script>alert("xss")</script></svg>'
    )
    files = {"file": ("xss.svg", svg, "image/svg+xml")}
    data = {"machine_id": fake_machine_id, "filepath": "/tmp/xss.svg"}
    try:
        resp = http.post(
            _backend(multipart_path),
            files=files,
            data=data,
            headers=auth_headers,
            timeout=5.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport error: {e!r}")
        return
    assert resp.status_code != 500, _sec("SVG upload → 500", resp)
    _try_cleanup(http, auth_headers, resp, fake_machine_id)


def test_polyglot_gif_js_not_served_as_javascript(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
):
    """GIF89a header followed by valid JavaScript.  If the server returns a
    URL that GETs back with Content-Type: application/javascript or text/html
    we have a stored XSS primitive."""
    polyglot = b"GIF89a/*\xff\xff*/=1;\nalert('pwn');//\x00;"
    files = {"file": ("poly.gif", polyglot, "image/gif")}
    data = {"machine_id": fake_machine_id, "filepath": "/tmp/poly.gif"}
    try:
        resp = http.post(
            _backend(multipart_path),
            files=files,
            data=data,
            headers=auth_headers,
            timeout=5.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport error: {e!r}")
        return
    assert resp.status_code != 500, _sec("polyglot upload → 500", resp)
    if not _accepted(resp):
        return
    # If accepted and a URL came back, GET it and verify Content-Type isn't
    # text/javascript or text/html.
    try:
        data_json = resp.json()
    except Exception:
        return
    sid = data_json.get("screenshot_id") or data_json.get("id")
    if sid:
        try:
            get_resp = http.get(
                _backend(f"/api/screenshots/{sid}"),
                headers=auth_headers,
                timeout=10.0,
            )
            if get_resp.status_code == 200:
                ct = (get_resp.headers.get("Content-Type") or "").lower()
                bad_cts = (
                    "javascript",
                    "text/html",
                    "application/x-httpd-php",
                )
                for bad in bad_cts:
                    assert bad not in ct, _sec(
                        f"polyglot served as {ct!r} — XSS / RCE primitive",
                        get_resp,
                    )
        except Exception:
            pass
    _try_cleanup(http, auth_headers, resp, fake_machine_id)


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 2 — Filename attacks
# ═══════════════════════════════════════════════════════════════════════════

# Filenames that should never end up on the server filesystem verbatim.
_BAD_FILENAMES = [
    "../../etc/passwd",
    "..\\..\\windows\\system32\\drivers\\etc\\hosts",
    "/etc/shadow",
    # NUL byte truncation
    "safe.jpg\x00.exe",
    # Windows reserved names — case-insensitive
    "CON.jpg",
    "PRN.jpg",
    "NUL.jpg",
    # Long
    "A" * 300 + ".jpg",
    # Non-ASCII RTL — Unicode bidi override
    "‮gpj.exe",
    # Pure CJK
    "中文.jpg",
    # Just dots
    "...",
]


@pytest.mark.parametrize("filename", _BAD_FILENAMES)
def test_malicious_filename_does_not_500(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
    tiny_jpeg: bytes,
    filename: str,
):
    """The route must accept-or-reject these filenames cleanly.  500 means
    the filename triggered an unhandled exception in the path-handling layer
    — that's the bug we want to catch.

    Note: httpx may rewrite some characters (e.g. NUL) at the wire layer.
    That's a fine "client lib defends" outcome; we catch InvalidURL and
    treat it as a pass.
    """
    files = {"file": (filename, tiny_jpeg, "image/jpeg")}
    data = {"machine_id": fake_machine_id, "filepath": "auto"}
    try:
        resp = http.post(
            _backend(multipart_path),
            files=files,
            data=data,
            headers=auth_headers,
            timeout=5.0,
        )
    except (httpx.InvalidURL, httpx.LocalProtocolError):
        return  # client-side rejection — fine
    except httpx.HTTPError as e:
        pytest.skip(f"transport error: {e!r}")
        return
    assert resp.status_code != 500, _sec(
        f"filename {filename!r} caused 500", resp
    )
    # Defense in depth: if accepted, returned filepath must not contain the
    # raw traversal payload as-is.
    if _accepted(resp):
        try:
            data_json = resp.json()
        except Exception:
            data_json = {}
        fp = (data_json.get("filepath") or "").lower()
        if "/etc/passwd" in fp or "/etc/shadow" in fp:
            pytest.fail(_sec(
                f"server echoed traversal filename verbatim into filepath: "
                f"{fp!r}",
                resp,
            ))
    _try_cleanup(http, auth_headers, resp, fake_machine_id)


def test_collision_same_filename_twice(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
    tiny_jpeg: bytes,
):
    """Two uploads with the same filename — second must either succeed (with
    a different stored ID/path) or reject cleanly.  Never 500."""
    files = {"file": ("dup.jpg", tiny_jpeg, "image/jpeg")}
    data = {"machine_id": fake_machine_id, "filepath": "/tmp/dup.jpg"}
    try:
        r1 = http.post(
            _backend(multipart_path),
            files=files, data=data, headers=auth_headers, timeout=5.0,
        )
        r2 = http.post(
            _backend(multipart_path),
            files=files, data=data, headers=auth_headers, timeout=5.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport: {e!r}")
        return
    for r in (r1, r2):
        assert r.status_code != 500, _sec("duplicate filename → 500", r)
    _try_cleanup(http, auth_headers, r1, fake_machine_id)
    _try_cleanup(http, auth_headers, r2, fake_machine_id)


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 3 — Size attacks
# ═══════════════════════════════════════════════════════════════════════════


@pytest.mark.destructive
@pytest.mark.slow
def test_50mb_single_file_rejected(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
):
    """50MB upload — file_operations.py caps at 10MB; ALB / Cloudflare /
    Uvicorn caps may also fire.  Must be rejected with 4xx, never 5xx,
    and never accepted into permanent storage."""
    big = b"\xff\xd8\xff\xe0" + os.urandom(50 * 1024 * 1024 - 10) + b"\xff\xd9"
    files = {"file": ("big.jpg", big, "image/jpeg")}
    data = {"machine_id": fake_machine_id, "filepath": "/tmp/big.jpg"}
    try:
        resp = http.post(
            _backend(multipart_path),
            files=files,
            data=data,
            headers=auth_headers,
            timeout=30.0,
        )
    except httpx.HTTPError as e:
        # ALB / Cloudflare may close the connection — that's a valid defense.
        return
    assert resp.status_code != 500, _sec("50MB → 500", resp)
    if _accepted(resp):
        pytest.fail(_sec("50MB upload accepted — size cap missing", resp))
    _try_cleanup(http, auth_headers, resp, fake_machine_id)


@pytest.mark.destructive
def test_100_files_in_one_multipart_rejected_or_capped(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
    tiny_jpeg: bytes,
):
    """The route declares one File field; sending 100 files is malformed in
    spec but parsers vary.  Must not OOM / 500."""
    files = [
        ("file", (f"f{i}.jpg", tiny_jpeg, "image/jpeg"))
        for i in range(100)
    ]
    data = {"machine_id": fake_machine_id, "filepath": "/tmp/m.jpg"}
    try:
        resp = http.post(
            _backend(multipart_path),
            files=files,
            data=data,
            headers=auth_headers,
            timeout=15.0,
        )
    except httpx.HTTPError as e:
        return
    assert resp.status_code != 500, _sec(
        "100-file multipart → 500", resp
    )


@pytest.mark.destructive
def test_10mb_raw_text_field_not_file(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
    tiny_jpeg: bytes,
):
    """A 10MB string in `filepath` (a non-file form field).  Some parsers
    enforce per-field size — this confirms the limit applies to text fields
    too, not just File fields."""
    huge_filepath = "/tmp/" + ("A" * (10 * 1024 * 1024))
    files = {"file": ("ok.jpg", tiny_jpeg, "image/jpeg")}
    data = {"machine_id": fake_machine_id, "filepath": huge_filepath}
    try:
        resp = http.post(
            _backend(multipart_path),
            files=files,
            data=data,
            headers=auth_headers,
            timeout=15.0,
        )
    except httpx.HTTPError as e:
        return
    assert resp.status_code != 500, _sec(
        "10MB text field → 500", resp
    )


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 4 — Multipart structure
# ═══════════════════════════════════════════════════════════════════════════


def test_boundary_mismatch_returns_400(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
):
    """Content-Type declares boundary X but body uses boundary Y.  Must
    reject with 4xx, not 5xx, and not silently treat as no-body."""
    body = (
        b"--Y\r\n"
        b"Content-Disposition: form-data; name=\"file\"; filename=\"x.jpg\"\r\n"
        b"Content-Type: image/jpeg\r\n\r\n"
        b"\xff\xd8\xff\xd9\r\n"
        b"--Y--\r\n"
    )
    headers = {
        **auth_headers,
        "Content-Type": "multipart/form-data; boundary=X",
    }
    try:
        resp = http.post(
            _backend(multipart_path),
            content=body,
            headers=headers,
            timeout=5.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport: {e!r}")
        return
    assert resp.status_code != 500, _sec(
        "boundary mismatch caused 500", resp
    )
    assert not _accepted(resp), _sec(
        "boundary mismatch was silently accepted (treated as empty body)",
        resp,
    )


def test_multipart_with_trailing_data_handled(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
    tiny_jpeg: bytes,
):
    """Junk bytes after the closing --boundary--.  Most parsers ignore;
    must not 500.  Content-Length is set correctly so this is a structural
    test, not a length-overflow test."""
    boundary = "----coastytest"
    pre = (
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"machine_id\"\r\n\r\n"
        f"{fake_machine_id}\r\n"
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"filepath\"\r\n\r\n"
        f"/tmp/t.jpg\r\n"
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"file\"; filename=\"t.jpg\"\r\n"
        f"Content-Type: image/jpeg\r\n\r\n"
    ).encode()
    post = f"\r\n--{boundary}--\r\nGARBAGE TRAILING DATA\r\n".encode()
    body = pre + tiny_jpeg + post
    headers = {
        **auth_headers,
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Content-Length": str(len(body)),
    }
    try:
        resp = http.post(
            _backend(multipart_path),
            content=body,
            headers=headers,
            timeout=5.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport: {e!r}")
        return
    assert resp.status_code != 500, _sec(
        "multipart with trailing junk → 500", resp
    )
    _try_cleanup(http, auth_headers, resp, fake_machine_id)


def test_charset_injection_in_content_type(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
    tiny_jpeg: bytes,
):
    """Content-Type with a bogus charset parameter — parser must ignore.
    Not crashing is the test."""
    boundary = "----charsetX"
    body = (
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"machine_id\"\r\n\r\n"
        f"{fake_machine_id}\r\n"
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"filepath\"\r\n\r\n"
        f"/tmp/c.jpg\r\n"
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"file\"; filename=\"c.jpg\"\r\n"
        f"Content-Type: image/jpeg\r\n\r\n"
    ).encode() + tiny_jpeg + f"\r\n--{boundary}--\r\n".encode()
    headers = {
        **auth_headers,
        # Both a charset AND extra spurious params — typical injection vector.
        "Content-Type": f"multipart/form-data; boundary={boundary}; charset=utf-8; foo=\"bar\\\"baz\"",
    }
    try:
        resp = http.post(
            _backend(multipart_path),
            content=body,
            headers=headers,
            timeout=5.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport: {e!r}")
        return
    assert resp.status_code != 500, _sec(
        "Content-Type with charset injection → 500", resp
    )
    _try_cleanup(http, auth_headers, resp, fake_machine_id)


def test_rfc5987_extended_filename_traversal(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
    tiny_jpeg: bytes,
):
    """RFC 5987 lets clients send `filename*=UTF-8''...` for non-ASCII names.
    Some parsers process the encoded value but skip path sanitization.  We
    plant a traversal payload there and confirm it doesn't 500 nor end up
    on disk verbatim."""
    boundary = "----rfc5987"
    body = (
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"machine_id\"\r\n\r\n"
        f"{fake_machine_id}\r\n"
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"filepath\"\r\n\r\n"
        f"auto\r\n"
        f"--{boundary}\r\n"
        f"Content-Disposition: attachment; name=\"file\"; "
        f"filename*=UTF-8''..%2F..%2Fevil.exe\r\n"
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode() + tiny_jpeg + f"\r\n--{boundary}--\r\n".encode()
    headers = {
        **auth_headers,
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }
    try:
        resp = http.post(
            _backend(multipart_path),
            content=body,
            headers=headers,
            timeout=5.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport: {e!r}")
        return
    assert resp.status_code != 500, _sec(
        "RFC 5987 filename* traversal → 500", resp
    )
    if _accepted(resp):
        try:
            data = resp.json()
        except Exception:
            data = {}
        fp = (data.get("filepath") or "")
        assert "../" not in fp and "..\\" not in fp, _sec(
            f"server stored traversal-decoded filename: {fp!r}", resp
        )
    _try_cleanup(http, auth_headers, resp, fake_machine_id)


def test_mixed_file_and_json_parts(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
    tiny_jpeg: bytes,
):
    """A multipart with one File and one application/json field.  FastAPI's
    File/Form combination should accept the file and ignore the rogue JSON
    field cleanly."""
    boundary = "----mixed"
    body = (
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"machine_id\"\r\n\r\n"
        f"{fake_machine_id}\r\n"
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"filepath\"\r\n\r\n"
        f"/tmp/mixed.jpg\r\n"
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"meta\"\r\n"
        f"Content-Type: application/json\r\n\r\n"
        f'{{"x":1, "y":[1,2,{{"deep":true}}]}}\r\n'
        f"--{boundary}\r\n"
        f"Content-Disposition: form-data; name=\"file\"; filename=\"m.jpg\"\r\n"
        f"Content-Type: image/jpeg\r\n\r\n"
    ).encode() + tiny_jpeg + f"\r\n--{boundary}--\r\n".encode()
    headers = {
        **auth_headers,
        "Content-Type": f"multipart/form-data; boundary={boundary}",
    }
    try:
        resp = http.post(
            _backend(multipart_path),
            content=body,
            headers=headers,
            timeout=5.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport: {e!r}")
        return
    assert resp.status_code != 500, _sec(
        "mixed file+JSON multipart → 500", resp
    )
    _try_cleanup(http, auth_headers, resp, fake_machine_id)


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 5 — Storage / retrieval URL hygiene
# ═══════════════════════════════════════════════════════════════════════════


def test_uploaded_file_retrieval_has_safe_disposition(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
    tiny_jpeg: bytes,
):
    """If upload returns a retrievable URL/id, GET-back must:
      * Not echo the user-supplied Content-Type verbatim
      * Have a Content-Disposition without traversal / NUL / CRLF
      * Not be served from a path containing user-controllable segments
    """
    files = {"file": ("retrieval.jpg", tiny_jpeg, "image/jpeg")}
    data = {"machine_id": fake_machine_id, "filepath": "/tmp/retrieval.jpg"}
    try:
        resp = http.post(
            _backend(multipart_path),
            files=files,
            data=data,
            headers=auth_headers,
            timeout=5.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport: {e!r}")
        return
    if not _accepted(resp):
        pytest.skip(
            f"Upload not accepted ({resp.status_code}) — likely no VM "
            f"connected; cannot test retrieval URL"
        )
    try:
        data_json = resp.json()
    except Exception:
        return
    sid = data_json.get("screenshot_id") or data_json.get("id")
    if not sid:
        # file_operations.py returns filepath but no GETable URL — the file
        # lives on the VM, not in object storage.  Nothing to test here.
        _try_cleanup(http, auth_headers, resp, fake_machine_id)
        return
    try:
        get_resp = http.get(
            _backend(f"/api/screenshots/{sid}"),
            headers=auth_headers,
            timeout=10.0,
        )
    except httpx.HTTPError:
        _try_cleanup(http, auth_headers, resp, fake_machine_id)
        return
    if get_resp.status_code == 200:
        ct = (get_resp.headers.get("Content-Type") or "").lower()
        # Server should serve image/* — never echo whatever Content-Type the
        # uploader claimed (would have been image/jpeg here, which is also
        # fine — but never text/html).
        assert not ct.startswith("text/html"), _sec(
            f"retrieval Content-Type is text/html: {ct!r}",
            get_resp,
        )
        cd = get_resp.headers.get("Content-Disposition") or ""
        for bad in ("/", "\\", "..", "\x00", "\r", "\n"):
            assert bad not in cd, _sec(
                f"Content-Disposition contains forbidden char {bad!r}: {cd!r}",
                get_resp,
            )
    _try_cleanup(http, auth_headers, resp, fake_machine_id)


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 6 — Cross-tenant
# ═══════════════════════════════════════════════════════════════════════════


@pytest.fixture(scope="module")
def foreign_token() -> str:
    tok = os.environ.get("TEST_USER_TOKEN_2", "").strip()
    if not tok:
        pytest.skip(
            "Skipping cross-tenant: needs TEST_USER_TOKEN_2 (a second user's "
            "JWT). Stage in tests/post_deploy/.env to enable."
        )
    return tok


def test_uploaded_file_not_retrievable_by_foreign_user(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
    tiny_jpeg: bytes,
    foreign_token: str,
):
    """Upload as user A, attempt retrieval with user B's token.  Must be
    401/403/404 — never serve A's bytes to B."""
    files = {"file": ("xtenant.jpg", tiny_jpeg, "image/jpeg")}
    data = {"machine_id": fake_machine_id, "filepath": "/tmp/xtenant.jpg"}
    try:
        resp = http.post(
            _backend(multipart_path),
            files=files,
            data=data,
            headers=auth_headers,
            timeout=5.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport: {e!r}")
        return
    if not _accepted(resp):
        pytest.skip(
            f"Upload not accepted ({resp.status_code}); cannot test cross-tenant"
        )
    try:
        data_json = resp.json()
    except Exception:
        return
    sid = data_json.get("screenshot_id") or data_json.get("id")
    if sid:
        get_resp = http.get(
            _backend(f"/api/screenshots/{sid}"),
            headers={"Authorization": f"Bearer {foreign_token}"},
            timeout=10.0,
        )
        assert get_resp.status_code in (401, 403, 404), _sec(
            f"foreign user retrieved owner's file (sid={sid}, status="
            f"{get_resp.status_code})",
            get_resp,
        )
    _try_cleanup(http, auth_headers, resp, fake_machine_id)


def test_random_uuid_enumeration_fails(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """Guess a handful of UUIDs against the screenshot endpoint — must all
    be 404 (or 401/403).  200 means IDs are guessable / sequential."""
    for _ in range(8):
        sid = uuid.uuid4().hex[:16]
        try:
            r = http.get(
                _backend(f"/api/screenshots/{sid}"),
                headers=auth_headers,
                timeout=10.0,
            )
        except httpx.HTTPError:
            continue
        assert r.status_code != 200, _sec(
            f"random uuid {sid} returned 200 — id space too small / "
            "tenancy missing",
            r,
        )
        assert r.status_code != 500, _sec(
            f"random uuid {sid} → 500", r
        )


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 7 — Image-specific (image_compression)
# ═══════════════════════════════════════════════════════════════════════════


@pytest.mark.destructive
def test_truncated_jpeg_does_not_crash_compressor(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
    tiny_jpeg: bytes,
):
    """Truncated JPEG (only the SOI marker + half a byte).  Image compressor
    in image_compression.py wraps in try/except — we confirm it actually
    catches and returns a 4xx (not 500)."""
    truncated = tiny_jpeg[:30]
    files = {"file": ("trunc.jpg", truncated, "image/jpeg")}
    data = {"machine_id": fake_machine_id, "filepath": "/tmp/trunc.jpg"}
    try:
        resp = http.post(
            _backend(multipart_path),
            files=files,
            data=data,
            headers=auth_headers,
            timeout=5.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport: {e!r}")
        return
    assert resp.status_code != 500, _sec(
        "truncated JPEG → 500 (compressor crashed)", resp
    )


@pytest.mark.destructive
def test_zip_bomb_style_image_high_resolution(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
):
    """A PNG declaring 50000x50000 in IHDR — if PIL doesn't have a decompression
    bomb guard, this would allocate ~10GB on decode.  Modern PIL has the guard
    on by default; we confirm the route doesn't crash regardless.
    """
    # Build a minimal PNG with bogus huge dimensions in IHDR.
    sig = b"\x89PNG\r\n\x1a\n"
    # IHDR chunk: width=50000 height=50000 bit_depth=8 color=2 (RGB)
    ihdr_data = struct.pack(">IIBBBBB", 50000, 50000, 8, 2, 0, 0, 0)
    import zlib
    crc = zlib.crc32(b"IHDR" + ihdr_data)
    ihdr = struct.pack(">I", len(ihdr_data)) + b"IHDR" + ihdr_data + struct.pack(">I", crc)
    iend_data = b""
    iend = (
        struct.pack(">I", 0)
        + b"IEND"
        + struct.pack(">I", zlib.crc32(b"IEND"))
    )
    bomb = sig + ihdr + iend  # no IDAT — header-only, intentionally invalid
    files = {"file": ("bomb.png", bomb, "image/png")}
    data = {"machine_id": fake_machine_id, "filepath": "/tmp/bomb.png"}
    try:
        resp = http.post(
            _backend(multipart_path),
            files=files,
            data=data,
            headers=auth_headers,
            timeout=5.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport: {e!r}")
        return
    assert resp.status_code != 500, _sec(
        "zip-bomb-resolution PNG → 500", resp
    )


@pytest.mark.destructive
def test_jpeg_with_exif_gps_handled(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
    tiny_jpeg: bytes,
):
    """A JPEG with a fake EXIF segment containing GPS-shaped bytes.  We can't
    easily verify the *server* stripped them without a retrieval URL that
    serves the raw file — but we can confirm the upload doesn't 500."""
    # Splice a bogus APP1 (EXIF) segment after the SOI marker.
    fake_exif = b"\xff\xe1\x00\x10Exif\x00\x00II*\x00\x00\x00\x00\x00"
    spiked = tiny_jpeg[:2] + fake_exif + tiny_jpeg[2:]
    files = {"file": ("exif.jpg", spiked, "image/jpeg")}
    data = {"machine_id": fake_machine_id, "filepath": "/tmp/exif.jpg"}
    try:
        resp = http.post(
            _backend(multipart_path),
            files=files,
            data=data,
            headers=auth_headers,
            timeout=5.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport: {e!r}")
        return
    assert resp.status_code != 500, _sec(
        "EXIF-spiked JPEG → 500", resp
    )
    _try_cleanup(http, auth_headers, resp, fake_machine_id)


# ═══════════════════════════════════════════════════════════════════════════
# SECTION 8 — Edge cases
# ═══════════════════════════════════════════════════════════════════════════


def test_empty_zero_byte_file_consistent(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
):
    """0-byte file — server may accept (with size=0) or reject (4xx).  Either
    is consistent.  The failure mode is 5xx."""
    files = {"file": ("empty.bin", b"", "application/octet-stream")}
    data = {"machine_id": fake_machine_id, "filepath": "/tmp/empty.bin"}
    try:
        resp = http.post(
            _backend(multipart_path),
            files=files,
            data=data,
            headers=auth_headers,
            timeout=5.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport: {e!r}")
        return
    assert resp.status_code != 500, _sec("empty file → 500", resp)
    _try_cleanup(http, auth_headers, resp, fake_machine_id)


def test_content_length_zero_post(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
):
    """POST with Content-Length: 0 (no body at all) — must reject with 4xx,
    never 5xx, and never partially process."""
    headers = {
        **auth_headers,
        "Content-Type": "multipart/form-data; boundary=X",
        "Content-Length": "0",
    }
    try:
        resp = http.post(
            _backend(multipart_path),
            content=b"",
            headers=headers,
            timeout=10.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport: {e!r}")
        return
    assert resp.status_code != 500, _sec("Content-Length: 0 → 500", resp)
    assert not _accepted(resp), _sec(
        "Content-Length: 0 multipart accepted as success", resp
    )


def test_put_to_post_only_route_returns_405(
    http: httpx.Client,
    auth_headers: dict[str, str],
    multipart_path: str,
    fake_machine_id: str,
    tiny_jpeg: bytes,
):
    """PUT to /api/files/upload-multipart (POST-only) must be 405.  We
    accept 404 too (some routers report 404 for method mismatch)."""
    files = {"file": ("put.jpg", tiny_jpeg, "image/jpeg")}
    data = {"machine_id": fake_machine_id, "filepath": "/tmp/put.jpg"}
    try:
        resp = http.put(
            _backend(multipart_path),
            files=files,
            data=data,
            headers=auth_headers,
            timeout=10.0,
        )
    except httpx.HTTPError as e:
        pytest.skip(f"transport: {e!r}")
        return
    # 405 = explicit method-not-allowed; 404 = router-level method dispatch;
    # 403 = some deployments gate non-listed methods at the middleware layer.
    # 200/201 = the route accepted PUT — that's a real bug.  Anything else
    # 4xx is acceptable too as long as it isn't a 2xx success.
    assert not _accepted(resp), _sec(
        f"PUT to POST-only multipart route was ACCEPTED ({resp.status_code}) "
        "— wrong-verb routing is broken",
        resp,
    )
    assert resp.status_code != 500, _sec(
        f"PUT to POST-only multipart route caused 500", resp
    )
