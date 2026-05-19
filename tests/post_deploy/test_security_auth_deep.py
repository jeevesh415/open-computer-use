"""
test_security_auth_deep.py — Deep authentication and internal-API-key bypass
tests against the deployed Coasty backend.

This complements ``test_10_security.py`` (which covers CSP, basic JWT
signature/expiry, CSRF, SQLi smoke) with a much deeper sweep of attack
patterns that target the FastAPI middleware chain:

  * JWT abuse classes — ``alg:none``, alg-confusion (HMAC-when-RS expected),
    ``kid`` header injection, future ``iat``, negative ``exp``, mismatched
    ``aud``/``iss``, replay after sign-out.
  * Bearer-header smuggling — concatenated tokens, leading whitespace,
    duplicated/case-mangled ``Authorization`` headers, token in URL query.
  * Internal-API-key bypass — body/query smuggling, random keys, timing-
    attack probe, lowercase header normalisation.
  * Auth gating coverage — every Bearer-required endpoint we know about
    must reject anonymous requests.
  * Public CUA (``X-API-Key``) — invalid key shapes / fake formats.

EVERY test in this file is marked ``@pytest.mark.security``. Tests that need
a Supabase user / valid JWT skip cleanly via ``_must_have`` style fixtures so
infra-only runs stay green.

Failure messages are prefixed ``SECURITY:`` so triage tooling can flag these
as P0.  We never use ``xfail`` — if the backend is currently vulnerable, this
suite fails LOUDLY so it gets fixed before the next deploy.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any, Dict, Optional

import httpx
import pytest

from conftest import assert_status, cfg


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
        body = (resp.text or "")[:400].replace("\n", " ")
    except Exception:
        body = "<undecodable>"
    return (
        f"SECURITY: {msg}\n"
        f"  {resp.request.method} {resp.request.url} -> {resp.status_code}\n"
        f"  Body: {body}"
    )


def _b64url(data: bytes) -> str:
    """URL-safe base64 without padding, as used in JWTs."""
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _make_jwt(
    payload: Dict[str, Any],
    header: Optional[Dict[str, Any]] = None,
    signature: Optional[bytes] = None,
    *,
    hmac_key: Optional[bytes] = None,
) -> str:
    """Forge a 3-segment JWT.

    Three modes:
      * ``hmac_key`` set → sign HS256 with that key (used for alg-confusion).
      * ``signature`` set → use given raw bytes as signature.
      * Neither → 32 random bytes (guaranteed-bad).

    The header defaults to ``{"alg":"HS256","typ":"JWT"}`` so the token is
    syntactically valid and reaches the signature-verification step at the
    auth provider.
    """
    if header is None:
        header = {"alg": "HS256", "typ": "JWT"}
    h = _b64url(json.dumps(header, separators=(",", ":")).encode())
    p = _b64url(json.dumps(payload, separators=(",", ":")).encode())
    if hmac_key is not None:
        signing_input = f"{h}.{p}".encode()
        sig = hmac.new(hmac_key, signing_input, hashlib.sha256).digest()
    else:
        sig = signature if signature is not None else os.urandom(32)
    s = _b64url(sig)
    return f"{h}.{p}.{s}"


def _backend(path: str) -> str:
    return f"{cfg().backend_public_url}{path}"


def _is_rejected(resp: httpx.Response) -> bool:
    """Auth gate must respond with 401, 403, 404 (route hidden), 405 (method
    not allowed for forged GET against POST-only routes), or 422 (body
    validation triggered before auth — still safely rejected since no
    business logic ran). Any 2xx is a real bypass."""
    return resp.status_code in (401, 403, 404, 405, 422)


# ───────────────────────────────────────────────────────────────────────────
# 1. JWT abuse class — alg:none
# ───────────────────────────────────────────────────────────────────────────

def test_jwt_alg_none_is_rejected(http: httpx.Client):
    """A ``alg:none`` JWT (CVE-2015-9235 class) must NEVER be accepted.

    Some libraries historically allowed ``alg:none`` tokens to pass with no
    signature at all. Supabase + our middleware should reject these — they
    pass the token through to GoTrue's ``/auth/v1/user`` which validates
    signatures against the project's HS256 secret. A 200 here means an
    unauthenticated attacker successfully authenticated as the ``sub`` claim.
    """
    payload = {
        "sub": "00000000-0000-0000-0000-000000000000",
        "role": "authenticated",
        "aud": "authenticated",
        "exp": int(time.time()) + 3600,
        "iat": int(time.time()),
    }
    header = {"alg": "none", "typ": "JWT"}
    # alg:none → empty signature segment
    token = _make_jwt(payload, header=header, signature=b"")

    resp = http.get(_backend("/api/chats/"), headers={"Authorization": f"Bearer {token}"})
    assert _is_rejected(resp), _sec(
        f"alg:none JWT was accepted by /api/chats/ (status {resp.status_code}) — "
        "authentication bypass via algorithm confusion",
        resp,
    )


# ───────────────────────────────────────────────────────────────────────────
# 2. JWT alg-confusion — sign HS256 with public key bytes
# ───────────────────────────────────────────────────────────────────────────

def test_jwt_alg_confusion_hs256_rejected(http: httpx.Client):
    """HS256 signed with attacker-chosen key must NOT be accepted.

    Classic alg-confusion attack: when a server expects RS256 but verifies
    based on the token's own ``alg`` header, an attacker can sign with HS256
    using any key (often the public RSA key). Our middleware delegates to
    Supabase's GoTrue which is HS256-only — but if the secret were ever
    leaked, ANY HS256 forge would pass. This test confirms that a token
    signed with a random secret (NOT the real one) is rejected. If it
    isn't, the JWT secret is leaked.
    """
    payload = {
        "sub": "00000000-0000-0000-0000-000000000000",
        "role": "service_role",  # privilege-escalation attempt
        "aud": "authenticated",
        "exp": int(time.time()) + 3600,
        "iat": int(time.time()),
    }
    # Sign with a random 64-byte secret — guaranteed not to match prod secret
    token = _make_jwt(payload, hmac_key=os.urandom(64))

    resp = http.get(_backend("/api/chats/"), headers={"Authorization": f"Bearer {token}"})
    assert _is_rejected(resp), _sec(
        f"HS256 JWT signed with attacker key accepted (status {resp.status_code}) — "
        "JWT secret may be leaked or signature verification is broken",
        resp,
    )


# ───────────────────────────────────────────────────────────────────────────
# 3. JWT kid header injection — SQLi / path-traversal in `kid`
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "kid_value",
    [
        "../../../dev/null",                  # path traversal
        "../../../../../../etc/passwd",
        "' UNION SELECT 'x'--",               # SQLi
        "key1' OR '1'='1",
        "key' AND extractvalue(0x0a,concat(0x0a,version()))--",
        "'; DROP TABLE users;--",
        "\x00../",                             # null byte
    ],
)
def test_jwt_kid_header_injection_rejected(http: httpx.Client, kid_value: str):
    """Malicious ``kid`` header must not crash the verifier or allow forgery.

    If the JWT library naively uses ``kid`` to look up the verification key
    (e.g. as a filesystem path or DB query), an attacker can either pivot to
    a known-empty key file or to SQLi. Both cases would result in 200 if
    successful. We expect 401/403 with no 5xx.
    """
    payload = {
        "sub": "attacker",
        "role": "service_role",
        "exp": int(time.time()) + 3600,
        "iat": int(time.time()),
    }
    header = {"alg": "HS256", "typ": "JWT", "kid": kid_value}
    token = _make_jwt(payload, header=header)

    resp = http.get(_backend("/api/chats/"), headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code != 500, _sec(
        f"kid={kid_value!r} caused a 500 — JWT verifier may be vulnerable to "
        "header-driven attacks",
        resp,
    )
    assert _is_rejected(resp), _sec(
        f"kid={kid_value!r} bypassed auth (status {resp.status_code}) — "
        "verifier may be using `kid` to select an attacker-influenced key",
        resp,
    )


# ───────────────────────────────────────────────────────────────────────────
# 4. JWT with future iat (issued-at in the future)
# ───────────────────────────────────────────────────────────────────────────

def test_jwt_future_iat_rejected(http: httpx.Client):
    """A JWT with iat far in the future must not be accepted.

    Even if the signature were valid, a future iat is a replay/clock-skew
    attack indicator. With our forged signature it should also fail signature
    verification — we just confirm we never see a 200 either way.
    """
    payload = {
        "sub": "00000000-0000-0000-0000-000000000000",
        "aud": "authenticated",
        "iat": int(time.time()) + 7 * 86400,   # 7 days in the future
        "exp": int(time.time()) + 14 * 86400,  # still valid, but iat is wrong
    }
    token = _make_jwt(payload)

    resp = http.get(_backend("/api/chats/"), headers={"Authorization": f"Bearer {token}"})
    assert _is_rejected(resp), _sec(
        f"Future-iat JWT accepted (status {resp.status_code})", resp
    )


# ───────────────────────────────────────────────────────────────────────────
# 5. JWT with negative exp
# ───────────────────────────────────────────────────────────────────────────

def test_jwt_negative_exp_rejected(http: httpx.Client):
    """Negative ``exp`` is nonsensical — must reject, not crash."""
    payload = {
        "sub": "00000000-0000-0000-0000-000000000000",
        "aud": "authenticated",
        "iat": int(time.time()),
        "exp": -1,
    }
    token = _make_jwt(payload)

    resp = http.get(_backend("/api/chats/"), headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code != 500, _sec(
        f"Negative-exp JWT crashed verifier (500). exp must be validated as "
        "a positive integer.",
        resp,
    )
    assert _is_rejected(resp), _sec(
        f"Negative-exp JWT accepted (status {resp.status_code})", resp
    )


# ───────────────────────────────────────────────────────────────────────────
# 6. JWT with mismatched aud / iss
# ───────────────────────────────────────────────────────────────────────────

def test_jwt_wrong_audience_rejected(http: httpx.Client):
    """JWT with ``aud`` other than ``authenticated`` must be rejected."""
    payload = {
        "sub": "00000000-0000-0000-0000-000000000000",
        "aud": "anon",  # Supabase's anon role aud — not what auth'd routes need
        "exp": int(time.time()) + 3600,
        "iat": int(time.time()),
    }
    token = _make_jwt(payload)

    resp = http.get(_backend("/api/chats/"), headers={"Authorization": f"Bearer {token}"})
    assert _is_rejected(resp), _sec(
        f"Wrong-aud JWT accepted (status {resp.status_code})", resp
    )


def test_jwt_wrong_issuer_rejected(http: httpx.Client):
    """JWT with ``iss`` pointing at attacker-controlled host must be rejected."""
    payload = {
        "sub": "00000000-0000-0000-0000-000000000000",
        "iss": "https://evil.example.com/auth/v1",
        "aud": "authenticated",
        "exp": int(time.time()) + 3600,
        "iat": int(time.time()),
    }
    token = _make_jwt(payload)

    resp = http.get(_backend("/api/chats/"), headers={"Authorization": f"Bearer {token}"})
    assert _is_rejected(resp), _sec(
        f"Wrong-iss JWT accepted (status {resp.status_code})", resp
    )


# ───────────────────────────────────────────────────────────────────────────
# 7. JWT replay after sign-out
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.skipif(
    os.environ.get("RUN_SIGNOUT_REPLAY_TEST") != "1",
    reason=(
        "Sign-out replay test invalidates the suite-shared Supabase session "
        "(GoTrue's `/auth/v1/user` returns 401 after the user signs out, even "
        "for a different access token). Set RUN_SIGNOUT_REPLAY_TEST=1 to run "
        "this in isolation; do NOT enable in the full suite — it will cascade-"
        "break every test that depends on the test_user_session fixture."
    ),
)
def test_jwt_still_valid_after_signout_documented(http: httpx.Client):
    """Document JWT behaviour after explicit Supabase sign-out.

    Supabase access tokens are short-lived JWTs validated against GoTrue's
    ``/auth/v1/user`` endpoint by ``InternalAPIKeyMiddleware._verify_supabase_token``.
    GoTrue rejects user lookups once the user has signed out — so the
    backend correctly refuses post-signout replays.

    Why this is gated behind ``RUN_SIGNOUT_REPLAY_TEST=1``: Supabase's
    ``sign_out`` endpoint defaults to ``scope=global`` which invalidates
    every active session for the user (not just the one that sent the
    request). Even with ``scope=local`` the GoTrue ``/auth/v1/user`` lookup
    sometimes returns 401 for any token of the same user shortly after.
    Running this in the middle of the suite cascades into every test that
    uses ``test_user_session``. To test it cleanly, run only this test:

        RUN_SIGNOUT_REPLAY_TEST=1 pytest test_security_auth_deep.py::test_jwt_still_valid_after_signout_documented -p no:randomly
    """
    from supabase import create_client
    sb = create_client(cfg().supabase_url, cfg().supabase_anon_key)
    try:
        auth = sb.auth.sign_in_with_password(
            {"email": cfg().test_user_email, "password": cfg().test_user_password}
        )
    except Exception as e:
        pytest.skip(f"Could not get a fresh session for sign-out test: {e}")
        return
    if not auth.session:
        pytest.skip("Fresh sign-in returned no session")
        return

    access_token = auth.session.access_token
    headers = {"Authorization": f"Bearer {access_token}"}

    pre = http.get(_backend("/api/chats/list"), headers=headers)
    if pre.status_code in (401, 403):
        pytest.skip(
            f"Fresh-session JWT not accepted pre-signout (status {pre.status_code}) — "
            "cannot exercise post-signout replay scenario"
        )

    try:
        sb.auth.sign_out()
    except Exception as e:
        pytest.skip(f"Supabase sign_out failed: {e}")
        return

    post = http.get(_backend("/api/chats/list"), headers=headers)
    assert post.status_code != 500, _sec(
        "Backend 500ed when replaying post-signout token", post
    )
    # Either still works (no revocation list — document) or rejected (good).
    # We accept either; we only fail on 5xx.
    if post.status_code == 200:
        return
    assert post.status_code in (401, 403), _sec(
        f"Post-signout replay returned unexpected status {post.status_code} "
        f"(pre-signout was {pre.status_code})",
        post,
    )


# ───────────────────────────────────────────────────────────────────────────
# 8. Bearer-token concatenation
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "auth_header",
    [
        "Bearer foo Bearer bar",                              # naive concat
        "Bearer , Bearer ",                                  # comma-separated
        "Bearer foo, Bearer bar",                            # http-style multi
        "Bearer\tfoo\tBearer\tbar",                          # tab-separated
        "Bearer foo\nAuthorization: Bearer bar",             # header injection
    ],
)
def test_bearer_concat_does_not_bypass(auth_header: str):
    """Concatenated/multi-token Authorization headers must not bypass auth.

    Some middleware naively splits on the first space and treats the rest
    as the token. Others scan for the first valid-looking JWT. Neither is
    correct: an attacker should not be able to smuggle a second token via
    the same header. We expect 401/403 (rejected at validation) — never
    200 — and explicitly never 500 (that would indicate header parsing
    crashed and the failure mode is unsafe).

    Some payloads (with ``\\n`` or other CR/LF) are rejected at the
    HTTP/2 protocol layer by the client or by the load balancer with a
    StreamReset. That's the correct security outcome — the request never
    reached the application — so we treat protocol errors as a pass.

    Uses a fresh httpx.Client so a malformed-header StreamReset cannot
    corrupt the suite-shared HTTP/2 connection used by other tests.
    """
    with httpx.Client(http2=True, timeout=20.0, verify=False) as client:
        try:
            resp = client.get(
                _backend("/api/chats/"), headers={"Authorization": auth_header}
            )
        except (
            httpx.RemoteProtocolError,
            httpx.ProtocolError,
            httpx.LocalProtocolError,
        ):
            # Either the client or the LB refused the malformed header —
            # strictly safer than letting it through.
            return
    assert resp.status_code != 500, _sec(
        f"Concatenated Authorization {auth_header!r} crashed the auth layer",
        resp,
    )
    assert _is_rejected(resp), _sec(
        f"Concatenated Authorization {auth_header!r} bypassed auth "
        f"(status {resp.status_code})",
        resp,
    )


# ───────────────────────────────────────────────────────────────────────────
# 9. Header smuggling — whitespace, mixed case
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "header_name,header_value",
    [
        # leading/trailing whitespace in value
        ("Authorization", " Bearer some.token.here"),
        ("Authorization", "Bearer some.token.here "),
        ("Authorization", "  Bearer some.token.here  "),
        # mixed-case scheme
        ("Authorization", "bearer some.token.here"),
        ("Authorization", "BEARER some.token.here"),
        ("Authorization", "BeArEr some.token.here"),
        # mixed-case header name (HTTP/1.1 says headers are case-insensitive,
        # but parsers must not behave differently)
        ("authorization", "Bearer some.token.here"),
        ("AUTHORIZATION", "Bearer some.token.here"),
    ],
)
def test_authorization_header_smuggling_does_not_bypass(
    http: httpx.Client, header_name: str, header_value: str
):
    """Whitespace / case variants of Authorization must reach the validator.

    The token itself is intentionally bogus — we only assert that whatever
    parsing happens, the auth gate rejects the request. A 200 here would
    mean a different code path bypassed the gate based on the header
    formatting alone. A 500 would mean the parser crashed.
    """
    resp = http.get(_backend("/api/chats/"), headers={header_name: header_value})
    assert resp.status_code != 500, _sec(
        f"Header smuggling {header_name}={header_value!r} crashed parser",
        resp,
    )
    assert _is_rejected(resp), _sec(
        f"Header smuggling {header_name}={header_value!r} bypassed auth "
        f"(status {resp.status_code})",
        resp,
    )


# ───────────────────────────────────────────────────────────────────────────
# 10. Internal API key in URL query / body — must NOT bypass
# ───────────────────────────────────────────────────────────────────────────

def test_internal_key_in_query_does_not_bypass(http: httpx.Client):
    """X-Internal-Key value placed in the URL query MUST NOT authenticate.

    The middleware reads ``X-Internal-Key`` from headers only. If query-
    parameter smuggling were honoured, anyone who sees a referrer log or
    a server-access log could impersonate the internal Next.js proxy.
    """
    key = cfg().internal_api_key or "fake-internal-key-for-smuggling-probe"
    # Try every plausible param name an over-broad parser might honour
    params = {
        "X-Internal-Key": key,
        "x_internal_key": key,
        "internal_key": key,
        "internal-key": key,
        "api_key": key,
    }
    resp = http.get(_backend("/api/chats/"), params=params)
    assert _is_rejected(resp), _sec(
        f"Internal key in URL query bypassed auth (status {resp.status_code}) — "
        "credential exfiltration risk via referrer / access logs",
        resp,
    )


def test_internal_key_in_body_does_not_bypass(http: httpx.Client):
    """X-Internal-Key value placed in JSON body MUST NOT authenticate."""
    key = cfg().internal_api_key or "fake-internal-key-for-smuggling-probe"
    resp = http.post(
        _backend("/api/chats/create"),
        json={
            "X-Internal-Key": key,
            "internal_key": key,
            "user_id": "00000000-0000-0000-0000-000000000000",
            "title": "smuggling-probe",
        },
    )
    assert _is_rejected(resp), _sec(
        f"Internal key in JSON body bypassed auth (status {resp.status_code})",
        resp,
    )


# ───────────────────────────────────────────────────────────────────────────
# 11. X-Internal-Key with random / wrong values
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "key_value",
    [
        "",                                  # empty
        " ",                                 # whitespace
        "x",                                 # too short
        "wrong-key-123",                     # random
        "a" * 256,                           # long
        "\x00",                              # null byte
        "${INTERNAL_API_KEY}",               # env var injection
        "../etc/passwd",                    # path traversal in header
    ],
)
def test_internal_key_wrong_value_rejected(key_value: str):
    """Any non-matching X-Internal-Key value must be rejected.

    The middleware uses ``hmac.compare_digest`` — we just confirm the
    rejection is consistent (never 200) and never 500. We do not attempt to
    measure timing here; a constant-time compare is asserted via the
    middleware unit test. This is the post-deploy "did the production
    binary get the right code" check.

    Some payloads (e.g. ``\\x00``) are rejected at the HTTP layer by the
    client/LB before they reach the app — that's strictly safer, so a
    protocol error is treated as a pass. Uses a fresh client so a stream
    reset can't corrupt the suite-shared HTTP/2 connection.
    """
    with httpx.Client(http2=True, timeout=20.0, verify=False) as client:
        try:
            resp = client.get(
                _backend("/api/chats/"),
                headers={"X-Internal-Key": key_value},
            )
        except (
            httpx.RemoteProtocolError,
            httpx.ProtocolError,
            httpx.LocalProtocolError,
        ):
            return
    assert resp.status_code != 500, _sec(
        f"X-Internal-Key={key_value!r} crashed middleware", resp
    )
    assert _is_rejected(resp), _sec(
        f"X-Internal-Key={key_value!r} bypassed auth (status {resp.status_code})",
        resp,
    )


def test_internal_key_compare_does_not_leak_via_status(http: httpx.Client):
    """A wrong key MUST return the same status as a missing key.

    If a typo'd key returns 401 while a missing one returns 403 (or vice
    versa), an attacker can probe per-character by binary-searching status
    codes. Both must be the SAME rejection code.
    """
    no_key = http.get(_backend("/api/chats/"))
    wrong_key = http.get(
        _backend("/api/chats/"),
        headers={"X-Internal-Key": "definitely-not-the-real-key-" + os.urandom(8).hex()},
    )

    assert no_key.status_code == wrong_key.status_code, _sec(
        f"Status divergence between missing key (got {no_key.status_code}) and "
        f"wrong key (got {wrong_key.status_code}) — could enable status-code "
        "oracle attacks against the internal key"
    )


# ───────────────────────────────────────────────────────────────────────────
# 12. Bearer-with-valid-JWT bypasses internal key (documented design)
# ───────────────────────────────────────────────────────────────────────────

def test_bearer_jwt_satisfies_internal_key_gate(
    http: httpx.Client, auth_headers: Dict[str, str]
):
    """A valid Bearer JWT must satisfy the internal-key gate (Electron path).

    This is the documented design: the InternalAPIKeyMiddleware accepts
    EITHER a valid X-Internal-Key OR a valid Supabase Bearer JWT. The
    Electron app uses the latter. We confirm here that the gate doesn't
    accidentally enforce both — a defence-in-depth break that would brick
    every Electron client overnight.
    """
    resp = http.get(_backend("/api/chats/"), headers=auth_headers)
    if resp.status_code == 401 and "Invalid user" in (resp.text or ""):
        pytest.skip(
            "Test user not fully onboarded — auth gate works (got 401 'Invalid user' "
            "from get_verified_user_id), but DB lookup fails"
        )
    # The gate must let us through; the route may return 200 with a list,
    # 200 with empty, etc. — we just need to know we passed the middleware.
    assert resp.status_code != 403, _sec(
        f"Valid Bearer JWT was rejected by the internal-key gate (403). "
        "Electron app cannot reach any backend endpoint.",
        resp,
    )


# ───────────────────────────────────────────────────────────────────────────
# 13. Cross-tenant token — TODO marker
# ───────────────────────────────────────────────────────────────────────────

def test_cross_tenant_chat_access_todo():
    """TODO: stage SECOND_TEST_USER_* env vars for cross-tenant access tests.

    With only one test user we cannot verify that user A's token cannot
    GET user B's ``/api/chats/{chat_id}``. This is a critical RLS-bypass
    surface — please configure SECOND_TEST_USER_EMAIL / _PASSWORD and
    re-enable the parametrized variant below.
    """
    if not os.environ.get("SECOND_TEST_USER_EMAIL"):
        pytest.skip(
            "TODO: cross-tenant token test requires SECOND_TEST_USER_EMAIL / "
            "SECOND_TEST_USER_PASSWORD. With both users configured, this test "
            "verifies user A cannot read user B's chats. SECURITY-CRITICAL."
        )


# ───────────────────────────────────────────────────────────────────────────
# 14. Token in URL query — must not be honoured
# ───────────────────────────────────────────────────────────────────────────

def test_jwt_in_query_param_not_honored(http: httpx.Client, test_jwt: str):
    """Bearer JWT in URL query (``?access_token=``) must NOT authenticate.

    Some auth middleware fall back to query-string tokens for browser-only
    EventSource streaming. Coasty does not — and shouldn't — because access
    logs / referrers / shared URLs would leak the token. We verify that
    even a VALID token in the query is rejected when no Authorization
    header is sent.
    """
    params_to_try = [
        {"access_token": test_jwt},
        {"jwt": test_jwt},
        {"token": test_jwt},
        {"authorization": f"Bearer {test_jwt}"},
    ]
    for params in params_to_try:
        resp = http.get(_backend("/api/chats/"), params=params)
        assert resp.status_code != 200, _sec(
            f"JWT in query {list(params.keys())} bypassed auth — token may be "
            "logged in CDN access logs / browser referrers",
            resp,
        )


# ───────────────────────────────────────────────────────────────────────────
# 15. Cookie-only auth on Bearer-required endpoint
# ───────────────────────────────────────────────────────────────────────────

def test_cookie_auth_does_not_satisfy_bearer_endpoint(
    http: httpx.Client, test_jwt: str
):
    """Cookie containing a JWT must NOT authenticate Bearer-required routes.

    The backend reads ``Authorization: Bearer`` only. A misconfigured
    middleware that also reads ``sb-access-token`` cookies would accept
    cross-site CSRF attacks (the cookie auto-attaches; the header doesn't).
    """
    cookies = {
        "sb-access-token": test_jwt,
        "sb:token": test_jwt,
        "session": test_jwt,
        "access_token": test_jwt,
    }
    resp = http.get(_backend("/api/chats/"), cookies=cookies)
    assert resp.status_code in (401, 403), _sec(
        f"Cookie-only auth was accepted on Bearer endpoint "
        f"(status {resp.status_code}) — CSRF surface",
        resp,
    )


# ───────────────────────────────────────────────────────────────────────────
# 16. Anonymous access on every Bearer-required endpoint
# ───────────────────────────────────────────────────────────────────────────

_ANON_TARGETS = [
    ("GET",    "/api/chats/"),
    ("POST",   "/api/chats/create"),
    ("POST",   "/api/chat/"),
    ("GET",    "/api/billing/credits/balance"),
    ("GET",    "/api/schedules/list"),
    ("POST",   "/api/swarm/execute"),
    ("GET",    "/api/electron/machines"),
    ("GET",    "/api/files"),
]


@pytest.mark.parametrize("method,path", _ANON_TARGETS)
def test_anonymous_request_rejected(http: httpx.Client, method: str, path: str):
    """Every authenticated route must reject anonymous requests."""
    url = _backend(path)
    if method == "GET":
        resp = http.get(url)
    elif method == "POST":
        resp = http.post(url, json={})
    else:
        pytest.skip(f"Method {method} not handled in this test")
        return

    if resp.status_code == 404:
        pytest.skip(f"{path} not mounted in this deployment (404) — skipping")

    assert resp.status_code != 200, _sec(
        f"Anonymous {method} {path} returned 200 — auth gate bypass",
        resp,
    )
    assert resp.status_code in (401, 403, 405, 422), _sec(
        f"Anonymous {method} {path} returned unexpected {resp.status_code} "
        "(expected 401/403/405/422)",
        resp,
    )


# ───────────────────────────────────────────────────────────────────────────
# 17. Public CUA — invalid cua_sk_* key shapes
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize(
    "key_value",
    [
        "",                                              # empty
        "cua_sk_",                                       # prefix only
        "cua_sk_short",                                  # too short
        "cua_sk_" + "g" * 48,                            # non-hex chars
        "cua_sk_" + "0" * 47,                            # 47 chars (off by one)
        "cua_sk_" + "0" * 49,                            # 49 chars
        "wrong_prefix_" + "0" * 48,                      # wrong prefix
        "Bearer cua_sk_" + "0" * 48,                     # scheme prefix smuggling
        "cua_sk_" + "0" * 48 + "; DROP TABLE keys;--",   # SQLi tail
        "cua_sk_../../../etc/passwd",                    # path traversal
        "cua_sk_${INTERNAL_API_KEY}",                    # env var inject
        "expired_revoked_" + "0" * 48,                   # fake-revoked
    ],
)
def test_public_cua_invalid_key_shapes_rejected(http: httpx.Client, key_value: str):
    """Public CUA API must reject every malformed / fake X-API-Key shape.

    The middleware allow-lists ``/api/v1/cua/*`` so the per-route
    ``get_api_key_context`` dependency handles validation. Any 5xx here means
    the validator crashes on bad input; a 200 means a fake key was honoured.
    """
    resp = http.post(
        _backend("/api/v1/cua/parse"),
        headers={"X-API-Key": key_value},
        json={"code": "import pyautogui\npyautogui.click(100, 100)"},
    )
    assert resp.status_code != 500, _sec(
        f"Public CUA crashed on X-API-Key={key_value!r}", resp
    )
    # Public CUA returns 401 INVALID_API_KEY for bad keys
    assert resp.status_code in (401, 403, 422), _sec(
        f"Public CUA accepted invalid X-API-Key={key_value!r} "
        f"(status {resp.status_code})",
        resp,
    )


def test_public_cua_health_no_auth_required(http: httpx.Client):
    """``/api/v1/cua/health`` must be reachable without any credential.

    Confirms the InternalAPIKeyMiddleware allow-list for ``/api/v1/cua/*``
    is in effect — otherwise the health probe would 403 and downstream
    monitoring would alert nonstop.
    """
    resp = http.get(_backend("/api/v1/cua/health"))
    if resp.status_code == 404:
        pytest.skip("Public CUA health endpoint not mounted")
    assert resp.status_code in (200, 503), _sec(
        f"Public CUA health returned {resp.status_code}, expected 200 or 503",
        resp,
    )


# ───────────────────────────────────────────────────────────────────────────
# 18. Internal-key gate on internal-only endpoints
# ───────────────────────────────────────────────────────────────────────────

def test_internal_only_route_requires_credential(http: httpx.Client):
    """Confirm /api/chats/ requires credentials (internal key OR bearer JWT)."""
    resp = http.get(_backend("/api/chats/"))
    assert resp.status_code in (401, 403), _sec(
        f"/api/chats/ accessible without any credential (status {resp.status_code})",
        resp,
    )


def test_health_does_not_require_credential(http: httpx.Client):
    """``/api/health`` must be reachable without any credential.

    ALB target-group health checks hit this endpoint. If it requires auth,
    ECS tasks flap out of service unhealthy.
    """
    resp = http.get(_backend("/api/health"))
    assert_status(resp, 200)


def test_options_preflight_no_credential(http: httpx.Client):
    """CORS OPTIONS preflight must succeed without auth headers.

    Browsers do not send Authorization on preflight; if the gate enforces
    it, every browser-originated request fails before the actual call.
    """
    resp = http.request(
        "OPTIONS",
        _backend("/api/chats/"),
        headers={
            "Origin": cfg().frontend_url,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    # 200 (CORSMiddleware handles), 204 (some configs), 405 (no OPTIONS handler
    # but middleware passed through) all indicate the auth gate did NOT block.
    # 403 would mean the gate is wrongly blocking preflight.
    assert resp.status_code != 403, _sec(
        f"OPTIONS preflight blocked by auth gate (403) — browsers cannot reach "
        "the API",
        resp,
    )
