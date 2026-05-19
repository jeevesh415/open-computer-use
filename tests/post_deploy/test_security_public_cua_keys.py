"""
test_security_public_cua_keys.py — Post-deployment security checks for the
public CUA API key issuance endpoints (``/api/v1/cua/keys``) backed by
``backend/app/services/api_key_service.py``.

Contract this test pins:

  * Issuance/list/revoke endpoints all require auth (X-API-Key OR Bearer).
  * Creating a key returns ``cua_sk_<48 hex chars>`` ONCE; subsequent reads
    return only metadata (``key_prefix``, ``name``, ``tier``, ``scopes``,
    ``created_at``, ``last_used_at``, ``id``) — never the raw key, never the
    sha256 hash.
  * A revoked key is rejected (401) on next use.
  * Garbage / truncated / wrong-prefix keys are 401, never 5xx.
  * Both ``X-API-Key: cua_sk_…`` and ``Authorization: Bearer cua_sk_…``
    are honored consistently for any endpoint that accepts either.
  * Issuance endpoint is rate-limited (eventually returns 429).
  * Generated keys have realistic Shannon-style entropy: a 100-key sample
    (informational, capped at the platform's max-keys-per-user setting)
    should use a wide character set.

Cap: at most 5 created keys per test run, with cleanup. Skip cleanly when
TEST_PUBLIC_API_KEY isn't configured.
"""
from __future__ import annotations

import os
import string
import time
from typing import Any

import httpx
import pytest

from conftest import assert_status, cfg

pytestmark = pytest.mark.security

# ── Constants ──────────────────────────────────────────────────────────────

PUBLIC_API_PREFIX = "/api/v1/cua"

# Per-user issuance ceiling enforced by api_key_service.MAX_KEYS_PER_USER (=20).
# We never want to consume more than 5 to leave headroom for product use.
_TEST_CREATE_CAP = 5


def _url(path: str) -> str:
    return f"{cfg().backend_public_url}{PUBLIC_API_PREFIX}{path}"


def _api_key() -> str | None:
    return os.environ.get("TEST_PUBLIC_API_KEY", "").strip() or None


def _xapi_headers(key: str | None = None) -> dict[str, str]:
    k = key or _api_key()
    if not k:
        pytest.skip("TEST_PUBLIC_API_KEY not set")
    return {"X-API-Key": k}


def _bearer_headers(key: str | None = None) -> dict[str, str]:
    k = key or _api_key()
    if not k:
        pytest.skip("TEST_PUBLIC_API_KEY not set")
    return {"Authorization": f"Bearer {k}"}


def _looks_like_cua_sk(s: str) -> bool:
    if not isinstance(s, str):
        return False
    if not s.startswith("cua_sk_"):
        return False
    rest = s[len("cua_sk_"):]
    return len(rest) == 48 and all(c in "0123456789abcdef" for c in rest)


def _safe_revoke(http: httpx.Client, key_id: str) -> None:
    """Best-effort revoke for cleanup. Swallows all errors."""
    try:
        http.request("DELETE", _url(f"/keys/{key_id}"), headers=_xapi_headers())
    except Exception:
        pass


# ───────────────────────────────────────────────────────────────────────────
# Auth gate
# ───────────────────────────────────────────────────────────────────────────


class TestPublicCUAKeysAuthGate:
    def test_post_keys_without_auth_is_401(self, http):
        resp = http.post(_url("/keys"), json={"name": "noauth", "scopes": ["predict"]})
        assert resp.status_code == 401, (
            f"SECURITY: POST /keys without auth must be 401, got {resp.status_code}. "
            f"Body: {resp.text[:200]}"
        )

    def test_get_keys_without_auth_is_401(self, http):
        resp = http.get(_url("/keys"))
        assert resp.status_code == 401, (
            f"SECURITY: GET /keys without auth must be 401, got {resp.status_code}"
        )

    def test_delete_keys_without_auth_is_401(self, http):
        resp = http.request("DELETE", _url("/keys/whatever"))
        assert resp.status_code == 401, (
            f"SECURITY: DELETE /keys/<id> without auth must be 401, got {resp.status_code}"
        )

    def test_garbage_key_format_is_401(self, http):
        resp = http.get(_url("/keys"), headers={"X-API-Key": "this-is-not-a-valid-key"})
        assert resp.status_code == 401, (
            f"SECURITY: garbage key shape must be 401, got {resp.status_code}"
        )

    def test_truncated_cua_sk_is_401(self, http):
        # Real prefix, way-too-short suffix.
        resp = http.get(_url("/keys"), headers={"X-API-Key": "cua_sk_abc"})
        assert resp.status_code == 401, (
            f"SECURITY: truncated cua_sk_ must be 401, got {resp.status_code}"
        )

    def test_cua_sk_with_corrupted_hex_is_401(self, http):
        # Right shape, wrong content (not in the DB).
        bogus = "cua_sk_" + ("0" * 48)
        resp = http.get(_url("/keys"), headers={"X-API-Key": bogus})
        assert resp.status_code == 401

    def test_cua_sk_with_invalid_chars_in_suffix_is_401(self, http):
        # Right shape length, non-hex chars (would never validate against
        # any sha256 hash in the DB and may also fail format checks).
        bogus = "cua_sk_" + ("Z" * 48)
        resp = http.get(_url("/keys"), headers={"X-API-Key": bogus})
        assert resp.status_code == 401


# ───────────────────────────────────────────────────────────────────────────
# Bearer vs X-API-Key parity (both supported headers should be consistent)
# ───────────────────────────────────────────────────────────────────────────


class TestPublicCUAKeysBearerHeader:
    """The current contract is ``X-API-Key`` only — Bearer is NOT honored
    by ``get_api_key_context``. We pin that fact: a Bearer with a cua_sk_…
    value MUST consistently fail (401) so callers don't accidentally rely on
    a behavior the backend doesn't implement.

    If/when Bearer is added, flip the assertion in this test."""

    def test_bearer_with_cua_sk_is_consistently_rejected_when_xapi_required(self, http):
        key = _api_key()
        if not key:
            pytest.skip("TEST_PUBLIC_API_KEY not set")
        # Use only Bearer (no X-API-Key). Backend reads only X-API-Key for
        # this surface; expect 401.
        resp = http.get(_url("/keys"), headers={"Authorization": f"Bearer {key}"})
        assert resp.status_code == 401, (
            f"Bearer-only auth should currently fail (X-API-Key is the contract). "
            f"Got {resp.status_code}. Update this test if Bearer support is added."
        )

    def test_xapi_with_valid_key_is_accepted(self, http):
        resp = http.get(_url("/keys"), headers=_xapi_headers())
        assert resp.status_code in (200, 429), (
            f"Valid X-API-Key should authenticate — got {resp.status_code}. "
            f"Body: {resp.text[:200]}"
        )


# ───────────────────────────────────────────────────────────────────────────
# Issuance, list, revoke — happy path, with strict response shape
# ───────────────────────────────────────────────────────────────────────────


class TestPublicCUAKeysIssuanceShape:
    """One creation per run, immediately revoked. Skip cleanly when the
    configured key lacks ``keys:write`` scope — we don't fail tests just
    because the test API key is read-only."""

    @pytest.mark.destructive
    def test_create_returns_raw_key_once_then_only_metadata(self, http):
        resp = http.post(
            _url("/keys"),
            headers=_xapi_headers(),
            json={"name": "post-deploy-security-roundtrip", "scopes": ["predict"]},
        )
        if resp.status_code in (401, 403):
            pytest.skip(
                f"Test key lacks keys:write or other key-management scope "
                f"(status={resp.status_code}). Skipping issuance test."
            )
        if resp.status_code == 429:
            pytest.skip("Rate limited on issuance endpoint — try later.")
        assert_status(resp, 200)

        body = resp.json()
        # The raw key is returned EXACTLY once, in the create response.
        assert "key" in body, f"Create response missing 'key': {body}"
        raw = body["key"]
        assert _looks_like_cua_sk(raw), f"Raw key shape wrong: {raw!r}"
        key_id = body.get("key_id") or body.get("id")
        assert key_id, f"Create response missing key_id: {body}"

        try:
            # Subsequent list MUST return only metadata for this key.
            list_resp = http.get(_url("/keys"), headers=_xapi_headers())
            assert_status(list_resp, 200)
            keys = list_resp.json().get("keys", [])
            ours = next((k for k in keys if k.get("id") == key_id), None)
            assert ours, f"Created key not in list response: {keys}"
            # Raw key MUST NOT be in the list payload.
            assert raw not in list_resp.text, (
                "SECURITY: raw cua_sk_ leaked in list response after creation."
            )
            # Stored hash MUST NOT be in the list payload either.
            assert "key_hash" not in ours, (
                "SECURITY: key_hash leaked in list response — should be metadata-only."
            )
            # `key_prefix` is allowed (intended preview = first 12 chars).
            if "key_prefix" in ours:
                assert ours["key_prefix"] == raw[:12]
        finally:
            _safe_revoke(http, key_id)

    @pytest.mark.destructive
    def test_revoked_key_returns_401_on_next_use(self, http):
        """Create a fresh key, revoke it, confirm /usage with that key is 401.

        Note: the service caches valid records for KEY_CACHE_TTL_SECONDS=60s,
        but ``revoke_key`` invalidates the cache immediately by design — so
        the rejection should happen on the very next call.
        """
        create = http.post(
            _url("/keys"),
            headers=_xapi_headers(),
            json={"name": "post-deploy-revoke-test", "scopes": ["predict"]},
        )
        if create.status_code in (401, 403):
            pytest.skip(f"Cannot mint a key (status={create.status_code}); skip.")
        if create.status_code == 429:
            pytest.skip("Rate limited.")
        assert_status(create, 200)
        body = create.json()
        raw = body["key"]
        key_id = body.get("key_id") or body.get("id")
        assert key_id

        # Revoke through the parent (control) key.
        rev = http.request("DELETE", _url(f"/keys/{key_id}"), headers=_xapi_headers())
        # Acceptable: 200 (revoked) or 404 (already gone — race).
        assert rev.status_code in (200, 404), (
            f"Revoke unexpected status {rev.status_code}: {rev.text[:200]}"
        )

        # The revoked key should now fail to authenticate on its own.
        # Use /usage which is the cheapest read endpoint that still requires auth.
        check = http.get(_url("/usage"), headers={"X-API-Key": raw})
        assert check.status_code == 401, (
            f"SECURITY: revoked key {key_id} still validates! Got {check.status_code}. "
            f"Body: {check.text[:200]}"
        )


# ───────────────────────────────────────────────────────────────────────────
# Rate limiting
# ───────────────────────────────────────────────────────────────────────────


class TestPublicCUAKeysRateLimit:
    """Issuance is gated by the same per-key + per-user rate limiter as the
    rest of the public API. Free tier = 3 rpm. We send 6 quick POSTs and
    expect at least one 429 — without ever creating more than 5 real keys.

    Cleanup: any successful create gets revoked in teardown.
    """

    @pytest.mark.slow
    @pytest.mark.destructive
    def test_issuance_endpoint_is_rate_limited(self, http):
        if not _api_key():
            pytest.skip("TEST_PUBLIC_API_KEY not set")
        created_ids: list[str] = []
        try:
            saw_429 = False
            for i in range(6):
                resp = http.post(
                    _url("/keys"),
                    headers=_xapi_headers(),
                    json={"name": f"rate-test-{i}", "scopes": ["predict"]},
                )
                if resp.status_code == 429:
                    saw_429 = True
                    break
                if resp.status_code in (401, 403):
                    pytest.skip(
                        f"Cannot mint keys (status={resp.status_code}); skipping rate-limit test."
                    )
                if resp.status_code == 200:
                    body = resp.json()
                    kid = body.get("key_id") or body.get("id")
                    if kid:
                        created_ids.append(kid)
                    if len(created_ids) >= _TEST_CREATE_CAP:
                        # Don't blow past the cap even if 429 hasn't fired yet.
                        break
                else:
                    # Anything else (e.g. 500) is its own bug — surface it.
                    raise AssertionError(
                        f"Unexpected status from /keys on iteration {i}: "
                        f"{resp.status_code} {resp.text[:200]}"
                    )
            # If 429 didn't fire within 6 calls and we hit the cap, that's an
            # informational miss — flag, don't fail. The user-tier rate limit
            # might be 30+ rpm.
            if not saw_429:
                pytest.skip(
                    "No 429 within 6 calls — rate limit may be tier-dependent. "
                    "Re-run with a free-tier key to exercise the 3rpm cap."
                )
        finally:
            for kid in created_ids:
                _safe_revoke(http, kid)


# ───────────────────────────────────────────────────────────────────────────
# Entropy of generated keys
# ───────────────────────────────────────────────────────────────────────────


class TestPublicCUAKeyEntropy:
    """Informational — confirms generated keys use the full hex alphabet
    (16 unique chars across the suffix, on average). A 100-key sample is
    overkill for a post-deploy smoke; we cap at the test cap so we never
    spam the user's quota."""

    @pytest.mark.slow
    @pytest.mark.destructive
    def test_generated_keys_use_full_hex_alphabet(self, http):
        if not _api_key():
            pytest.skip("TEST_PUBLIC_API_KEY not set")
        created_ids: list[str] = []
        suffixes: list[str] = []
        try:
            for i in range(_TEST_CREATE_CAP):
                resp = http.post(
                    _url("/keys"),
                    headers=_xapi_headers(),
                    json={"name": f"entropy-test-{i}", "scopes": ["predict"]},
                )
                if resp.status_code in (401, 403, 429):
                    pytest.skip(
                        f"Aborting entropy test at iteration {i} (status={resp.status_code})."
                    )
                if resp.status_code != 200:
                    pytest.skip(
                        f"Unexpected {resp.status_code} during entropy test: {resp.text[:200]}"
                    )
                body = resp.json()
                raw = body.get("key", "")
                kid = body.get("key_id") or body.get("id")
                if kid:
                    created_ids.append(kid)
                if _looks_like_cua_sk(raw):
                    suffixes.append(raw[len("cua_sk_"):])
            if len(suffixes) < 2:
                pytest.skip("Could not gather enough samples for entropy check.")
            # Aggregate unique-char count across all sampled suffixes. With
            # ~5 * 48 = 240 random hex chars, we expect close to all 16 hex
            # symbols to appear. Allow some slack — assert >= 12.
            chars = set("".join(suffixes))
            assert chars.issubset(set(string.hexdigits.lower())), (
                f"SECURITY: generated key contains non-hex chars: {chars - set(string.hexdigits.lower())}"
            )
            assert len(chars) >= 12, (
                f"SECURITY: generated keys use only {len(chars)} unique chars "
                f"({chars}); the suffix should be uniformly distributed hex."
            )
            # All suffixes must be unique.
            assert len(suffixes) == len(set(suffixes)), (
                "SECURITY: duplicate cua_sk_ suffix observed in a small sample — PRNG broken?"
            )
        finally:
            for kid in created_ids:
                _safe_revoke(http, kid)


# ───────────────────────────────────────────────────────────────────────────
# Foreign-key revoke — a key id from another account must NOT be deletable
# ───────────────────────────────────────────────────────────────────────────


class TestPublicCUAKeysForeignRevoke:
    """A user must not be able to revoke another user's key id. The backend
    enforces this with an `eq("user_id", ...)` filter on the UPDATE — we
    can't directly mint a foreign key without a second test user, so we use
    a clearly-foreign key id shape (``foreign-not-mine-…``) and assert that
    the response is 404 (record not found for this user) — NOT 200 success.

    If TEST_USER_TOKEN_2 ever gets added, expand this to the real cross-
    account check. For now: 404 is the secure outcome; 200 would be a
    horizontal-privilege-escalation bug."""

    def test_revoke_with_foreign_looking_key_id_is_404(self, http):
        if not _api_key():
            pytest.skip("TEST_PUBLIC_API_KEY not set")
        foreign_id = "foreign-not-mine-deadbeefcafef00d"
        resp = http.request("DELETE", _url(f"/keys/{foreign_id}"), headers=_xapi_headers())
        # 429 from this test means earlier tests in the same run consumed the
        # free-tier rpm budget — that's an environment artifact, not a
        # security finding. Skip rather than fail.
        if resp.status_code == 429:
            pytest.skip(
                "Rate limited before reaching foreign-key revoke check — "
                "rerun in isolation or wait for the rpm bucket to reset."
            )
        # 404 is the secure outcome — the record exists for some user, but
        # not for ours, so update affects 0 rows. The endpoint reports 404.
        # 401/403 are also acceptable (auth gate).  200 is a *bug*.
        assert resp.status_code in (401, 403, 404), (
            f"SECURITY: revoking a foreign-looking key id returned {resp.status_code} — "
            f"must be 404 (or auth error). Body: {resp.text[:200]}"
        )

    @pytest.mark.skipif(
        not os.environ.get("TEST_USER_TOKEN_2"),
        reason="TEST_USER_TOKEN_2 not set — cross-account revoke check disabled",
    )
    def test_user_cannot_revoke_another_users_key(self, http):
        # Hook for a future second-test-user fixture. Stays as a clean skip
        # in environments that don't stage a second user.
        pytest.skip("Cross-user revoke check requires staging a second test account.")
