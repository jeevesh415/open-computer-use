"""
test_13_google_search_key.py — keep `GOOGLE_SEARCH_KEY` from silently expiring
in production.

Why this file exists
====================
On 2026-04-28 the production `GOOGLE_SEARCH_KEY` was found expired with the
following symptom:
  * `app.services.search` returned `[]` for every CUA `web_search` call
    (silently — only an ERROR log line in CloudWatch).
  * Every `agent.web_search("…")` action injected `[WEB SEARCH: …]\nNo results
    found.` into `grounding_agent.notes`, so the LLM thought the topic had no
    results on the web.
  * The auto-blog daily 04:00 UTC cron published 1/10 posts because Claude
    couldn't synthesise text without search context.
  * No alarm, no ticket, no UI signal — only the eventual user-visible
    degradation alerted us.

This suite hits Google's API once per run with the key that production is
ACTUALLY using, and fails if Google rejects it.  The test is read-only against
both prod (just describes task defs) and Google (one cheap search query =
1/100 of the free daily quota).  Cost: trivial.

What this file checks
=====================
  1. The configured key is well-formed (`AIzaSy...`, 39 chars).
  2. The configured CX is well-formed (16-hex-char Programmable Search Engine ID).
  3. The key + CX combination is accepted by Google's Custom Search API
     (HTTP 200, items array present).  This is the regression-killer assertion —
     if the key has been revoked / expired / quota-exhausted / wrong-project,
     this assertion fails with a precise message naming the failure mode.
  4. Every backend ECS task definition (`api`, `sse`, `ws`) has the SAME key
     value as `infra/aws/terraform.tfvars`.  Catches the "rotated locally but
     forgot to terraform apply" footgun.
  5. The frontend ECS task definition has it too (used by the Next.js
     `/api/search` SSR route — see `lib/server/google-search.ts:27`).
  6. Backend-vs-frontend env var consistency: both surfaces should resolve to
     the same key.  Two different keys mean half the system silently uses a
     stale value.

What this file deliberately doesn't check
=========================================
  * The Programmable Search Engine's content config (sites included, image
    search on/off, safe-search level).  That's a CSE console concern, not
    something a key-rotation test should care about.
  * The number of queries we have left in the daily quota.  Custom Search
    doesn't expose remaining quota via API; we'd have to scrape the GCP
    console — not in scope.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import httpx
import pytest

from conftest import cfg


# ── Markers ────────────────────────────────────────────────────────────────
pytestmark = [pytest.mark.infra, pytest.mark.security]


# ── Constants & helpers ────────────────────────────────────────────────────

# AIzaSy<32 base64-url chars> = 39 chars total — Google's standard format.
# Documented at https://cloud.google.com/docs/authentication/api-keys#api_key_format
_API_KEY_RE = re.compile(r"^AIzaSy[A-Za-z0-9_\-]{33}$")

# Programmable Search Engine ID is 16 hex chars (newer engines may include `:`
# for legacy compat, e.g. `001234567890:abcdef1234`).  Accept both shapes.
_CX_RE = re.compile(r"^[0-9a-f]{16,17}$|^[0-9]+:[0-9a-z]+$")

# Tfvars file that holds the production key.
_TFVARS = Path(__file__).resolve().parents[2] / "infra" / "aws" / "terraform.tfvars"


def _read_tfvars_key_cx() -> tuple[str, str]:
    """
    Extract `GOOGLE_SEARCH_KEY` and `GOOGLE_SEARCH_CX` from terraform.tfvars.

    The file is gitignored and contains real production secrets.  We only
    read it from the local checkout (never echo'd to logs) and only inside
    this test module.  Both vars appear twice in tfvars (once in
    `frontend_env_vars`, once in `backend_env_vars`); we read the first
    occurrence and assert later that they match.
    """
    if not _TFVARS.exists():
        pytest.skip(
            f"{_TFVARS} not present in this checkout — running outside the "
            f"infra repo or the tfvars file hasn't been provisioned. "
            f"This test is a no-op without it."
        )
    text = _TFVARS.read_text(encoding="utf-8")
    key_m = re.search(r'GOOGLE_SEARCH_KEY\s*=\s*"([^"]+)"', text)
    cx_m = re.search(r'GOOGLE_SEARCH_CX\s*=\s*"([^"]+)"', text)
    if not key_m or not cx_m:
        pytest.fail(
            f"GOOGLE_SEARCH_KEY/CX not found in {_TFVARS}. "
            f"Both env vars must appear in `frontend_env_vars` and "
            f"`backend_env_vars` blocks."
        )
    return key_m.group(1), cx_m.group(1)


def _all_tfvars_key_cx_pairs() -> list[tuple[str, str, int]]:
    """Return EVERY `(key, cx, line_no)` pair in tfvars — used to assert that
    `frontend_env_vars` and `backend_env_vars` have the same value."""
    if not _TFVARS.exists():
        return []
    pairs = []
    text = _TFVARS.read_text(encoding="utf-8").splitlines()
    current_key = None
    for i, line in enumerate(text, 1):
        km = re.search(r'GOOGLE_SEARCH_KEY\s*=\s*"([^"]+)"', line)
        if km:
            current_key = (km.group(1), i)
            continue
        cm = re.search(r'GOOGLE_SEARCH_CX\s*=\s*"([^"]+)"', line)
        if cm and current_key is not None:
            pairs.append((current_key[0], cm.group(1), current_key[1]))
            current_key = None
    return pairs


def _redact(secret: str, head: int = 6, tail: int = 4) -> str:
    """Return a fingerprint-safe form of a secret for failure messages."""
    if not secret:
        return "<empty>"
    if len(secret) <= head + tail + 3:
        return "<too-short-to-redact>"
    return f"{secret[:head]}…{secret[-tail:]} (len={len(secret)})"


# ── Tests ──────────────────────────────────────────────────────────────────

def test_tfvars_key_format():
    """Tfvars contains a key that matches Google's API-key format.

    A malformed key can't be the result of a rotation typo (would have caught
    it in tf-validate), but covers paste mishaps and template artifacts like
    `GOOGLE_SEARCH_KEY="your-google-search-key"`.
    """
    key, _ = _read_tfvars_key_cx()
    assert _API_KEY_RE.match(key), (
        f"Key in {_TFVARS} doesn't match Google's `AIzaSy<33chars>` format: "
        f"{_redact(key)}.  If you've JUST rotated, check that you copied the "
        f"full value (39 chars) from the Cloud Console row."
    )


def test_tfvars_cx_format():
    """Tfvars contains a Programmable Search Engine ID that looks valid."""
    _, cx = _read_tfvars_key_cx()
    assert _CX_RE.match(cx), (
        f"CX in {_TFVARS} doesn't match Programmable Search Engine ID format: "
        f"{cx!r}.  Newer engines are 16 hex chars (e.g. c3ac802e5c9714b20); "
        f"legacy ones are `<numeric>:<alphanumeric>`."
    )


def test_tfvars_key_consistent_across_env_var_blocks():
    """frontend_env_vars and backend_env_vars must use the same key.

    Two different keys means the Next.js `/api/search` route uses one value
    and the Python backend uses another — silent half-broken state.  Same
    rule for CX (rare to differ but trivially asserted here).
    """
    pairs = _all_tfvars_key_cx_pairs()
    if len(pairs) < 2:
        pytest.skip(
            f"Expected >=2 (key, cx) pairs in {_TFVARS} (one per env_vars "
            f"block).  Got {len(pairs)}.  Either tfvars structure changed or "
            f"only one block declares Google credentials."
        )
    keys = {p[0] for p in pairs}
    cxs = {p[1] for p in pairs}
    assert len(keys) == 1, (
        f"GOOGLE_SEARCH_KEY values disagree across env_vars blocks "
        f"(lines: {[p[2] for p in pairs]}).  All occurrences must match — "
        f"one half of production will use a stale value otherwise."
    )
    assert len(cxs) == 1, (
        f"GOOGLE_SEARCH_CX values disagree across env_vars blocks "
        f"(lines: {[p[2] for p in pairs]})."
    )


@pytest.mark.slow
def test_tfvars_key_is_accepted_by_google():
    """THE assertion that catches expiration.

    Sends ONE search request to Google Custom Search.  Costs 1/100 of the
    free-tier daily quota.  Asserts:
      * HTTP 200
      * No `error` field in the body
      * `items` array is present (may be 0-length for unusual queries; we use
        `python` which reliably returns results)

    On failure the assertion message names the EXACT failure mode (expired,
    revoked, daily-limit-exceeded, key-restriction-violation, CX-invalid)
    so the responder doesn't have to read the request log.
    """
    key, cx = _read_tfvars_key_cx()

    with httpx.Client(timeout=httpx.Timeout(10.0, connect=5.0)) as client:
        resp = client.get(
            "https://customsearch.googleapis.com/customsearch/v1",
            params={
                "key": key,
                "cx": cx,
                "q": "python",
                "num": 1,
                # Region/safesearch defaults to keep the test reproducible.
                "gl": "us",
                "hl": "en",
                "safe": "active",
            },
        )

    if resp.status_code == 200:
        body = resp.json()
        assert "error" not in body, (
            f"Google returned 200 OK but with an error body: {body.get('error')}.  "
            f"This shouldn't happen — investigate."
        )
        items = body.get("items", [])
        # `items` can legitimately be empty for an obscure query, but `python`
        # has 351M+ results — empty here means CSE config is broken.
        assert items, (
            f"Google returned 200 but ZERO items for query='python'.  This "
            f"means the Programmable Search Engine ({cx}) is misconfigured "
            f"— most likely sites are restricted away from python.org or "
            f"safesearch is rejecting all results.  Visit "
            f"https://programmablesearchengine.google.com/ → your engine → "
            f"Setup → 'Sites to search' to verify."
        )
        return

    # Non-200: parse the error envelope and produce a precise diagnosis.
    try:
        body = resp.json()
        err = body.get("error", {})
    except Exception:
        err = {}

    reasons = [d.get("reason") for d in err.get("errors", []) if isinstance(d, dict)]
    reason_first = reasons[0] if reasons else None
    msg = err.get("message", "")

    diagnosis = "unknown"
    fix_hint = ""
    if reason_first in ("API_KEY_INVALID",) or "API key expired" in msg:
        diagnosis = "EXPIRED OR INVALID KEY"
        fix_hint = (
            "Rotate the key at https://console.cloud.google.com/apis/credentials, "
            "update both lines (frontend_env_vars + backend_env_vars) in "
            "infra/aws/terraform.tfvars, then `terraform apply`."
        )
    elif reason_first in ("dailyLimitExceeded", "rateLimitExceeded", "userRateLimitExceeded"):
        diagnosis = "QUOTA EXHAUSTED"
        fix_hint = (
            "Free tier is 100 queries/day.  Enable billing in GCP Console → "
            "Custom Search API → Quotas if you need more.  Resets at midnight "
            "America/Los_Angeles."
        )
    elif reason_first == "keyInvalid":
        diagnosis = "KEY REJECTED"
        fix_hint = (
            "Key is malformed or doesn't belong to a GCP project that has "
            "Custom Search API enabled.  Visit Cloud Console → APIs & "
            "Services → Library → enable 'Custom Search API'."
        )
    elif reason_first == "accessNotConfigured" or "API has not been used" in msg:
        diagnosis = "CUSTOM SEARCH API NOT ENABLED"
        fix_hint = (
            "The GCP project that owns this key has not enabled the Custom "
            "Search API.  Console → APIs & Services → Library → search "
            "'Custom Search API' → Enable."
        )
    elif reason_first == "invalidParameter" and "cx" in (msg.lower()):
        diagnosis = "INVALID CX (Programmable Search Engine ID)"
        fix_hint = (
            "The CX value points at a search engine that no longer exists or "
            "doesn't belong to the same Google account that owns the API key.  "
            "Visit https://programmablesearchengine.google.com/ to find the "
            "current engine ID."
        )
    elif resp.status_code == 403:
        diagnosis = "FORBIDDEN — likely IP/Referer restriction or API not enabled"
        fix_hint = (
            "If you set Application restrictions on the key (e.g. IP whitelist), "
            "the test runner's egress IP may not be on it.  Either widen the "
            "restriction to include the runner, or remove the restriction."
        )

    pytest.fail(
        f"Google Custom Search API rejected the configured key.\n"
        f"  HTTP status      : {resp.status_code}\n"
        f"  diagnosis        : {diagnosis}\n"
        f"  reason           : {reason_first or '(none reported)'}\n"
        f"  message          : {msg}\n"
        f"  key fingerprint  : {_redact(key)}\n"
        f"  cx               : {cx}\n"
        f"  fix              : {fix_hint}"
    )


def test_running_task_definitions_match_tfvars():
    """Every backend task def has the SAME key value as tfvars.

    Catches the "rotated locally, forgot to apply" footgun: the key in source
    is fresh but production is still running the expired one.

    Pull from the LATEST ACTIVE task definition revision per service (not a
    pinned revision) so this test stays accurate as deploys roll forward.
    """
    try:
        import boto3  # noqa: PLC0415  (boto3 in conftest fixtures, but we
                      # don't depend on a fixture here for portability)
    except ImportError:
        pytest.skip("boto3 not installed; cannot verify ECS task def env vars.")

    key_local, _ = _read_tfvars_key_cx()
    region = cfg().aws_region
    ecs = boto3.client("ecs", region_name=region)

    # Backend services that consume GOOGLE_SEARCH_KEY:
    #   - llmhub-api        (general API + auto_blog cron)
    #   - llmhub-sse        (chat streaming, calls SearchService for web_search action)
    #   - llmhub-ws         (WS service has the same env block — included for completeness)
    # The frontend (`llmhub`) also consumes it via the Next.js /api/search
    # route — we check it separately because its task def has a different shape.
    services = [
        f"{cfg().project_name}-api",
        f"{cfg().project_name}-sse",
        f"{cfg().project_name}-ws",
    ]

    mismatches: list[str] = []
    for svc in services:
        try:
            td = ecs.describe_task_definition(taskDefinition=svc)
        except Exception as e:
            mismatches.append(f"{svc}: describe_task_definition failed ({e})")
            continue
        # Each split service has a single 'backend' container.
        for c in td["taskDefinition"]["containerDefinitions"]:
            env = {e["name"]: e["value"] for e in c.get("environment", [])}
            live = env.get("GOOGLE_SEARCH_KEY")
            if live is None:
                mismatches.append(
                    f"{svc} / container={c['name']}: GOOGLE_SEARCH_KEY missing"
                )
            elif live != key_local:
                mismatches.append(
                    f"{svc} / container={c['name']}: live key "
                    f"{_redact(live)} != tfvars {_redact(key_local)}"
                )

    assert not mismatches, (
        "Production ECS task definitions disagree with tfvars on "
        "GOOGLE_SEARCH_KEY.  Run `terraform apply` from infra/aws to "
        "synchronise.  Details:\n  " + "\n  ".join(mismatches)
    )


def test_running_frontend_task_definition_matches_tfvars():
    """Frontend Next.js container also has the key (used by /api/search).

    Separate from the backend test because the frontend task def is named
    `<project>` (the legacy/sidecar shape), not `<project>-frontend`.
    """
    try:
        import boto3  # noqa: PLC0415
    except ImportError:
        pytest.skip("boto3 not installed; cannot verify ECS task def env vars.")

    key_local, _ = _read_tfvars_key_cx()
    region = cfg().aws_region
    ecs = boto3.client("ecs", region_name=region)

    try:
        td = ecs.describe_task_definition(taskDefinition=cfg().project_name)
    except Exception as e:
        pytest.skip(
            f"Frontend task def `{cfg().project_name}` not describable "
            f"({e}).  Skipping frontend env-var check."
        )

    nextjs = next(
        (c for c in td["taskDefinition"]["containerDefinitions"]
         if c["name"] == "nextjs-app"),
        None,
    )
    if nextjs is None:
        pytest.skip("nextjs-app container not in this task def — old shape.")

    env = {e["name"]: e["value"] for e in nextjs.get("environment", [])}
    live = env.get("GOOGLE_SEARCH_KEY")
    assert live is not None, (
        "Frontend nextjs-app container is missing GOOGLE_SEARCH_KEY entirely.  "
        "Verify `frontend_env_vars` block in tfvars hasn't dropped this entry."
    )
    assert live == key_local, (
        f"Frontend live key ({_redact(live)}) != tfvars key "
        f"({_redact(key_local)}).  Run `terraform apply`."
    )
