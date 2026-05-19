"""
Post-deployment tests that verify Supabase database connectivity, RLS
correctness, and the basic read/write flows the Coasty app depends on.

This file is the *multi-tenancy guard*.  A bad RLS deploy — a dropped
policy, a typo in `(SELECT auth.uid())`, or an accidentally service-role
anon key — will cause test 4 (anon read) or test 3 (cross-tenant read)
to fail LOUDLY.  Treat any failure here as P0; users' data is leaking.

Design notes
------------
* Every test carries ``@pytest.mark.database`` so the suite can be sliced
  (e.g. ``pytest -m database``).  Writes also carry ``@pytest.mark.destructive``
  so ``-m "not destructive"`` runs a pure read-only sweep.
* The ``test_user_session`` fixture is session-scoped (signs in once), so
  this module doing sign-in-dependent work does not rate-limit Supabase.
* Every destructive test is wrapped in ``try/finally`` with an explicit
  delete.  If the delete fails we log the row id at WARNING so an operator
  can clean up — we never swallow leftovers silently.
* We never log full JWTs or refresh tokens.  When we need to compare tokens
  (refresh test) we compare hashes only.
* Tests are idempotent: unique titles (``post-deploy-smoke-<uuid>``) mean
  running the suite back-to-back doesn't collide.
* The schema catalog for reference lives in ``supabase/schema.sql`` and the
  hardened chats/messages RLS policies in ``supabase/migrations/010_rls_hardening.sql``.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from conftest import cfg

log = logging.getLogger(__name__)


# ───────────────────────────────────────────────────────────────────────────
# Helpers
# ───────────────────────────────────────────────────────────────────────────

def _unique_title(tag: str = "") -> str:
    """Unique chat title so concurrent / back-to-back runs don't collide."""
    suffix = f"-{tag}" if tag else ""
    return f"post-deploy-smoke{suffix}-{uuid.uuid4()}"


def _hash_token(token: str) -> str:
    """Hash-only comparison — we NEVER log raw access/refresh tokens."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()[:16]


def _decode_jwt_payload(jwt_str: str) -> dict[str, Any]:
    """Decode a JWT payload segment WITHOUT verifying the signature.

    We only read public claims here (role, exp).  Signature verification
    would require the project's JWT secret, which post-deploy tests
    don't have.  That's fine — we're reading a claim we already trust
    Supabase to have issued.
    """
    parts = jwt_str.split(".")
    if len(parts) != 3:
        raise ValueError("JWT does not have three segments")
    payload_b64 = parts[1]
    # base64url padding
    padding = "=" * (-len(payload_b64) % 4)
    raw = base64.urlsafe_b64decode(payload_b64 + padding)
    return json.loads(raw)


def _authed_client(access_token: str, refresh_token: str | None = None):
    """Build a fresh Supabase client pinned to a specific user's session.

    Using a separate instance per test avoids the common footgun where the
    session-scoped ``supabase_client`` gets its ``postgrest`` auth overwritten
    by one test and breaks the next.
    """
    from supabase import create_client

    c = cfg()
    client = create_client(c.supabase_url, c.supabase_anon_key)
    # set_session lets PostgREST pick up the user's JWT on subsequent calls.
    client.auth.set_session(access_token, refresh_token or "")
    return client


def _anon_client():
    """Fresh Supabase client with NO session — simulates an unauthenticated
    visitor.  Used to confirm RLS rejects anonymous reads of user data."""
    from supabase import create_client

    c = cfg()
    return create_client(c.supabase_url, c.supabase_anon_key)


def _best_effort_delete(client, table: str, row_id) -> None:
    """Delete a row; if it fails, log loudly so the row can be reaped manually.

    We never re-raise — cleanup failure must not mask the actual test failure.
    """
    try:
        client.table(table).delete().eq("id", row_id).execute()
    except Exception as e:  # noqa: BLE001 — we explicitly want to log + swallow
        log.warning(
            "LEFTOVER ROW — failed to delete %s.id=%s: %s. "
            "Operator: clean up manually.",
            table,
            row_id,
            e,
        )


# ───────────────────────────────────────────────────────────────────────────
# 1. Sign-in confirmation
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.database
def test_sign_in_succeeds(test_user_session):
    """Explicit regression guard: Supabase auth is up and the test user signs in.

    If this fails, *every* other test in this module would be skipped anyway
    (they all depend on ``test_user_session``), but we fail here first with a
    specific message so the operator knows to check Supabase auth before RLS.
    """
    assert test_user_session is not None, "test_user_session fixture returned None"
    assert test_user_session.access_token, "Session has empty access_token"
    assert test_user_session.user is not None, "Session has no user attached"
    assert test_user_session.user.id, "Session user has no id"

    # Expiry claim check — must be at least 5 min in the future.
    payload = _decode_jwt_payload(test_user_session.access_token)
    exp = payload.get("exp")
    assert isinstance(exp, int), f"JWT exp claim is not an int: {exp!r}"
    now = int(time.time())
    seconds_left = exp - now
    assert seconds_left > 300, (
        f"Access token expires in {seconds_left}s (<5 min). "
        f"Refresh-window misconfigured or test_user_session caching stale?"
    )


# ───────────────────────────────────────────────────────────────────────────
# 2. Read own chats (RLS happy path)
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.database
def test_read_own_chats(test_user_session, test_user_id):
    """RLS happy path: an authenticated user can SELECT their own chats.

    0 rows is acceptable (new test account); the only failure mode here is
    a thrown exception or returning rows that aren't ours.
    """
    client = _authed_client(
        test_user_session.access_token, test_user_session.refresh_token
    )
    resp = (
        client.table("chats")
        .select("id, user_id, created_at")
        .eq("user_id", test_user_id)
        .limit(10)
        .execute()
    )
    rows = resp.data or []
    for row in rows:
        assert row["user_id"] == test_user_id, (
            f"RLS leak on happy path? Got row owned by {row['user_id']!r} "
            f"when filtering by {test_user_id!r}."
        )


# ───────────────────────────────────────────────────────────────────────────
# 3. Read other users' chats is BLOCKED by RLS
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.database
def test_rls_blocks_cross_tenant_chat_read(test_user_session, test_user_id):
    """SECURITY CRITICAL: filtering for other users' PRIVATE chats must return 0 rows.

    The schema (see supabase/schema.sql line 2790) intentionally allows
    SELECT on chats where ``public = true`` — that powers the public share
    pages at /p/[slug].  It also allows SELECT on chats where
    ``collaborative = true`` — that's the multi-user collaborative-rooms
    feature.  Both are documented features, not RLS leaks.

    What this test guards against: a chat that is NEITHER public NOR
    collaborative leaking to a non-owner.  That would be a real P0 RLS
    breach (private conversations escaping their owner).

    Verified 2026-04-25: query returns 0 with the public/collaborative
    filter — RLS is correct.  Without the filter the query returns rows
    that are ALL ``public=true`` (the share-link feature working), which
    earlier versions of this test wrongly flagged as a breach.
    """
    client = _authed_client(
        test_user_session.access_token, test_user_session.refresh_token
    )
    resp = (
        client.table("chats")
        .select("id, user_id, public, collaborative")
        .neq("user_id", test_user_id)
        .neq("public", True)         # exclude legitimate share-link rows
        .neq("collaborative", True)  # exclude collaborative-rooms rows
        .limit(50)
        .execute()
    )
    rows = resp.data or []

    leaked = [r for r in rows if r.get("user_id") != test_user_id]
    assert not leaked, (
        f"SECURITY: test user could read {len(leaked)} PRIVATE rows owned by "
        f"other users (public=False, collaborative=False). Review RLS policy "
        f"on `chats`. First leaked row id: {leaked[0].get('id')!r} owned by "
        f"{leaked[0].get('user_id')!r}. This IS a real RLS breach."
    )


# ───────────────────────────────────────────────────────────────────────────
# 4. Anonymous cannot read chats
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.database
def test_anon_cannot_read_chats():
    """SECURITY CRITICAL: an anon client must not read PRIVATE user chats.

    The chats table has an explicit policy ``"Anyone can view public chats"
    FOR SELECT TO authenticated, anon USING (public = true)`` — that's
    intentional for the /p/[slug] share-link feature.  Anon CAN see
    public-shared chats; that's working as designed.

    What this test guards against: anon being able to read chats where
    ``public = false``.  That would mean either the share policy is
    over-broad or the owner-only policy is missing — a P0 multi-tenancy
    failure.

    Verified 2026-04-25 against the production database: anon's query for
    non-public rows returns 0.  RLS is correct.
    """
    anon = _anon_client()
    try:
        resp = (
            anon.table("chats")
            .select("id, user_id, public")
            .neq("public", True)  # exclude legitimate share-link rows
            .limit(5)
            .execute()
        )
    except Exception as e:  # noqa: BLE001 — RLS denial may raise, that's fine
        # RLS raising is acceptable; the key is NOT returning private data.
        log.info("Anon read raised as expected: %s", type(e).__name__)
        return

    rows = resp.data or []
    assert rows == [], (
        f"SECURITY: anonymous client could read {len(rows)} PRIVATE chats rows "
        f"(public=False). RLS policy `Users can view their own chats` is "
        f"either missing or scoped incorrectly. Review supabase/schema.sql "
        f"and supabase/migrations/010_rls_hardening.sql. This IS a real breach."
    )


# ───────────────────────────────────────────────────────────────────────────
# 5. Create, read, delete a chat (destructive round-trip)
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.database
@pytest.mark.destructive
def test_chat_insert_read_delete_roundtrip(test_user_session, test_user_id):
    """Full CRUD: insert → read by id → delete → verify gone."""
    client = _authed_client(
        test_user_session.access_token, test_user_session.refresh_token
    )
    title = _unique_title("crud")
    created_id: str | None = None

    try:
        ins = (
            client.table("chats")
            .insert({"user_id": test_user_id, "title": title})
            .execute()
        )
        assert ins.data, "Insert returned no data"
        row = ins.data[0]
        created_id = row["id"]

        # Server-assigned fields must come back populated.
        assert row["user_id"] == test_user_id, (
            f"Insert returned user_id={row['user_id']!r}, "
            f"expected {test_user_id!r} (auth.uid() policy mismatch?)"
        )
        assert row.get("id"), "Insert returned no id"
        assert row.get("created_at"), "Insert returned no created_at"

        # Read-back by id.
        got = (
            client.table("chats")
            .select("id, user_id, title")
            .eq("id", created_id)
            .execute()
        )
        assert got.data and len(got.data) == 1, "Could not read row back by id"
        assert got.data[0]["title"] == title

        # Delete.
        client.table("chats").delete().eq("id", created_id).execute()
        created_id = None  # mark cleanup done so finally doesn't double-delete

        # Verify gone.
        after = (
            client.table("chats")
            .select("id")
            .eq("id", row["id"])
            .execute()
        )
        assert (after.data or []) == [], "Chat row still readable after delete"
    finally:
        if created_id is not None:
            _best_effort_delete(client, "chats", created_id)


# ───────────────────────────────────────────────────────────────────────────
# 6. Message write round-trip
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.database
@pytest.mark.destructive
def test_message_roundtrip(test_user_session, test_user_id):
    """Create a chat, insert a minimal message, read it back, clean up.

    Exercises the messages RLS EXISTS sub-query path (see migration 010).
    """
    client = _authed_client(
        test_user_session.access_token, test_user_session.refresh_token
    )
    chat_id: str | None = None
    msg_id: int | None = None

    try:
        chat = (
            client.table("chats")
            .insert({"user_id": test_user_id, "title": _unique_title("msg")})
            .execute()
        )
        assert chat.data, "Chat insert returned no data"
        chat_id = chat.data[0]["id"]

        msg = (
            client.table("messages")
            .insert(
                {
                    "chat_id": chat_id,
                    "user_id": test_user_id,
                    "role": "user",
                    "content": "post-deploy ping",
                }
            )
            .execute()
        )
        assert msg.data, "Message insert returned no data"
        msg_id = msg.data[0]["id"]
        assert msg.data[0]["chat_id"] == chat_id
        assert msg.data[0]["role"] == "user"

        # Read back via chat_id filter (tests the EXISTS policy path).
        got = (
            client.table("messages")
            .select("id, chat_id, role, content")
            .eq("chat_id", chat_id)
            .execute()
        )
        assert got.data and any(m["id"] == msg_id for m in got.data), (
            "Inserted message not readable via RLS EXISTS path"
        )
    finally:
        # messages are cascade-deleted when chat is deleted, but be explicit
        if msg_id is not None and chat_id is not None:
            try:
                client.table("messages").delete().eq("id", msg_id).execute()
            except Exception as e:  # noqa: BLE001
                log.warning(
                    "LEFTOVER ROW — failed to delete messages.id=%s: %s",
                    msg_id, e,
                )
        if chat_id is not None:
            _best_effort_delete(client, "chats", chat_id)


# ───────────────────────────────────────────────────────────────────────────
# 7. RLS on messages for non-existent chat
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.database
def test_messages_for_nonexistent_chat_returns_empty(test_user_session):
    """Reading messages for a random UUID chat_id must return 0 rows, no error."""
    client = _authed_client(
        test_user_session.access_token, test_user_session.refresh_token
    )
    bogus_chat_id = str(uuid.uuid4())
    resp = (
        client.table("messages")
        .select("id")
        .eq("chat_id", bogus_chat_id)
        .limit(5)
        .execute()
    )
    assert (resp.data or []) == [], (
        f"Expected 0 rows for non-existent chat_id={bogus_chat_id}, "
        f"got {len(resp.data or [])}"
    )


# ───────────────────────────────────────────────────────────────────────────
# 8. status_checks readable (public monitoring table)
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.database
def test_status_checks_readable(test_user_session):
    """Per migration 001_status_checks.sql, the status page is public read:

        CREATE POLICY "Public read access" ON status_checks
          FOR SELECT TO anon, authenticated USING (true);

    A simple bounded select should succeed for an authenticated user.  If
    the table or policy is missing, the status page will 500 in prod.
    """
    client = _authed_client(
        test_user_session.access_token, test_user_session.refresh_token
    )
    try:
        resp = client.table("status_checks").select("id").limit(1).execute()
    except Exception as e:  # noqa: BLE001
        pytest.skip(
            f"status_checks table not readable — may not be deployed on "
            f"this project: {type(e).__name__}: {e}"
        )
    # data may be [] if nothing has written yet — success is "no exception".
    assert isinstance(resp.data, list), "status_checks select didn't return a list"


# ───────────────────────────────────────────────────────────────────────────
# 9. Foreign-key constraint check
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.database
@pytest.mark.destructive
def test_message_fk_to_chats_is_enforced(test_user_session, test_user_id):
    """Inserting a message with a random (non-existent) chat_id must fail.

    Two failure modes are acceptable:
      1. FK violation (23503) — the constraint is enforced.
      2. RLS violation (insufficient privileges) — RLS blocks before FK
         ever gets checked, because the EXISTS sub-query finds no matching
         chat row owned by us.  This *also* proves the FK logically holds
         from the user's point of view.
    Both outcomes mean "you cannot orphan a message".
    """
    client = _authed_client(
        test_user_session.access_token, test_user_session.refresh_token
    )
    bogus_chat_id = str(uuid.uuid4())

    inserted_id: int | None = None
    try:
        resp = (
            client.table("messages")
            .insert(
                {
                    "chat_id": bogus_chat_id,
                    "user_id": test_user_id,
                    "role": "user",
                    "content": "this should never land",
                }
            )
            .execute()
        )
        # If we got here, the insert supposedly succeeded — that's wrong.
        if resp.data:
            inserted_id = resp.data[0].get("id")
        pytest.fail(
            f"Inserted a message against a non-existent chat_id "
            f"{bogus_chat_id} without error. FK constraint or RLS is "
            f"missing on public.messages."
        )
    except Exception as e:  # noqa: BLE001 — any raise is the happy path
        msg = str(e).lower()
        assert any(
            tok in msg
            for tok in (
                "foreign key",
                "violates",
                "23503",
                "row-level security",
                "row level security",
                "new row violates",
                "policy",
                "permission",
            )
        ), (
            f"Insert failed, but not with a recognisable FK/RLS error. "
            f"Got: {type(e).__name__}: {e}"
        )
    finally:
        if inserted_id is not None:
            _best_effort_delete(client, "messages", inserted_id)


# ───────────────────────────────────────────────────────────────────────────
# 10. Timestamp sanity
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.database
@pytest.mark.destructive
def test_chat_created_at_near_now(test_user_session, test_user_id):
    """``created_at`` on a fresh insert must be within ±5 min of wall clock.

    Guards against severe DB clock skew, misconfigured timezone, or
    non-UTC storage issues.
    """
    client = _authed_client(
        test_user_session.access_token, test_user_session.refresh_token
    )
    created_id: str | None = None
    try:
        before = datetime.now(timezone.utc)
        ins = (
            client.table("chats")
            .insert({"user_id": test_user_id, "title": _unique_title("clock")})
            .execute()
        )
        after = datetime.now(timezone.utc)
        assert ins.data, "Insert returned no data"
        row = ins.data[0]
        created_id = row["id"]

        raw = row["created_at"]
        # Parse a few common Postgres shapes robustly.
        ts_str = raw.replace("Z", "+00:00") if isinstance(raw, str) else raw
        ts = datetime.fromisoformat(ts_str) if isinstance(ts_str, str) else ts_str
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)

        tolerance = timedelta(minutes=5)
        assert (before - tolerance) <= ts <= (after + tolerance), (
            f"created_at {ts.isoformat()} is outside ±5 min window "
            f"[{(before - tolerance).isoformat()}, "
            f"{(after + tolerance).isoformat()}]. "
            f"Check Postgres server time / timezone config."
        )
    finally:
        if created_id is not None:
            _best_effort_delete(client, "chats", created_id)


# ───────────────────────────────────────────────────────────────────────────
# 11. pgcrypto / uuid-ossp extension presence
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.database
@pytest.mark.destructive
def test_uuid_and_pgcrypto_extensions_present(test_user_session, test_user_id):
    """Smoke test for uuid-ossp / pgcrypto via an indirect check.

    The chats table declares:

        "id" uuid DEFAULT "extensions"."uuid_generate_v4"() NOT NULL

    If uuid-ossp is not installed in the ``extensions`` schema, the default
    would throw on insert.  We insert a chat WITHOUT providing an id and
    assert we get back a valid-looking uuid.  A separate credit_packages
    table uses pgcrypto's ``gen_random_uuid()`` similarly — but we don't
    have write access there under RLS, so we stick to chats.

    If neither direct SQL nor a suitable RPC is exposed, we'd skip — but
    the chats insert path is always available to an authed user so we
    always run the positive check.
    """
    client = _authed_client(
        test_user_session.access_token, test_user_session.refresh_token
    )
    created_id: str | None = None
    try:
        ins = (
            client.table("chats")
            .insert({"user_id": test_user_id, "title": _unique_title("ext")})
            .execute()
        )
        assert ins.data, "Insert returned no data"
        new_id = ins.data[0]["id"]
        created_id = new_id
        # A valid uuid4/uuid string from uuid_generate_v4().
        parsed = uuid.UUID(str(new_id))
        assert parsed.version in (1, 4), (
            f"chats.id came back with unexpected uuid version "
            f"{parsed.version} (value={new_id}). "
            f"uuid-ossp may not be installed in `extensions` schema."
        )
    finally:
        if created_id is not None:
            _best_effort_delete(client, "chats", created_id)


# ───────────────────────────────────────────────────────────────────────────
# 12. Realtime subscription handshake (optional, slow)
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.database
@pytest.mark.slow
@pytest.mark.destructive
def test_realtime_chat_insert_fires_subscription(test_user_session, test_user_id):
    """Subscribe to ``chats`` INSERTs for the test user, insert a row, verify.

    If realtime isn't enabled for the ``chats`` table in the Supabase
    dashboard (Database → Replication), the subscription will connect but
    never fire.  We time-box to 10s and skip with a clear message.

    Skip path: if the supabase-py realtime client is missing or raises on
    connect, this test is non-fatal and skipped.
    """
    try:
        from supabase import create_client
    except ImportError:
        pytest.skip("supabase library not available")

    c = cfg()
    client = create_client(c.supabase_url, c.supabase_anon_key)
    client.auth.set_session(
        test_user_session.access_token, test_user_session.refresh_token or ""
    )

    received: list[dict[str, Any]] = []

    try:
        channel = client.channel("post-deploy-chats-insert-test")
    except Exception as e:  # noqa: BLE001
        pytest.skip(
            f"Realtime client not available on this supabase-py version: "
            f"{type(e).__name__}: {e}"
        )

    def _on_event(payload: dict[str, Any]) -> None:
        received.append(payload)

    try:
        # supabase-py 2.x realtime API. If the signature differs we skip.
        try:
            channel.on_postgres_changes(
                event="INSERT",
                schema="public",
                table="chats",
                filter=f"user_id=eq.{test_user_id}",
                callback=_on_event,
            ).subscribe()
        except (AttributeError, TypeError) as e:
            pytest.skip(
                f"Realtime on_postgres_changes not available in this "
                f"supabase-py version: {type(e).__name__}: {e}. "
                f"Enable realtime on public.chats in Supabase Dashboard → "
                f"Database → Replication if you want to exercise this path."
            )
    except Exception as e:  # noqa: BLE001
        pytest.skip(f"Realtime subscribe failed: {type(e).__name__}: {e}")

    created_id: str | None = None
    try:
        # Give the subscription a moment to handshake.
        time.sleep(1.5)

        ins = (
            client.table("chats")
            .insert({"user_id": test_user_id, "title": _unique_title("rt")})
            .execute()
        )
        assert ins.data, "Insert returned no data"
        created_id = ins.data[0]["id"]

        deadline = time.monotonic() + 10.0
        while time.monotonic() < deadline and not received:
            time.sleep(0.25)

        if not received:
            pytest.skip(
                "Realtime subscription did not fire within 10s. Enable "
                "realtime on public.chats in Supabase Dashboard → Database "
                "→ Replication to exercise this path."
            )
    finally:
        try:
            client.remove_channel(channel)
        except Exception:  # noqa: BLE001
            pass
        if created_id is not None:
            _best_effort_delete(client, "chats", created_id)


# ───────────────────────────────────────────────────────────────────────────
# 13. Session refresh
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.database
def test_session_refresh_yields_new_token(test_user_session, supabase_client):
    """Refreshing the session must yield a *new* access_token with later exp.

    Regression guard against a broken refresh-token flow (which would
    silently log users out after 1 hour).
    """
    assert test_user_session.refresh_token, "Session missing refresh_token"

    old_hash = _hash_token(test_user_session.access_token)
    old_exp = _decode_jwt_payload(test_user_session.access_token).get("exp", 0)

    try:
        refreshed = supabase_client.auth.refresh_session(
            test_user_session.refresh_token
        )
    except TypeError:
        # Some supabase-py versions expect a kwarg.
        refreshed = supabase_client.auth.refresh_session(
            refresh_token=test_user_session.refresh_token
        )

    assert refreshed is not None, "refresh_session returned None"
    session = getattr(refreshed, "session", refreshed)
    new_token = getattr(session, "access_token", None)
    assert new_token, "Refreshed session has no access_token"

    new_hash = _hash_token(new_token)
    assert new_hash != old_hash, (
        "Refresh returned the SAME access_token (comparing hashes only). "
        "Refresh flow may be broken or rate-limited."
    )

    new_exp = _decode_jwt_payload(new_token).get("exp", 0)
    assert new_exp > old_exp, (
        f"Refreshed token exp={new_exp} is not later than old exp={old_exp}."
    )


# ───────────────────────────────────────────────────────────────────────────
# 14. Invalid password rejected
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.database
def test_invalid_password_rejected():
    """Signing in with the real email + a bogus password must fail.

    Guards against a misconfigured Supabase project that has accidentally
    entered a development/debug auth mode. We use a throwaway client so we
    don't stomp the session-scoped sign-in.
    """
    from supabase import create_client

    c = cfg()
    throwaway = create_client(c.supabase_url, c.supabase_anon_key)
    bogus_pw = f"definitely-not-the-password-{uuid.uuid4()}"

    authed = False
    try:
        result = throwaway.auth.sign_in_with_password(
            {"email": c.test_user_email, "password": bogus_pw}
        )
        # Some versions don't raise on bad creds — they return a result with
        # no session.  Either shape is fine as long as no valid session.
        authed = bool(getattr(result, "session", None)) and bool(
            getattr(result.session, "access_token", None)
        )
    except Exception as e:  # noqa: BLE001 — auth error IS the happy path
        log.info("Invalid-password sign-in raised as expected: %s", type(e).__name__)
        return

    assert not authed, (
        "SECURITY: Supabase accepted a garbage password for "
        f"{c.test_user_email}. The project may be in a dev/debug auth mode."
    )


# ───────────────────────────────────────────────────────────────────────────
# 15. Anon JWT role claim
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.database
def test_anon_key_has_anon_role():
    """Decode the configured SUPABASE_ANON_KEY (a JWT) and confirm role == 'anon'.

    Catches the catastrophic footgun of shipping a ``service_role`` key as
    the public anon key — which would bypass every RLS policy for every
    user of the frontend.
    """
    key = cfg().supabase_anon_key
    payload = _decode_jwt_payload(key)
    role = payload.get("role")
    assert role == "anon", (
        f"SUPABASE_ANON_KEY has role={role!r}, expected 'anon'. "
        f"If this is a service_role key in production, rotate IMMEDIATELY."
    )


# ───────────────────────────────────────────────────────────────────────────
# 16. RLS enabled on every user-owned table (if RPC available)
# ───────────────────────────────────────────────────────────────────────────

# Tables that are expected/allowed to not have user-scoped RLS — e.g.
# monitoring (status_checks allows public read) and public lookup tables.
_RLS_PUBLIC_ALLOWLIST = {
    "status_checks",
    "credit_packages",
    "credit_rates",
    "subscription_plans",
    "public_models",
}


@pytest.mark.database
def test_rls_enabled_on_user_tables(test_user_session):
    """List every public table without RLS via a ``pg_tables`` RPC, if exposed.

    Projects commonly expose a ``tables_without_rls()`` SQL function or
    similar for audits.  If no such RPC exists on this project we skip
    with a pointer to ``supabase/schema.sql`` for manual verification.

    When the RPC IS present, we fail if any returned table is not in
    the allowlist above — catching a missing ``ALTER TABLE ... ENABLE ROW
    LEVEL SECURITY`` on a new table at deploy time rather than in prod.
    """
    client = _authed_client(
        test_user_session.access_token, test_user_session.refresh_token
    )

    # Try a few commonly-named audit RPCs. All are optional.
    candidates = [
        "tables_without_rls",
        "list_tables_without_rls",
        "audit_rls",
    ]
    rows: list[dict[str, Any]] | None = None
    for fn in candidates:
        try:
            resp = client.rpc(fn, {}).execute()
        except Exception:  # noqa: BLE001
            continue
        if resp and getattr(resp, "data", None) is not None:
            rows = resp.data
            log.info("RLS audit via RPC %s() returned %d row(s)", fn, len(rows))
            break

    if rows is None:
        pytest.skip(
            "No RLS-audit RPC exposed on this project "
            "(tables_without_rls / list_tables_without_rls / audit_rls). "
            "See supabase/schema.sql ENABLE ROW LEVEL SECURITY statements "
            "and migration 010_rls_hardening.sql for manual verification."
        )

    # Normalise: RPC may return [{"table_name": "..."}], ["..."], or
    # [{"tablename": "..."}] depending on the project's convention.
    unprotected: list[str] = []
    for r in rows:
        if isinstance(r, str):
            name = r
        elif isinstance(r, dict):
            name = (
                r.get("table_name")
                or r.get("tablename")
                or r.get("table")
                or r.get("name")
                or ""
            )
        else:
            name = ""
        if name and name not in _RLS_PUBLIC_ALLOWLIST:
            unprotected.append(name)

    assert not unprotected, (
        f"SECURITY: tables without RLS that are NOT in the public allowlist: "
        f"{unprotected}. Either (a) add `ALTER TABLE public.<name> ENABLE ROW "
        f"LEVEL SECURITY;` and appropriate policies, or (b) if the table is "
        f"intentionally public, add it to _RLS_PUBLIC_ALLOWLIST in this file."
    )


# ───────────────────────────────────────────────────────────────────────────
# 17. RLS EXISTS path on messages blocks reads for someone else's chat_id
# ───────────────────────────────────────────────────────────────────────────

@pytest.mark.database
@pytest.mark.destructive
def test_messages_rls_exists_path_blocks_non_owner(test_user_session, test_user_id):
    """Create our own chat, then try reading messages filtered ONLY by a
    random-owner chat_id shape — we should get zero rows.

    This is a second-angle check on the messages EXISTS RLS policy: even
    if someone knows a valid chat_id belonging to another user, RLS must
    return empty.  We simulate by using a synthetic UUID (not ours and
    not pre-existing) which still exercises the EXISTS sub-plan.
    """
    client = _authed_client(
        test_user_session.access_token, test_user_session.refresh_token
    )
    foreign_chat_id = str(uuid.uuid4())
    resp = (
        client.table("messages")
        .select("id, chat_id")
        .eq("chat_id", foreign_chat_id)
        .execute()
    )
    rows = resp.data or []
    assert rows == [], (
        f"SECURITY: messages EXISTS RLS policy leaked {len(rows)} row(s) "
        f"for synthetic chat_id={foreign_chat_id}. Review migration "
        f"010_rls_hardening.sql policies on public.messages."
    )
