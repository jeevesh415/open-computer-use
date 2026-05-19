"""
Shared fixtures for the post-deployment suite.

IMPORTANT: this conftest is INTENTIONALLY ISOLATED from backend/tests/conftest.py.
That one mocks AWS, Supabase, and the HTTP layer — exactly the things we need
to exercise for real here.  Pytest resolves conftests bottom-up from each
test file's directory, so as long as this suite lives under tests/post_deploy/
it picks up only this file.

Design rules:
  * Every fixture that hits a remote service is `session` scoped — these
    tests share one HTTP session, one boto3 client, one Supabase session.
  * Every fixture that costs network work is cached with `functools.lru_cache`
    or `pytest.fixture(scope="session")` so the suite runs fast even when
    invoked with `-n auto`.
  * No test may leave state behind.  Any fixture that writes to Supabase
    yields the created row and deletes it in its teardown.
  * All env vars are resolved through `cfg()` so an accidental
    `os.environ["…"]` typo in a test surfaces as a missing-config error
    rather than a silent empty string.
"""
from __future__ import annotations

import os
import sys
import logging
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import pytest

# ── Load tests/post_deploy/.env early so `cfg()` calls see it ───────────────
try:
    from dotenv import load_dotenv
    _env_path = Path(__file__).parent / ".env"
    if _env_path.exists():
        load_dotenv(_env_path, override=False)
except ImportError:  # dotenv not installed → rely on real env
    pass


# ───────────────────────────────────────────────────────────────────────────
# Config resolution
# ───────────────────────────────────────────────────────────────────────────

@dataclass(frozen=True)
class Config:
    """
    Resolved config.  Fields split into two tiers:

      * "Always required" — cheap to get, present in any environment that can
        reach AWS at all.  Asserted eagerly at `cfg()` time so mistakes surface
        before the first test runs.
      * "Lazy required" — only needed by some markers (Supabase credentials
        are irrelevant for `-m infra`).  Stored as `""` when absent; fixtures
        that need them call `_must_have(...)` which raises a `pytest.skip`
        with a clear pointer to the env var to set.  This lets operators run
        a partial slice of the suite post-deploy without staging every secret.
    """
    aws_region: str
    aws_ecs_cluster: str
    project_name: str
    frontend_url: str
    backend_public_url: str
    supabase_url: str
    supabase_anon_key: str          # lazy
    test_user_email: str            # lazy
    test_user_password: str         # lazy
    internal_api_key: str | None    # always optional
    expect_https_443: bool
    expect_sidecar_removed: bool
    expect_three_service_split: bool
    log_lookback_minutes: int
    skip_slow: bool

    @property
    def ws_public_url(self) -> str:
        """`wss://` flavour of FRONTEND_URL for /api/electron/ws via Cloudflare."""
        return self.frontend_url.replace("https://", "wss://").replace("http://", "ws://")

    @property
    def ws_backend_direct_url(self) -> str:
        """`wss://` flavour of BACKEND_PUBLIC_URL for :8001 direct-ALB tests."""
        return self.backend_public_url.replace("https://", "wss://").replace("http://", "ws://")


def _required(key: str) -> str:
    """Fail the whole run if this env var is missing — for values we can't
    operate without regardless of which marker slice is selected."""
    val = os.environ.get(key, "").strip()
    if not val:
        pytest.exit(
            f"Missing required env var {key}. Copy tests/post_deploy/.env.example "
            f"to tests/post_deploy/.env and fill it in.",
            returncode=2,
        )
    return val


def _optional(key: str) -> str:
    """Returns the empty string when absent.  Pair with `_must_have` in the
    fixture that needs it so only the affected tests get skipped."""
    return os.environ.get(key, "").strip()


def _bool(key: str, default: str = "0") -> bool:
    return os.environ.get(key, default).strip() in ("1", "true", "True", "yes")


def _must_have(*keys: str) -> None:
    """Call from within a fixture.  Skips the test (with a precise pointer to
    the missing env var) if any listed key is empty.  Used for lazy-required
    fields like Supabase credentials."""
    missing = [k for k in keys if not os.environ.get(k, "").strip()]
    if missing:
        pytest.skip(
            f"Skipping: this test needs env var(s) {', '.join(missing)}. "
            f"Fill them in tests/post_deploy/.env to enable this slice."
        )


@lru_cache(maxsize=1)
def cfg() -> Config:
    """Resolved once per process; cached so every fixture sees the same values."""
    return Config(
        # Always required — these are cheap and needed by every marker slice.
        aws_region=_required("AWS_REGION"),
        aws_ecs_cluster=_required("AWS_ECS_CLUSTER"),
        project_name=_required("PROJECT_NAME"),
        frontend_url=_required("FRONTEND_URL").rstrip("/"),
        backend_public_url=_required("BACKEND_PUBLIC_URL").rstrip("/"),
        supabase_url=_required("SUPABASE_URL").rstrip("/"),
        # Lazy required — empty string when absent; fixtures call _must_have.
        supabase_anon_key=_optional("SUPABASE_ANON_KEY"),
        test_user_email=_optional("TEST_USER_EMAIL"),
        test_user_password=_optional("TEST_USER_PASSWORD"),
        internal_api_key=_optional("INTERNAL_API_KEY") or None,
        expect_https_443=_bool("EXPECT_HTTPS_443_LISTENER", "1"),
        expect_sidecar_removed=_bool("EXPECT_SIDECAR_REMOVED", "1"),
        expect_three_service_split=_bool("EXPECT_THREE_SERVICE_SPLIT", "1"),
        log_lookback_minutes=int(os.environ.get("LOG_LOOKBACK_MINUTES", "10")),
        skip_slow=_bool("SKIP_SLOW", "0"),
    )


# ───────────────────────────────────────────────────────────────────────────
# boto3 clients — one per AWS service, session-scoped
# ───────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def aws_region() -> str:
    return cfg().aws_region


@pytest.fixture(scope="session")
def ecs_client(aws_region: str):
    import boto3
    return boto3.client("ecs", region_name=aws_region)


@pytest.fixture(scope="session")
def elbv2_client(aws_region: str):
    import boto3
    return boto3.client("elbv2", region_name=aws_region)


@pytest.fixture(scope="session")
def ec2_client(aws_region: str):
    import boto3
    return boto3.client("ec2", region_name=aws_region)


@pytest.fixture(scope="session")
def logs_client(aws_region: str):
    import boto3
    return boto3.client("logs", region_name=aws_region)


@pytest.fixture(scope="session")
def acm_client(aws_region: str):
    import boto3
    return boto3.client("acm", region_name=aws_region)


# ───────────────────────────────────────────────────────────────────────────
# HTTP session — shared across tests for keep-alive + HTTP/2
# ───────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def http():
    """
    A single httpx.Client for the whole suite.

    Why session-scoped:
      * Cloudflare's edge rate-limits per-connection less aggressively when a
        single TCP/TLS connection is reused — a fresh connection per test
        occasionally triggers bot detection and returns HTML challenges that
        break everything downstream.
      * HTTP/2 multiplexing with one client is measurably faster in CI.

    Why `timeout=20`:
      * SSE streaming tests explicitly override to a longer timeout.
      * The default is generous enough for everything else including slow
        cold starts right after an ECS rolling deploy.
    """
    import httpx
    with httpx.Client(
        http2=True,
        timeout=httpx.Timeout(20.0, connect=10.0),
        follow_redirects=False,  # we want to assert on redirects ourselves
        # TLS verification intentionally disabled: BACKEND_PUBLIC_URL can
        # point at a direct ALB hostname (llmhub-alb-xxxx.<region>.elb.amazonaws.com)
        # whose certificate is for coasty.ai, not the ALB's auto-generated
        # DNS — so strict verification always fails.  We're post-deploy
        # smoke-testing our own infra; TLS-chain validity is not what this
        # suite is checking.  test_10_security.py exercises TLS separately
        # via openssl s_client against the Cloudflare hostname where the
        # cert CN is the real production concern.
        verify=False,
        headers={
            "User-Agent": "coasty-post-deploy/1.0 (pytest)",
            # Intentionally NOT requesting `br` (brotli): httpx only supports
            # brotli when the optional `brotli`/`brotlicffi` package is
            # installed.  Without it, a Cloudflare response encoded as brotli
            # comes back as raw bytes in resp.text — every HTML/JSON check
            # fails with gibberish.  Accepting only gzip guarantees httpx can
            # decompress every response; Cloudflare falls back to gzip
            # automatically.  If you install `brotli` in requirements.txt,
            # you can add "br" back here for a small bandwidth saving.
            "Accept-Encoding": "gzip, deflate",
        },
    ) as client:
        yield client


# ───────────────────────────────────────────────────────────────────────────
# Supabase / test user
# ───────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def supabase_client():
    """Anon Supabase client — tests that need RLS sign in as the test user.
    Skipped (not failed) when SUPABASE_ANON_KEY isn't configured, so infra-only
    runs don't need to stage the Supabase key at all."""
    _must_have("SUPABASE_ANON_KEY")
    from supabase import create_client
    return create_client(cfg().supabase_url, cfg().supabase_anon_key)


@pytest.fixture(scope="session")
def test_user_session(supabase_client):
    _must_have("TEST_USER_EMAIL", "TEST_USER_PASSWORD")
    """
    Sign the test user in once per suite and return the session.

    The returned object has `.access_token`, `.refresh_token`, `.user.id`.
    The suite stays at module-scope for this one sign-in — doing it per-test
    would rate-limit on Supabase's auth endpoint and slow the suite to a crawl.
    """
    auth = supabase_client.auth.sign_in_with_password(
        {"email": cfg().test_user_email, "password": cfg().test_user_password}
    )
    if not auth.session or not auth.user:
        pytest.exit(
            f"Could not sign in TEST_USER_EMAIL={cfg().test_user_email}. "
            f"Verify the account exists in the configured Supabase project "
            f"and the password is correct.",
            returncode=2,
        )
    yield auth.session
    # Session scope — sign-out on teardown so we don't leave long-lived tokens
    # in the Supabase refresh chain.
    try:
        supabase_client.auth.sign_out()
    except Exception:
        pass


@pytest.fixture(scope="session")
def test_jwt(test_user_session) -> str:
    """Just the access token — most tests only need this."""
    return test_user_session.access_token


@pytest.fixture(scope="session")
def test_user_id(test_user_session) -> str:
    return test_user_session.user.id


@pytest.fixture(scope="session")
def auth_headers(test_jwt: str) -> dict[str, str]:
    """Ready-to-use Authorization header block for Electron-style Bearer calls."""
    return {"Authorization": f"Bearer {test_jwt}"}


# ───────────────────────────────────────────────────────────────────────────
# Convenience: resolved expected names from Terraform project_name
# ───────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="session")
def expected_services() -> list[str]:
    """ECS service names terraform creates for the standard split deploy."""
    p = cfg().project_name
    return [f"{p}-service", f"{p}-api", f"{p}-sse", f"{p}-ws"]


@pytest.fixture(scope="session")
def expected_target_groups() -> dict[str, int]:
    """Expected TG names → listening port.  Includes all flag-gated TGs."""
    p = cfg().project_name
    tgs: dict[str, int] = {
        f"{p}-tg": 3000,           # frontend
        f"{p}-backend-tg": 8001,   # legacy sidecar (still exists as TG even after sidecar removal)
        f"{p}-api-tg": 8001,
        f"{p}-sse-tg": 8001,
        f"{p}-ws-tg": 8001,
    }
    if cfg().expect_sidecar_removed:
        tgs[f"{p}-int-api-tg"] = 8001
        tgs[f"{p}-int-sse-tg"] = 8001
        # int-ws-tg is explicitly NOT created (no listener rule for ws on internal ALB)
    return tgs


# ───────────────────────────────────────────────────────────────────────────
# Global skip logic for `slow` marker
# ───────────────────────────────────────────────────────────────────────────

def pytest_collection_modifyitems(config, items):
    """Honor SKIP_SLOW=1 globally."""
    if not cfg().skip_slow:
        return
    skip_slow = pytest.mark.skip(reason="SKIP_SLOW=1 set")
    for item in items:
        if "slow" in item.keywords:
            item.add_marker(skip_slow)


# ───────────────────────────────────────────────────────────────────────────
# Logging — quieter than default so CI logs are readable
# ───────────────────────────────────────────────────────────────────────────

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)
logging.getLogger("botocore").setLevel(logging.WARNING)
logging.getLogger("hpack").setLevel(logging.WARNING)


# ───────────────────────────────────────────────────────────────────────────
# Shared assertion helpers (imported via `from conftest import ...`)
# ───────────────────────────────────────────────────────────────────────────

def assert_status(resp, expected: int | tuple[int, ...]):
    """
    Pretty assertion that also surfaces the response body on failure.

    httpx's default `resp.raise_for_status()` only tells you the code;
    post-deploy debugging usually needs the body to spot things like a
    Cloudflare challenge page or a FastAPI error envelope.

    Streaming-safe: when the response was opened with `http.stream(...)`,
    `resp.text` raises `httpx.ResponseNotRead`.  We try to read whatever
    the server has already buffered; if even that fails we fall back to
    a placeholder.  Without this guard, the assertion's diagnostic step
    masks the real failure with a secondary `ResponseNotRead` exception
    (this hit `test_08_chat_post_via_cloudflare_sse_first_frame` and
    `test_09_chat_post_via_direct_backend_sse_first_frame`).
    """
    exp = (expected,) if isinstance(expected, int) else expected
    if resp.status_code not in exp:
        try:
            body = resp.text[:500] if resp.text else "<empty>"
        except Exception:
            # ResponseNotRead from streaming, or any encoding edge case.
            try:
                # Try to read whatever is buffered for streaming responses.
                resp.read()
                body = resp.text[:500] if resp.text else "<empty>"
            except Exception:
                body = "<streaming response — body could not be read>"
        raise AssertionError(
            f"Expected HTTP {exp}, got {resp.status_code} from "
            f"{resp.request.method} {resp.request.url}\nBody: {body}"
        )


def first_healthy_target(elbv2, tg_arn: str) -> str | None:
    """Return the private IP of the first healthy target in a TG, or None."""
    resp = elbv2.describe_target_health(TargetGroupArn=tg_arn)
    for t in resp.get("TargetHealthDescriptions", []):
        if t["TargetHealth"]["State"] == "healthy":
            return t["Target"]["Id"]
    return None


# ───────────────────────────────────────────────────────────────────────────
# Self-test hook — sanity check the fixtures themselves
# ───────────────────────────────────────────────────────────────────────────

def pytest_report_header(config):
    """Print the resolved config at the top of the run so readers know what we
    were actually targeting.  Credentials are NEVER printed — only targets."""
    c = cfg()
    return [
        "post-deploy suite:",
        f"  AWS region        : {c.aws_region}",
        f"  ECS cluster       : {c.aws_ecs_cluster}",
        f"  Project name      : {c.project_name}",
        f"  Frontend URL      : {c.frontend_url}",
        f"  Backend (:8001)   : {c.backend_public_url}",
        f"  Supabase URL      : {c.supabase_url}",
        f"  Expect HTTPS :443 : {c.expect_https_443}",
        f"  Sidecar removed   : {c.expect_sidecar_removed}",
        f"  Three-svc split   : {c.expect_three_service_split}",
        f"  Skip slow         : {c.skip_slow}",
    ]
