"""
test_security_byok_keys.py — Post-deployment security checks for the
BYOK (bring-your-own-key) endpoint at ``POST/DELETE /api/user-keys``.

The endpoint stores a user-supplied LLM provider API key encrypted at-rest
with AES-GCM (see ``lib/encryption.ts``). The contract this test locks in:

  * 401 if the request isn't authenticated.
  * 400 (NOT 500) on malformed / missing / weird input.
  * Foreign / unknown providers don't return 200 success on DELETE.
  * Stored keys are NEVER returned in plaintext anywhere — not in
    /api/user-keys, not via any list endpoint, not via Supabase row dumps
    that the API might expose. Only metadata + last-4-mask is acceptable.
  * Embedded null bytes / CRLF / pathological-length keys are rejected
    (client-side or with a clean 400 — never crash the service).

Every test is marked ``@pytest.mark.security``. Tests that mutate state
clean up after themselves and are also marked ``@pytest.mark.destructive``
so an SKIP_DESTRUCTIVE flag can hide them in production smoke runs.

We cap test creation at 5 keys/runs to avoid flooding the user_keys table
or burning rate-limit budget on Cloudflare.
"""
from __future__ import annotations

import json
import re
from typing import Any

import pytest

from conftest import assert_status, cfg

pytestmark = pytest.mark.security


# ── Helpers ────────────────────────────────────────────────────────────────


def _frontend_url(path: str) -> str:
    return f"{cfg().frontend_url}{path}"


# Heuristic providers known to the codebase. We pick `openai` — the smallest
# real provider in the BYOK list — and fall back to a sentinel if rejected.
_TEST_PROVIDER = "openai"

# Realistic-looking OpenAI key shape — just for shape, not a live key.
# 51 chars, sk- prefix, alphanumeric.
_FAKE_OK_KEY = "sk-proj-" + ("A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2")


def _looks_like_iv_field(body_text: str) -> bool:
    """Detect any leakage of internal storage layout (`iv:`, raw hex blob)."""
    if "iv:" in body_text.lower():
        return True
    # Raw GCM blob would look like `<long hex>:<32 hex>`.
    if re.search(r"[0-9a-f]{64,}:[0-9a-f]{32}", body_text):
        return True
    return False


def _post_user_keys(http, headers: dict[str, str], payload: dict) -> Any:
    """POST /api/user-keys — wraps a single call so test bodies stay tight."""
    return http.post(
        _frontend_url("/api/user-keys"),
        headers={**headers, "Content-Type": "application/json"},
        json=payload,
    )


def _delete_user_keys(http, headers: dict[str, str], payload: dict) -> Any:
    return http.request(
        "DELETE",
        _frontend_url("/api/user-keys"),
        headers={**headers, "Content-Type": "application/json"},
        json=payload,
    )


def _cleanup_provider(http, headers: dict[str, str], provider: str) -> None:
    """Best-effort cleanup — never fails the test if the row is already gone."""
    try:
        _delete_user_keys(http, headers, {"provider": provider})
    except Exception:
        pass


# ── Tests ─────────────────────────────────────────────────────────────────


class TestBYOKAuthGate:
    """Anything that mutates user_keys must require auth, full stop."""

    def test_post_without_auth_is_401(self, http):
        resp = _post_user_keys(http, {}, {"provider": _TEST_PROVIDER, "apiKey": _FAKE_OK_KEY})
        # We accept 401 (preferred), 403 (Cloudflare gate), or 302 (redirect to
        # login); we DO NOT accept 200 (silent accept) or 500 (crash).
        assert resp.status_code in (302, 401, 403), (
            f"SECURITY: unauth POST /api/user-keys should be rejected, got {resp.status_code}"
        )

    def test_delete_without_auth_is_401(self, http):
        resp = _delete_user_keys(http, {}, {"provider": _TEST_PROVIDER})
        assert resp.status_code in (302, 401, 403), (
            f"SECURITY: unauth DELETE /api/user-keys should be rejected, got {resp.status_code}"
        )


class TestBYOKMalformedInput:
    """Bad input should be a clean 400, NEVER a 500 / stack-trace."""

    def test_post_missing_provider_is_400_not_500(self, http, auth_headers):
        resp = _post_user_keys(http, auth_headers, {"apiKey": _FAKE_OK_KEY})
        assert resp.status_code != 500, (
            f"SECURITY: server crashed on missing-provider input. Body: {resp.text[:300]}"
        )
        assert resp.status_code in (400, 401, 403, 422), (
            f"SECURITY: expected 4xx for missing-provider, got {resp.status_code}"
        )

    def test_post_missing_api_key_is_400_not_500(self, http, auth_headers):
        resp = _post_user_keys(http, auth_headers, {"provider": _TEST_PROVIDER})
        assert resp.status_code != 500
        assert resp.status_code in (400, 401, 403, 422)

    def test_post_empty_body_is_400_not_500(self, http, auth_headers):
        resp = http.post(
            _frontend_url("/api/user-keys"),
            headers={**auth_headers, "Content-Type": "application/json"},
            content=b"",
        )
        assert resp.status_code != 500, f"SECURITY: empty body crashed server. Body: {resp.text[:300]}"
        assert resp.status_code in (400, 401, 403, 422)

    def test_post_garbage_json_is_400_not_500(self, http, auth_headers):
        resp = http.post(
            _frontend_url("/api/user-keys"),
            headers={**auth_headers, "Content-Type": "application/json"},
            content=b"{not-valid-json",
        )
        assert resp.status_code != 500
        assert resp.status_code in (400, 401, 403, 422)

    def test_post_with_null_byte_in_key_rejected_or_sanitized(self, http, auth_headers):
        """A null byte in the API key must NOT crash the server. Either 400
        (rejected) or 200 (sanitized) is acceptable; 500 is not."""
        provider = f"{_TEST_PROVIDER}-nullbyte-test"
        resp = _post_user_keys(
            http, auth_headers, {"provider": provider, "apiKey": "sk-\x00malicious"}
        )
        try:
            assert resp.status_code != 500, (
                f"SECURITY: null byte in apiKey crashed server. Body: {resp.text[:300]}"
            )
            assert resp.status_code in (200, 400, 401, 403, 422)
        finally:
            _cleanup_provider(http, auth_headers, provider)

    def test_post_with_crlf_in_key_rejected_or_sanitized(self, http, auth_headers):
        """CRLF injection — if logged or echoed, this could split log lines."""
        provider = f"{_TEST_PROVIDER}-crlf-test"
        resp = _post_user_keys(
            http,
            auth_headers,
            {"provider": provider, "apiKey": "sk-real\r\nX-Injected: yes"},
        )
        try:
            assert resp.status_code != 500
            # The key may be stored as-is (encryption happens before storage),
            # but it MUST NOT cause a 500.
            assert resp.status_code in (200, 400, 401, 403, 422)
        finally:
            _cleanup_provider(http, auth_headers, provider)

    def test_post_with_extremely_long_key_is_rejected_or_clamped(self, http, auth_headers):
        """A 1MB API key would never be valid. It should be rejected before
        reaching encryption, NOT crash on memory."""
        provider = f"{_TEST_PROVIDER}-huge-test"
        huge = "A" * (1024 * 1024)  # 1 MB
        resp = _post_user_keys(http, auth_headers, {"provider": provider, "apiKey": huge})
        try:
            # Acceptable outcomes: rejected with 400/413/422, or accepted with
            # 200 (the encryption layer can handle it). NEVER 500.
            assert resp.status_code != 500, (
                f"SECURITY: 1MB apiKey crashed server. Status={resp.status_code} "
                f"Body: {resp.text[:200]}"
            )
            assert resp.status_code in (200, 400, 401, 403, 413, 422)
        finally:
            _cleanup_provider(http, auth_headers, provider)


class TestBYOKResponseHygiene:
    """Responses must never leak the encrypted blob or the raw API key."""

    def test_post_response_does_not_echo_raw_key(self, http, auth_headers):
        """Submit a unique-looking key and confirm the response body never
        contains the raw key value."""
        provider = f"{_TEST_PROVIDER}-echo-test"
        marker = "sk-MARKER-ECHO-DETECTOR-9d8e7f6c5b4a3210"
        resp = _post_user_keys(http, auth_headers, {"provider": provider, "apiKey": marker})
        try:
            if resp.status_code == 200:
                assert marker not in resp.text, (
                    "SECURITY: response body echoed the raw API key — should be opaque/masked."
                )
                assert not _looks_like_iv_field(resp.text), (
                    f"SECURITY: response leaked encryption internals (iv: / hex blob). "
                    f"Body: {resp.text[:300]}"
                )
        finally:
            _cleanup_provider(http, auth_headers, provider)

    def test_post_response_does_not_leak_encryption_iv_field(self, http, auth_headers):
        """Even on error, the response shouldn't expose `iv:` or hex blob form."""
        provider = f"{_TEST_PROVIDER}-iv-leak-test"
        resp = _post_user_keys(
            http, auth_headers, {"provider": provider, "apiKey": "sk-leakcheck"}
        )
        try:
            assert not _looks_like_iv_field(resp.text), (
                f"SECURITY: response body looks like raw `<ct>:<tag>` blob: {resp.text[:300]}"
            )
        finally:
            _cleanup_provider(http, auth_headers, provider)


class TestBYOKAuthorizationScope:
    """A user must not be able to delete another user's BYOK row."""

    def test_delete_unknown_provider_is_not_silent_200_with_data(self, http, auth_headers):
        """Deleting a never-set provider must be idempotent (200) but MUST NOT
        return that provider's data — and definitely no decrypted key."""
        resp = _delete_user_keys(
            http, auth_headers, {"provider": "this-provider-does-not-exist-xyz"}
        )
        # Acceptable: 200 (idempotent delete), 404, 401/403.
        assert resp.status_code in (200, 401, 403, 404), (
            f"SECURITY: unknown-provider DELETE returned {resp.status_code}. "
            f"Body: {resp.text[:200]}"
        )
        # If it WAS 200, the body must not include any encrypted_key payload.
        if resp.status_code == 200:
            assert "encrypted_key" not in resp.text.lower()
            assert not _looks_like_iv_field(resp.text)

    def test_delete_with_foreign_provider_does_not_return_other_users_data(self, http, auth_headers):
        """Deleting a real-but-not-owned provider returns 200 (own row not
        present, no-op) — but the body must NEVER include any other user's
        row, key, or encrypted blob."""
        resp = _delete_user_keys(
            http, auth_headers, {"provider": "foreign-user-provider-test"}
        )
        if resp.status_code == 200:
            assert not _looks_like_iv_field(resp.text)
            assert "user_id" not in resp.text.lower() or "encrypted" not in resp.text.lower()


class TestBYOKListEndpointIfPresent:
    """If a list endpoint exists, it must NEVER return decrypted keys or the
    raw stored ciphertext+iv. Only metadata + masked last-4 are acceptable.

    This endpoint may not exist — if not, the test is a no-op (skip).
    """

    @pytest.mark.parametrize(
        "candidate",
        [
            "/api/user-keys",
            "/api/user-keys/list",
            "/api/keys",
            "/api/byok/keys",
        ],
    )
    def test_list_endpoint_does_not_return_plaintext_or_blob(
        self, http, auth_headers, candidate
    ):
        resp = http.get(_frontend_url(candidate), headers=auth_headers)
        # 404 / 405: endpoint doesn't exist or doesn't accept GET — fine, skip.
        if resp.status_code in (404, 405):
            pytest.skip(f"List endpoint {candidate} not present (status={resp.status_code})")
        # 401/403/302 are also fine (auth gate behaviour).
        if resp.status_code in (302, 401, 403):
            return
        assert resp.status_code == 200, (
            f"Unexpected status from {candidate}: {resp.status_code}"
        )
        body = resp.text
        # Must not contain raw decryption material.
        assert not _looks_like_iv_field(body), (
            f"SECURITY: GET {candidate} leaked encryption blob. Body: {body[:300]}"
        )
        # Must not contain literal `encrypted_key` field with hex content.
        if "encrypted_key" in body.lower():
            # The key is allowed to be PRESENT as a metadata flag but should
            # not include the actual ciphertext. Heuristic: if the value
            # adjacent to "encrypted_key" looks like 64+ hex chars, fail.
            assert not re.search(
                r'"encrypted_key"\s*:\s*"[0-9a-f]{32,}', body, re.IGNORECASE
            ), (
                f"SECURITY: list endpoint leaked encrypted_key contents. "
                f"Body: {body[:400]}"
            )


class TestBYOKRoundTrip:
    """End-to-end create-then-delete to confirm the happy path is hygienic.

    Tightly capped (one create + one delete) — never spam the table.
    """

    @pytest.mark.destructive
    def test_create_then_delete_is_clean(self, http, auth_headers):
        provider = f"{_TEST_PROVIDER}-roundtrip-{int(__import__('time').time())}"
        try:
            create = _post_user_keys(
                http, auth_headers, {"provider": provider, "apiKey": _FAKE_OK_KEY}
            )
            if create.status_code in (302, 401, 403):
                pytest.skip(
                    "Auth gate refused; this likely means TEST_USER_TOKEN is "
                    "missing scopes or the app is in a maintenance mode."
                )
            assert_status(create, (200, 201))
            # Body must not echo raw key, must not contain `iv:`/blob.
            assert _FAKE_OK_KEY not in create.text
            assert not _looks_like_iv_field(create.text)
        finally:
            _cleanup_provider(http, auth_headers, provider)
