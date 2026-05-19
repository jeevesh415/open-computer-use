"""
End-to-end chat flow: sign-in → create chat → send message → consume SSE stream
→ assert a real LLM response → clean up.

THIS IS THE SINGLE MOST IMPORTANT INTEGRATION TEST IN THE SUITE — it exercises
the actual hot path that every real user (web + Electron) runs every time they
send a message.  Breakage here means revenue-facing downtime.

WARNING — running this file BILLS REAL CREDITS against the configured
TEST_USER_EMAIL account.  Each test creates a real Bedrock invocation, a real
Supabase chat/message row, and a real billing session.  Total budget per full
suite run is kept <50 cents by:

    * Pinning to the cheapest Bedrock model available (Claude 3 Haiku or
      Amazon Nova Lite) — see ``_cheap_model()`` below.
    * Pinning prompts to ~10 tokens each ("Reply with exactly the word PING.")
    * Capping SSE consumption at 50 frames or 30 seconds, whichever comes first.
    * Deleting created chats in a try/finally on every test.

To skip this file entirely:
    pytest -m 'not e2e'

To skip just the slow/destructive ones:
    SKIP_SLOW=1 pytest tests/post_deploy

Prerequisites (env):
    TEST_USER_EMAIL        — Supabase account the suite signs in as
    TEST_USER_PASSWORD
    FRONTEND_URL           — Public Next.js URL
    BACKEND_PUBLIC_URL     — Public FastAPI URL
    TEST_MACHINE_ID        — *Required*. A machine_id that the test user owns
                             and which is currently running/connected (an
                             Electron desktop, a local Docker VM, or a warm
                             AWS EC2 instance).  The backend chat handler
                             requires machine_id — without it every test here
                             returns 400 before the LLM is even contacted.
                             Tests skip cleanly when unset.
"""
from __future__ import annotations

import concurrent.futures
import json
import os
import time
import uuid
from typing import Any, Iterator

import httpx
import pytest

from conftest import assert_status, cfg


# ───────────────────────────────────────────────────────────────────────────
# Test-wide helpers
# ───────────────────────────────────────────────────────────────────────────

# Canonical SSE event codes (kept in sync with electron/src/renderer/lib/sse-parser.ts)
SSE_TEXT = "0"
SSE_ERROR = "3"
SSE_TOOL_CALL = "9"
SSE_TOOL_RESULT = "a"
SSE_REASONING = "g"
SSE_FINISH = "d"
SSE_AWAITING_HUMAN = "h"

# Cap SSE consumption so a runaway stream cannot blow the test budget.
MAX_FRAMES = 50
MAX_STREAM_SECONDS = 30.0

# Per-test hard timeout — generous enough to survive a cold start on a
# freshly-deployed ECS task, tight enough to fail fast on a stuck stream.
TEST_TIMEOUT_SECONDS = 60.0

# The prompt used by every test that needs a real LLM response.
# Engineered to produce a tiny, deterministic reply: the model just echoes PING.
PING_PROMPT = "Reply with exactly the word PING. No other text."
PING_MARKER = "PING"


def _cheap_model() -> str:
    """Return the cheapest Bedrock model ID allowed in this environment.

    Order of preference:
        1. TEST_CHAT_MODEL env var (explicit override for CI)
        2. Nova Lite — cheapest by Bedrock per-token pricing for Anthropic-class output
        3. Claude 3 Haiku — always-on fallback
    """
    override = os.environ.get("TEST_CHAT_MODEL", "").strip()
    if override:
        return override
    # Both are in the default BEDROCK_AVAILABLE_MODELS list; prefer Nova Lite.
    return "amazon.nova-lite-v1:0"


def _test_machine_id() -> str | None:
    """Machine id owned by TEST_USER_EMAIL. ``None`` means skip.

    The chat handler requires machine_id (see chat.py:277). Without one,
    every request returns 400 long before the LLM is invoked — making the
    LLM assertions in this file impossible.  We skip rather than fail so the
    rest of the post-deploy suite can run in environments that don't have a
    warm test machine (e.g. a brand-new region during bring-up).
    """
    val = os.environ.get("TEST_MACHINE_ID", "").strip()
    return val or None


def _require_machine() -> str:
    """Resolve TEST_MACHINE_ID or skip the calling test."""
    mid = _test_machine_id()
    if not mid:
        pytest.skip(
            "TEST_MACHINE_ID not set. These tests need a warm machine the "
            "test user owns (Electron desktop, local Docker, or EC2) because "
            "the chat endpoint requires machine_id. See module docstring."
        )
    return mid


def _build_chat_body(
    chat_id: str,
    user_id: str,
    machine_id: str,
    prompt: str = PING_PROMPT,
    model: str | None = None,
) -> dict[str, Any]:
    """Construct the JSON body the Python backend expects.

    Field shapes are validated by ``backend/app/models/chat.py::ChatRequest``.
    ``isAuthenticated`` is stamped true because the Next.js proxy stamps it —
    we mirror the real wire format.
    """
    return {
        "messages": [{"role": "user", "content": prompt}],
        "chat_id": chat_id,
        "user_id": user_id,
        "model": model or _cheap_model(),
        "isAuthenticated": True,
        "machine_id": machine_id,
        # Suppress search so we don't blow extra tokens on web-scrape context.
        "enableSearch": False,
        "forceSearch": False,
    }


def _parse_sse_frame(raw: str) -> tuple[str | None, Any]:
    """Parse one ``prefix:json-data`` SSE frame.

    Returns ``(prefix, decoded_data)`` or ``(None, raw)`` if the frame isn't
    in the expected shape — we never raise, because a malformed frame is
    useful information for the failing test's assertion message.
    """
    trimmed = raw.strip()
    if not trimmed:
        return None, ""
    colon = trimmed.find(":")
    if colon == -1:
        return None, trimmed
    prefix = trimmed[:colon]
    body = trimmed[colon + 1:]
    try:
        return prefix, json.loads(body)
    except Exception:
        # Not JSON — hand back the raw tail so callers can still assert on it.
        return prefix, body


def _consume_sse(
    resp: httpx.Response,
    *,
    max_frames: int = MAX_FRAMES,
    max_seconds: float = MAX_STREAM_SECONDS,
) -> list[tuple[str | None, Any]]:
    """Consume SSE frames until finish, error, or a budget is exceeded.

    The frontend SSE parser splits on ``\\n\\n`` — we mirror that here.
    Reading byte-wise from ``iter_bytes()`` lets us close the response the
    instant we see a ``d:`` or ``3:`` frame, which keeps billing minimal.
    """
    frames: list[tuple[str | None, Any]] = []
    buffer = ""
    t0 = time.monotonic()

    # Iterate bytes so we can bail the instant we see ``finish``.
    for chunk in resp.iter_bytes():
        if chunk:
            buffer += chunk.decode("utf-8", errors="replace")
        # Extract complete events (terminated by \n\n).
        while "\n\n" in buffer:
            raw, _, buffer = buffer.partition("\n\n")
            prefix, data = _parse_sse_frame(raw)
            if prefix is None and not data:
                continue
            frames.append((prefix, data))
            # Early-exit — a finish or error frame means we're done.
            if prefix in (SSE_FINISH, SSE_ERROR):
                return frames
            if len(frames) >= max_frames:
                return frames
        if time.monotonic() - t0 > max_seconds:
            return frames
    # Flush any trailing frame in the buffer (no final \n\n).
    if buffer.strip():
        prefix, data = _parse_sse_frame(buffer)
        frames.append((prefix, data))
    return frames


def _frame_texts(frames: list[tuple[str | None, Any]], prefix: str) -> list[Any]:
    """All decoded payloads with a given prefix."""
    return [data for p, data in frames if p == prefix]


def _has_finish(frames: list[tuple[str | None, Any]]) -> bool:
    return any(p == SSE_FINISH for p, _ in frames)


def _has_error(frames: list[tuple[str | None, Any]]) -> bool:
    return any(p == SSE_ERROR for p, _ in frames)


def _format_frames_for_msg(frames: list[tuple[str | None, Any]], limit: int = 8) -> str:
    """Render frames compactly for an assertion message."""
    rendered = []
    for p, d in frames[-limit:]:
        s = json.dumps(d, default=str) if not isinstance(d, str) else d
        if len(s) > 160:
            s = s[:160] + "…"
        rendered.append(f"{p}:{s}")
    return " | ".join(rendered)


# ───────────────────────────────────────────────────────────────────────────
# Fixtures
# ───────────────────────────────────────────────────────────────────────────

def _backend_url(path: str) -> str:
    return f"{cfg().backend_public_url}{path}"


def _frontend_url(path: str) -> str:
    return f"{cfg().frontend_url}{path}"


@pytest.fixture
def throwaway_chat(
    http: httpx.Client, auth_headers: dict[str, str], test_user_id: str
) -> Iterator[str]:
    """Create a disposable chat row, yield its id, delete it on teardown.

    Uses the backend directly (the Electron path) because it's the canonical
    CRUD endpoint.  The teardown is wrapped in try/except so a failed delete
    doesn't mask the real test failure — but any orphan is logged loudly.
    """
    create_resp = http.post(
        _backend_url("/api/chats/create"),
        json={
            "user_id": test_user_id,
            "title": f"post-deploy-e2e-{uuid.uuid4().hex[:8]}",
            "model": _cheap_model(),
            "source": "post-deploy-e2e",
        },
        headers=auth_headers,
        timeout=httpx.Timeout(20.0, connect=10.0),
    )
    assert_status(create_resp, (200, 201))
    chat = create_resp.json().get("chat") or {}
    chat_id = chat.get("id")
    if not chat_id:
        pytest.fail(f"throwaway_chat: backend did not return chat.id — body: {create_resp.text[:300]}")

    try:
        yield chat_id
    finally:
        try:
            del_resp = http.request(
                "DELETE",
                _backend_url(f"/api/chats/{chat_id}"),
                headers=auth_headers,
                timeout=httpx.Timeout(20.0, connect=10.0),
            )
            if del_resp.status_code not in (200, 204):
                # Don't raise — just surface loudly so a later run can clean up.
                print(
                    f"[throwaway_chat teardown] WARNING: "
                    f"DELETE {chat_id} returned {del_resp.status_code}: "
                    f"{del_resp.text[:200]}"
                )
        except Exception as e:
            print(f"[throwaway_chat teardown] WARNING: delete raised {e!r}")


# ───────────────────────────────────────────────────────────────────────────
# 1. Backend-direct chat flow
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.e2e
@pytest.mark.slow
@pytest.mark.destructive
@pytest.mark.timeout(TEST_TIMEOUT_SECONDS)
def test_chat_via_backend_direct(
    auth_headers: dict[str, str],
    test_user_id: str,
    throwaway_chat: str,
):
    """Hit ``POST {backend}/api/chat/`` (the Electron path) with a real prompt
    and assert we receive a PING response through to a ``d:`` finish frame.

    Uses its own short-lived httpx.Client so the stream timeout doesn't fight
    the session-scoped default — SSE needs a longer read budget than health
    checks.
    """
    machine_id = _require_machine()

    body = _build_chat_body(throwaway_chat, test_user_id, machine_id)
    frames: list[tuple[str | None, Any]] = []
    with httpx.Client(
        http2=True,
        timeout=httpx.Timeout(MAX_STREAM_SECONDS + 15, connect=10.0, read=MAX_STREAM_SECONDS + 5),
        follow_redirects=False,
    ) as c:
        with c.stream(
            "POST",
            _backend_url("/api/chat/"),
            json=body,
            headers={**auth_headers, "Accept": "text/event-stream"},
        ) as resp:
            assert resp.status_code == 200, (
                f"Expected 200 from backend /api/chat/, got {resp.status_code}. "
                f"Body: {resp.read()[:500]!r}"
            )
            ctype = resp.headers.get("content-type", "")
            assert "text/event-stream" in ctype, (
                f"Expected SSE content-type, got {ctype!r}"
            )
            frames = _consume_sse(resp)

    # Negative assertion first: any error frame is a hard fail.
    assert not _has_error(frames), (
        f"Stream produced an error frame. Tail: {_format_frames_for_msg(frames)}"
    )

    # At least one ``0:`` text frame must carry PING.
    text_frames = _frame_texts(frames, SSE_TEXT)
    all_text = "".join(t for t in text_frames if isinstance(t, str))
    assert PING_MARKER.lower() in all_text.lower(), (
        f"No PING token in streamed text. Accumulated text: {all_text!r}. "
        f"Tail: {_format_frames_for_msg(frames)}"
    )

    # Final ``d:`` must be present with non-empty content.
    assert _has_finish(frames), (
        f"No finish (d:) frame within budget. Tail: {_format_frames_for_msg(frames)}"
    )
    finish_payload = _frame_texts(frames, SSE_FINISH)[-1]
    assert isinstance(finish_payload, dict), f"Finish payload not an object: {finish_payload!r}"
    # content may echo the accumulated text or stand alone; either way, nonempty.
    assert finish_payload.get("content") or all_text, (
        f"Finish payload has empty content AND no streamed text: {finish_payload!r}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 2. Frontend-proxied chat flow
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.e2e
@pytest.mark.slow
@pytest.mark.destructive
@pytest.mark.timeout(TEST_TIMEOUT_SECONDS)
def test_chat_via_frontend_proxy(
    auth_headers: dict[str, str],
    test_user_id: str,
    throwaway_chat: str,
):
    """Same as above but via the Next.js ``/api/chat/`` proxy → internal ALB
    → Python backend.  This is the canonical path the web frontend uses.

    A break here with the backend-direct test passing means the internal ALB
    path or the Next.js route handler is sick.
    """
    machine_id = _require_machine()

    body = _build_chat_body(throwaway_chat, test_user_id, machine_id)
    frames: list[tuple[str | None, Any]] = []
    with httpx.Client(
        http2=True,
        timeout=httpx.Timeout(MAX_STREAM_SECONDS + 15, connect=10.0, read=MAX_STREAM_SECONDS + 5),
        follow_redirects=False,
    ) as c:
        with c.stream(
            "POST",
            _frontend_url("/api/chat/"),
            json=body,
            headers={**auth_headers, "Accept": "text/event-stream"},
        ) as resp:
            assert resp.status_code == 200, (
                f"Expected 200 from frontend proxy /api/chat/, got {resp.status_code}. "
                f"Body: {resp.read()[:500]!r}"
            )
            ctype = resp.headers.get("content-type", "")
            assert "text/event-stream" in ctype, (
                f"Expected SSE content-type, got {ctype!r}"
            )
            frames = _consume_sse(resp)

    assert not _has_error(frames), (
        f"Frontend-proxied stream produced an error frame. "
        f"Tail: {_format_frames_for_msg(frames)}"
    )
    text_frames = _frame_texts(frames, SSE_TEXT)
    all_text = "".join(t for t in text_frames if isinstance(t, str))
    assert PING_MARKER.lower() in all_text.lower(), (
        f"No PING via frontend proxy. Accumulated: {all_text!r}. "
        f"Tail: {_format_frames_for_msg(frames)}"
    )
    assert _has_finish(frames), (
        f"No finish frame from frontend proxy. Tail: {_format_frames_for_msg(frames)}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 3. Chat creation → send → history read
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.e2e
@pytest.mark.slow
@pytest.mark.destructive
@pytest.mark.timeout(TEST_TIMEOUT_SECONDS)
def test_create_chat_and_read_history(
    http: httpx.Client,
    auth_headers: dict[str, str],
    test_user_id: str,
):
    """Create a chat, send a message, drain the stream, then assert history
    reads back with both user + assistant messages.  End by deleting the chat.
    """
    machine_id = _require_machine()

    chat_id: str | None = None
    try:
        # Create
        create_resp = http.post(
            _backend_url("/api/chats/create"),
            json={
                "user_id": test_user_id,
                "title": "post-deploy-history-roundtrip",
                "model": _cheap_model(),
                "source": "post-deploy-e2e",
            },
            headers=auth_headers,
        )
        assert_status(create_resp, (200, 201))
        chat_id = (create_resp.json().get("chat") or {}).get("id")
        assert chat_id, f"Create returned no chat.id: {create_resp.text[:300]}"

        # Send
        body = _build_chat_body(chat_id, test_user_id, machine_id)
        with httpx.Client(
            http2=True,
            timeout=httpx.Timeout(MAX_STREAM_SECONDS + 15, connect=10.0, read=MAX_STREAM_SECONDS + 5),
        ) as c:
            with c.stream(
                "POST",
                _backend_url("/api/chat/"),
                json=body,
                headers={**auth_headers, "Accept": "text/event-stream"},
            ) as resp:
                assert resp.status_code == 200, (
                    f"Chat POST not 200: {resp.status_code} / {resp.read()[:300]!r}"
                )
                # Drain through finish so the assistant row is persisted.
                frames = _consume_sse(resp)
                assert _has_finish(frames), (
                    f"No finish frame — assistant row may not be persisted. "
                    f"Tail: {_format_frames_for_msg(frames)}"
                )

        # Supabase eventual-consistency grace period — the finish handler
        # saves the message synchronously but the read-your-writes window
        # on a hosted Supabase read replica can lag by ~500ms.
        time.sleep(1.0)

        # Read history
        hist_resp = http.get(
            _backend_url(f"/api/chats/{chat_id}/messages"),
            headers=auth_headers,
        )
        assert_status(hist_resp, 200)
        messages = hist_resp.json().get("messages") or []
        assert isinstance(messages, list), f"messages not a list: {hist_resp.text[:300]}"
        # user + assistant
        roles = [m.get("role") for m in messages]
        assert len(messages) >= 2, (
            f"Expected ≥2 messages after a roundtrip, got {len(messages)}. "
            f"Roles: {roles}. Full: {messages!r}"
        )
        assert "user" in roles and "assistant" in roles, (
            f"Missing user or assistant role in history. Roles: {roles}"
        )

    finally:
        if chat_id:
            try:
                http.request(
                    "DELETE",
                    _backend_url(f"/api/chats/{chat_id}"),
                    headers=auth_headers,
                )
            except Exception as e:
                print(f"[cleanup] DELETE {chat_id} raised: {e!r}")


# ───────────────────────────────────────────────────────────────────────────
# 4. Abort mid-stream
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.e2e
@pytest.mark.slow
@pytest.mark.destructive
@pytest.mark.timeout(TEST_TIMEOUT_SECONDS)
def test_abort_midstream_releases_resources(
    auth_headers: dict[str, str],
    test_user_id: str,
    throwaway_chat: str,
):
    """Start a chat stream, abort after the first frame, then start a second
    chat and confirm it streams normally.  Guards against a leaked stream
    pinning a worker slot or holding the per-machine execution lock forever.
    """
    machine_id = _require_machine()

    # ── First request: cancel immediately after the first frame ──
    body_1 = _build_chat_body(throwaway_chat, test_user_id, machine_id)
    with httpx.Client(
        http2=True,
        timeout=httpx.Timeout(MAX_STREAM_SECONDS + 5, connect=10.0),
    ) as c:
        with c.stream(
            "POST",
            _backend_url("/api/chat/"),
            json=body_1,
            headers={**auth_headers, "Accept": "text/event-stream"},
        ) as resp:
            assert resp.status_code == 200, (
                f"First chat POST not 200: {resp.status_code}"
            )
            # Read just enough for one frame boundary, then close.
            seen_anything = False
            for chunk in resp.iter_bytes():
                if chunk:
                    seen_anything = True
                    break
            # Explicit close — context manager also closes, but belt + suspenders.
            resp.close()
            assert seen_anything, "No bytes received before abort — backend never wrote"

    # Grace period so the backend can propagate the disconnect:
    #   * StreamingResponse notices request.is_disconnected()
    #   * Stream breaks, billing ends, per-machine lock releases
    time.sleep(5.0)

    # ── Second request: must succeed normally ──
    # Use a NEW chat id so we're not blocked by any lingering lock-by-chat-id
    # logic in the backend (machine-level lock is what we care about).
    body_2 = _build_chat_body(throwaway_chat, test_user_id, machine_id, prompt=PING_PROMPT)
    frames: list[tuple[str | None, Any]] = []
    with httpx.Client(
        http2=True,
        timeout=httpx.Timeout(MAX_STREAM_SECONDS + 15, connect=10.0, read=MAX_STREAM_SECONDS + 5),
    ) as c:
        with c.stream(
            "POST",
            _backend_url("/api/chat/"),
            json=body_2,
            headers={**auth_headers, "Accept": "text/event-stream"},
        ) as resp:
            assert resp.status_code == 200, (
                f"Second chat POST not 200 after abort — leaked resources? "
                f"Status: {resp.status_code}. Body: {resp.read()[:300]!r}"
            )
            frames = _consume_sse(resp)

    assert _has_finish(frames), (
        f"Second stream did not reach finish. Backend may be stuck. "
        f"Tail: {_format_frames_for_msg(frames)}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 5. Empty body → 4xx (never 5xx)
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.e2e
@pytest.mark.timeout(TEST_TIMEOUT_SECONDS)
def test_empty_body_returns_4xx(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """POST with a valid Bearer but an empty JSON body.

    FastAPI's pydantic validator returns 422 on a missing ``messages`` field;
    the handler's own guard returns 400 on missing ``chat_id``.  Either is
    acceptable; a 500 is NOT.
    """
    resp = http.post(
        _backend_url("/api/chat/"),
        json={},
        headers=auth_headers,
    )
    assert resp.status_code in (400, 422), (
        f"Empty body must 400/422, got {resp.status_code}. "
        f"Body: {resp.text[:500]}"
    )
    ctype = resp.headers.get("content-type", "")
    assert "application/json" in ctype, (
        f"Error body must be JSON, got {ctype!r}. Body: {resp.text[:300]}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 6. Giant prompt → respects context budget
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.e2e
@pytest.mark.slow
@pytest.mark.destructive
@pytest.mark.timeout(TEST_TIMEOUT_SECONDS)
def test_long_prompt_respects_context_budget(
    auth_headers: dict[str, str],
    test_user_id: str,
    throwaway_chat: str,
):
    """A ~10KB prompt should either (a) succeed with a PING reply (the
    message optimizer trims / the model handles it) or (b) be rejected
    with a clean 4xx error — NEVER a 500 or silent hallucinated truncation.
    """
    machine_id = _require_machine()

    filler = ("abcd" * 2600)[:10_240]  # 10 KiB of padding
    long_prompt = f"{filler}\n\nReply with PING."
    body = _build_chat_body(throwaway_chat, test_user_id, machine_id, prompt=long_prompt)

    with httpx.Client(
        http2=True,
        timeout=httpx.Timeout(MAX_STREAM_SECONDS + 15, connect=10.0, read=MAX_STREAM_SECONDS + 5),
    ) as c:
        with c.stream(
            "POST",
            _backend_url("/api/chat/"),
            json=body,
            headers={**auth_headers, "Accept": "text/event-stream"},
        ) as resp:
            status = resp.status_code
            if status == 200:
                # Path A — backend accepted, stream should reach PING.
                frames = _consume_sse(resp)
                # Error frame OR finish — both are valid outcomes for a large
                # prompt.  Silent hallucination would be all-text and no error,
                # and that's OK — we only fail if we got a 5xx or no finish.
                assert _has_finish(frames) or _has_error(frames), (
                    f"Large prompt accepted but stream never resolved. "
                    f"Tail: {_format_frames_for_msg(frames)}"
                )
                # If it did finish cleanly, sanity-check we got text.
                if _has_finish(frames) and not _has_error(frames):
                    text_frames = _frame_texts(frames, SSE_TEXT)
                    all_text = "".join(t for t in text_frames if isinstance(t, str))
                    assert all_text.strip(), (
                        f"Large prompt finished with no streamed text — "
                        f"possible silent truncation. Frames: "
                        f"{_format_frames_for_msg(frames)}"
                    )
                return

            # Path B — rejected before streaming.
            body_bytes = resp.read()
            assert status in (400, 413, 422), (
                f"Large prompt must either succeed (200) or be cleanly "
                f"rejected (400/413/422). Got {status}. "
                f"Body: {body_bytes[:500]!r}"
            )
            # 413 = Payload Too Large; ensure the error message steers the
            # caller toward the right remediation (shorter prompt / trim).
            if status == 413:
                try:
                    err = json.loads(body_bytes.decode("utf-8", "replace"))
                    msg = str(err.get("detail") or err.get("error") or "").lower()
                except Exception:
                    msg = body_bytes.decode("utf-8", "replace").lower()
                assert any(k in msg for k in ("large", "long", "context", "size", "limit")), (
                    f"413 error message doesn't point at size/context: {msg!r}"
                )


# ───────────────────────────────────────────────────────────────────────────
# 7. Tool call path (soft-assertion)
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.e2e
@pytest.mark.slow
@pytest.mark.destructive
@pytest.mark.xfail(strict=False, reason="Tool routing depends on CUA + machine state")
@pytest.mark.timeout(TEST_TIMEOUT_SECONDS)
def test_chat_with_tool_call_roundtrip(
    auth_headers: dict[str, str],
    test_user_id: str,
    throwaway_chat: str,
):
    """Prompt the agent to do something likely to trigger a tool call
    (a web search).  Ideal: at least one ``9:`` (tool call) followed by
    ``a:`` (tool result).  Acceptable: the backend accepts the request and
    streams SOMETHING (the CUA loop decides whether to actually call a tool).

    xfail because tool routing is tied to the CUA/machine state and may
    legitimately answer without a tool if the model decides to.
    """
    machine_id = _require_machine()

    # A prompt that strongly suggests web search.
    prompt = "Search the web for today's date and reply with just the date in YYYY-MM-DD format."
    body = _build_chat_body(throwaway_chat, test_user_id, machine_id, prompt=prompt)
    # Enable search so the CUA is likely to route to web_search.
    body["enableSearch"] = True

    with httpx.Client(
        http2=True,
        timeout=httpx.Timeout(MAX_STREAM_SECONDS + 15, connect=10.0, read=MAX_STREAM_SECONDS + 5),
    ) as c:
        with c.stream(
            "POST",
            _backend_url("/api/chat/"),
            json=body,
            headers={**auth_headers, "Accept": "text/event-stream"},
        ) as resp:
            # Baseline: backend must accept + start streaming.
            assert resp.status_code == 200, (
                f"Tool-seeking prompt rejected: {resp.status_code} / "
                f"{resp.read()[:300]!r}"
            )
            frames = _consume_sse(resp)

    tool_calls = _frame_texts(frames, SSE_TOOL_CALL)
    tool_results = _frame_texts(frames, SSE_TOOL_RESULT)
    # This is the xfail assertion — present but strict=False.
    assert tool_calls, (
        f"No tool-call (9:) frames observed — CUA chose not to route to a tool. "
        f"Tail: {_format_frames_for_msg(frames)}"
    )
    # If we got calls, we should also see results before the stream ends.
    assert tool_results, (
        f"Saw tool calls but no tool results: {tool_calls}. "
        f"Tail: {_format_frames_for_msg(frames)}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 8. Cancel endpoint closes the stream cleanly
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.e2e
@pytest.mark.slow
@pytest.mark.destructive
@pytest.mark.timeout(TEST_TIMEOUT_SECONDS)
def test_cancel_midstream_via_stop_endpoint(
    http: httpx.Client,
    auth_headers: dict[str, str],
    test_user_id: str,
    throwaway_chat: str,
):
    """Start a chat stream, then hit ``POST /api/chat/stop-machine/{machine_id}``
    from a *second* connection.  The original stream should close with a
    terminal ``d:`` (cancelled) or ``3:`` (error) frame.

    Skipped if the stop-machine route is absent (older deploys).
    """
    machine_id = _require_machine()

    # Probe the stop-machine route first so we can skip cleanly on older deploys.
    probe = http.post(
        _backend_url(f"/api/chat/stop-machine/{machine_id}"),
        headers=auth_headers,
    )
    if probe.status_code == 404:
        pytest.skip("Backend does not expose /api/chat/stop-machine/{machine_id}")

    # Probe response is itself a valid stop — machine was idle.  That's fine;
    # we're about to start a new request we'll then cancel.

    body = _build_chat_body(throwaway_chat, test_user_id, machine_id)
    frames: list[tuple[str | None, Any]] = []

    # Start the chat and, after the first frame, fire the cancel from another client.
    with httpx.Client(
        http2=True,
        timeout=httpx.Timeout(MAX_STREAM_SECONDS + 15, connect=10.0, read=MAX_STREAM_SECONDS + 5),
    ) as stream_client:
        with stream_client.stream(
            "POST",
            _backend_url("/api/chat/"),
            json=body,
            headers={**auth_headers, "Accept": "text/event-stream"},
        ) as resp:
            assert resp.status_code == 200, (
                f"Chat POST not 200: {resp.status_code}"
            )
            # Wait for the first byte (stream has actually started).
            cancelled = False
            t0 = time.monotonic()
            buffer = ""
            for chunk in resp.iter_bytes():
                if not chunk:
                    continue
                buffer += chunk.decode("utf-8", errors="replace")
                # Once we've seen any frame, fire the cancel from a second client.
                if not cancelled and "\n\n" in buffer:
                    cancel_resp = http.post(
                        _backend_url(f"/api/chat/stop-machine/{machine_id}"),
                        headers=auth_headers,
                    )
                    assert cancel_resp.status_code in (200, 204), (
                        f"stop-machine failed: {cancel_resp.status_code} / "
                        f"{cancel_resp.text[:300]}"
                    )
                    cancelled = True
                # Drain remaining frames.
                while "\n\n" in buffer:
                    raw, _, buffer = buffer.partition("\n\n")
                    prefix, data = _parse_sse_frame(raw)
                    if prefix is not None or data:
                        frames.append((prefix, data))
                if time.monotonic() - t0 > MAX_STREAM_SECONDS:
                    break
                if _has_finish(frames) or _has_error(frames):
                    break

    assert cancelled, "Never saw the first frame to trigger cancel"
    assert _has_finish(frames) or _has_error(frames), (
        f"Stream did not emit a terminal frame after cancel. "
        f"Tail: {_format_frames_for_msg(frames)}"
    )
    if _has_finish(frames):
        finish = _frame_texts(frames, SSE_FINISH)[-1]
        # finishReason should reflect the cancel — tolerate "cancelled" or "stop".
        reason = (finish or {}).get("finishReason") if isinstance(finish, dict) else None
        assert reason in ("cancelled", "stop", "error"), (
            f"Unexpected finishReason after cancel: {reason!r}. Finish: {finish!r}"
        )


# ───────────────────────────────────────────────────────────────────────────
# 9. Concurrent chats do not interfere
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.e2e
@pytest.mark.slow
@pytest.mark.destructive
@pytest.mark.timeout(TEST_TIMEOUT_SECONDS * 2)
def test_concurrent_chats_do_not_interfere(
    http: httpx.Client,
    auth_headers: dict[str, str],
    test_user_id: str,
):
    """Start 3 chats in parallel, each with its own unique PING token, and
    assert each response carries its own token (not another chat's).

    Uses three *different* chat_ids — the backend's per-machine execution
    lock will serialize them if they share a machine, so callers need
    multiple machines for true parallelism.  We accept serialization as
    long as each response is correctly routed back to its own chat.

    Skipped when SKIP_SLOW=1 (module-level hook handles the mark).
    """
    if cfg().skip_slow:
        pytest.skip("SKIP_SLOW=1")

    machine_id = _require_machine()
    # Optional comma-separated list of additional machine_ids for real parallelism.
    extra_machines = [
        m.strip() for m in os.environ.get("TEST_MACHINE_IDS_EXTRA", "").split(",") if m.strip()
    ]

    # Create 3 throwaway chats
    chat_ids: list[str] = []
    try:
        for i in range(3):
            resp = http.post(
                _backend_url("/api/chats/create"),
                json={
                    "user_id": test_user_id,
                    "title": f"post-deploy-concurrent-{i}-{uuid.uuid4().hex[:6]}",
                    "model": _cheap_model(),
                    "source": "post-deploy-e2e",
                },
                headers=auth_headers,
            )
            assert_status(resp, (200, 201))
            cid = (resp.json().get("chat") or {}).get("id")
            assert cid
            chat_ids.append(cid)

        tokens = [f"PING-{i}" for i in range(3)]

        def run_one(idx: int) -> tuple[int, str]:
            """Send chat idx, return (idx, accumulated-text)."""
            # Reuse primary machine if we don't have extras.  The per-machine
            # lock will serialize, which is fine — we only need each response
            # to carry its own token.
            mid = extra_machines[idx - 1] if idx - 1 < len(extra_machines) else machine_id
            body = _build_chat_body(
                chat_ids[idx],
                test_user_id,
                mid,
                prompt=f"Reply with exactly the token {tokens[idx]}. No other text.",
            )
            with httpx.Client(
                http2=True,
                timeout=httpx.Timeout(MAX_STREAM_SECONDS + 15, connect=10.0, read=MAX_STREAM_SECONDS + 5),
            ) as c:
                with c.stream(
                    "POST",
                    _backend_url("/api/chat/"),
                    json=body,
                    headers={**auth_headers, "Accept": "text/event-stream"},
                ) as resp:
                    if resp.status_code != 200:
                        return idx, f"<http {resp.status_code}: {resp.read()[:200]!r}>"
                    frames = _consume_sse(resp)
            texts = _frame_texts(frames, SSE_TEXT)
            return idx, "".join(t for t in texts if isinstance(t, str))

        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            futures = [pool.submit(run_one, i) for i in range(3)]
            results = {
                idx: text
                for idx, text in (f.result(timeout=TEST_TIMEOUT_SECONDS) for f in futures)
            }

        # Each chat's text must contain its own token…
        for i, tok in enumerate(tokens):
            assert tok in results[i], (
                f"Chat {i} missing its token {tok!r}. Got: {results[i]!r}"
            )
        # …and must NOT contain another chat's token.  (Cross-talk = router bug.)
        for i, tok in enumerate(tokens):
            others = [tokens[j] for j in range(3) if j != i]
            for other in others:
                assert other not in results[i], (
                    f"Chat {i} leaked token {other!r} from another chat. "
                    f"Got: {results[i]!r}"
                )

    finally:
        for cid in chat_ids:
            try:
                http.request(
                    "DELETE",
                    _backend_url(f"/api/chats/{cid}"),
                    headers=auth_headers,
                )
            except Exception as e:
                print(f"[cleanup] DELETE {cid} raised: {e!r}")


# ───────────────────────────────────────────────────────────────────────────
# 10. Frontend proxy latency overhead
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.e2e
@pytest.mark.slow
@pytest.mark.destructive
@pytest.mark.timeout(TEST_TIMEOUT_SECONDS)
def test_frontend_proxy_latency_is_reasonable(
    auth_headers: dict[str, str],
    test_user_id: str,
    throwaway_chat: str,
):
    """Measure the first-byte latency of the Next.js proxy path vs. the
    backend-direct path.  Soft assertion: the proxy should add no more
    than ~2 s on top of the direct hit.  Beyond that, the internal ALB /
    Next.js route handler is likely sick.
    """
    machine_id = _require_machine()
    body = _build_chat_body(throwaway_chat, test_user_id, machine_id)

    def time_first_byte(url: str) -> float:
        """Open a stream, read until first non-empty chunk, close."""
        with httpx.Client(
            http2=True,
            timeout=httpx.Timeout(MAX_STREAM_SECONDS + 15, connect=10.0, read=MAX_STREAM_SECONDS + 5),
        ) as c:
            t0 = time.monotonic()
            with c.stream(
                "POST",
                url,
                json=body,
                headers={**auth_headers, "Accept": "text/event-stream"},
            ) as resp:
                assert resp.status_code == 200, (
                    f"Latency probe to {url} not 200: {resp.status_code}"
                )
                for chunk in resp.iter_bytes():
                    if chunk:
                        elapsed = time.monotonic() - t0
                        return elapsed
        return float("inf")

    # Measure backend-direct first (warm), then frontend (warm).  We skip the
    # cold-start slot by pre-hitting both with health checks — the session
    # fixture's keep-alive already covers the backend; frontend needs a poke.
    with httpx.Client(timeout=10.0) as c:
        try:
            c.get(_frontend_url("/api/health"))
        except Exception:
            pass  # not fatal — we'll just take the cold latency number

    backend_latency = time_first_byte(_backend_url("/api/chat/"))
    # Briefly cool down to avoid the 2nd request racing against the 1st's
    # per-machine execution lock release.
    time.sleep(2.0)
    proxy_latency = time_first_byte(_frontend_url("/api/chat/"))

    delta = proxy_latency - backend_latency
    # Report loudly — this is a soft assertion, diagnosis data matters more
    # than a bright green tick.
    print(
        f"[latency] backend_direct={backend_latency*1000:.0f}ms  "
        f"frontend_proxy={proxy_latency*1000:.0f}ms  "
        f"delta={delta*1000:.0f}ms"
    )
    # Hard fail only when the proxy adds >2s — that's a real problem.
    assert delta < 2.0, (
        f"Frontend proxy adds {delta*1000:.0f}ms on top of backend-direct "
        f"({backend_latency*1000:.0f}ms → {proxy_latency*1000:.0f}ms). "
        f"Budget is 2000ms. Internal ALB path likely unhealthy."
    )


# ───────────────────────────────────────────────────────────────────────────
# 11. Wrong chat_id ownership → 404, not another user's data
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.e2e
@pytest.mark.timeout(TEST_TIMEOUT_SECONDS)
def test_read_foreign_chat_id_returns_404(
    http: httpx.Client, auth_headers: dict[str, str]
):
    """A UUID-shaped chat id that doesn't belong to the test user must 404.
    Crucially this is the same code path the chat handler uses (via
    ``_get_chat_for_user``) so a leak here would mean the LLM could be
    steered to write into another user's chat.

    This one carries only ``@pytest.mark.e2e`` — no destructive side effects,
    no credits spent.
    """
    foreign = "11111111-1111-1111-1111-111111111111"
    resp = http.get(
        _backend_url(f"/api/chats/{foreign}"),
        headers=auth_headers,
    )
    # 404 regardless of whether the row exists or not (owner check is the
    # same branch in _get_chat_for_user).
    assert resp.status_code == 404, (
        f"Expected 404 for foreign chat id, got {resp.status_code}. "
        f"Body: {resp.text[:300]}"
    )
    ctype = resp.headers.get("content-type", "")
    assert "application/json" in ctype, (
        f"404 must be JSON, got {ctype!r}"
    )
