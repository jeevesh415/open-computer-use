"""Supabase database operations for campaigns."""

import logging
from typing import Any, Dict, List, Optional

from supabase import create_client, Client

from .config import settings

logger = logging.getLogger(__name__)

_client: Optional[Client] = None


def get_db() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE)
    return _client


# ── Campaigns ──


def create_campaign(data: Dict[str, Any]) -> Dict[str, Any]:
    result = get_db().table("email_campaigns").insert(data).execute()
    return result.data[0]


def get_campaign(campaign_id: str) -> Optional[Dict[str, Any]]:
    result = get_db().table("email_campaigns").select("*").eq("id", campaign_id).execute()
    return result.data[0] if result.data else None


def list_campaigns(status: Optional[str] = None, limit: int = 50) -> List[Dict[str, Any]]:
    q = get_db().table("email_campaigns").select("*").order("created_at", desc=True).limit(limit)
    if status:
        q = q.eq("status", status)
    return q.execute().data


def update_campaign(campaign_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
    result = get_db().table("email_campaigns").update(data).eq("id", campaign_id).execute()
    return result.data[0] if result.data else {}


def delete_campaign(campaign_id: str):
    get_db().table("email_campaigns").delete().eq("id", campaign_id).execute()


# ── Recipients ──


def add_recipients(recipients: List[Dict[str, Any]]) -> int:
    """Bulk insert recipients. Returns count inserted."""
    if not recipients:
        return 0
    # Supabase insert supports upsert with on_conflict
    batch_size = 500
    total = 0
    for i in range(0, len(recipients), batch_size):
        batch = recipients[i : i + batch_size]
        get_db().table("email_recipients").upsert(
            batch, on_conflict="campaign_id,email"
        ).execute()
        total += len(batch)
    return total


def get_recipients(
    campaign_id: str,
    status: Optional[str] = None,
    limit: int = 1000,
    offset: int = 0,
) -> List[Dict[str, Any]]:
    q = (
        get_db()
        .table("email_recipients")
        .select("*")
        .eq("campaign_id", campaign_id)
        .order("created_at")
        .range(offset, offset + limit - 1)
    )
    if status:
        q = q.eq("status", status)
    return q.execute().data


def get_pending_recipients(campaign_id: str, batch_size: int = 100) -> List[Dict[str, Any]]:
    return (
        get_db()
        .table("email_recipients")
        .select("*")
        .eq("campaign_id", campaign_id)
        .in_("status", ["pending", "queued"])
        .order("created_at")
        .limit(batch_size)
        .execute()
        .data
    )


def update_recipient(recipient_id: str, data: Dict[str, Any]):
    get_db().table("email_recipients").update(data).eq("id", recipient_id).execute()


def get_recipient(recipient_id: str) -> Optional[Dict[str, Any]]:
    result = get_db().table("email_recipients").select("*").eq("id", recipient_id).execute()
    return result.data[0] if result.data else None


def count_recipients(campaign_id: str, status: Optional[str] = None) -> int:
    q = get_db().table("email_recipients").select("id", count="exact").eq("campaign_id", campaign_id)
    if status:
        q = q.eq("status", status)
    return q.execute().count or 0


# ── Events ──


def insert_event(data: Dict[str, Any]):
    get_db().table("email_events").insert(data).execute()


def get_events(
    campaign_id: str,
    event_type: Optional[str] = None,
    limit: int = 1000,
) -> List[Dict[str, Any]]:
    q = (
        get_db()
        .table("email_events")
        .select("*")
        .eq("campaign_id", campaign_id)
        .order("created_at", desc=True)
        .limit(limit)
    )
    if event_type:
        q = q.eq("event_type", event_type)
    return q.execute().data


def get_link_stats(campaign_id: str) -> List[Dict[str, Any]]:
    """Get click counts per link URL for a campaign."""
    events = (
        get_db()
        .table("email_events")
        .select("link_url")
        .eq("campaign_id", campaign_id)
        .eq("event_type", "clicked")
        .execute()
        .data
    )
    counts: Dict[str, int] = {}
    for e in events:
        url = e.get("link_url", "unknown")
        counts[url] = counts.get(url, 0) + 1
    return sorted(
        [{"url": url, "clicks": c} for url, c in counts.items()],
        key=lambda x: x["clicks"],
        reverse=True,
    )


# ── Unsubscribes ──


def is_unsubscribed(email: str) -> bool:
    result = (
        get_db()
        .table("email_unsubscribes")
        .select("id")
        .eq("email", email)
        .limit(1)
        .execute()
    )
    return len(result.data) > 0


def add_unsubscribe(email: str, campaign_id: Optional[str] = None, reason: Optional[str] = None):
    get_db().table("email_unsubscribes").upsert(
        {"email": email, "campaign_id": campaign_id, "reason": reason},
        on_conflict="email",
    ).execute()


def list_unsubscribes(limit: int = 1000) -> List[Dict[str, Any]]:
    return (
        get_db()
        .table("email_unsubscribes")
        .select("*")
        .order("created_at", desc=True)
        .limit(limit)
        .execute()
        .data
    )


# ── Users (read-only for segmentation) ──


def get_all_user_emails() -> List[Dict[str, Any]]:
    """Fetch ALL users from Supabase Auth (paginated, 1000 per page)."""
    db = get_db()
    all_users = []
    page = 1
    per_page = 1000
    while True:
        batch = db.auth.admin.list_users(page=page, per_page=per_page)
        if not batch:
            break
        all_users.extend(batch)
        if len(batch) < per_page:
            break
        page += 1

    return [
        {
            "user_id": u.id,
            "email": u.email,
            "created_at": str(u.created_at) if u.created_at else None,
            "last_sign_in_at": str(u.last_sign_in_at) if u.last_sign_in_at else None,
            "user_metadata": u.user_metadata or {},
        }
        for u in all_users
        if u.email
    ]
