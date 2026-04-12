"""Recipient segmentation — resolves segment names to user lists."""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from . import db

logger = logging.getLogger(__name__)


def resolve_segment(
    segment: str, segment_filter: Dict[str, Any] = None
) -> List[Dict[str, Any]]:
    """Resolve a segment name to a list of recipients.

    Returns list of dicts with keys: user_id, email, variables
    """
    all_users = db.get_all_user_emails()
    unsubscribed = {u["email"] for u in db.list_unsubscribes(limit=10000)}

    # Filter out unsubscribed
    users = [u for u in all_users if u["email"] not in unsubscribed]

    if segment == "all":
        filtered = users

    elif segment == "active":
        cutoff = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        filtered = [
            u for u in users
            if u.get("last_sign_in_at") and u["last_sign_in_at"] >= cutoff
        ]

    elif segment in ("pro", "starter", "enterprise", "basic", "free"):
        filtered = [
            u for u in users
            if (u.get("user_metadata") or {}).get("plan", "free") == segment
        ]

    elif segment == "custom" and segment_filter:
        filtered = _apply_custom_filter(users, segment_filter)

    else:
        logger.warning(f"Unknown segment '{segment}', falling back to 'all'")
        filtered = users

    logger.info(f"Segment '{segment}': {len(filtered)} recipients (excluded {len(unsubscribed)} unsubscribed)")

    return [
        {
            "user_id": u["user_id"],
            "email": u["email"],
            "variables": {
                "email": u["email"],
                "plan": (u.get("user_metadata") or {}).get("plan", "free"),
                "first_name": (u.get("user_metadata") or {}).get("first_name", ""),
                "full_name": (u.get("user_metadata") or {}).get("full_name", ""),
            },
        }
        for u in filtered
    ]


def _apply_custom_filter(
    users: List[Dict[str, Any]], filters: Dict[str, Any]
) -> List[Dict[str, Any]]:
    """Apply custom JSONB filters to user list.

    Supported filters:
        plan: str — match user plan
        created_after: str — ISO date, users created after
        created_before: str — ISO date, users created before
        signed_in_after: str — ISO date, users active after
        emails: list[str] — explicit email list
    """
    result = users

    if "plan" in filters:
        result = [
            u for u in result
            if (u.get("user_metadata") or {}).get("plan") == filters["plan"]
        ]

    if "created_after" in filters:
        result = [
            u for u in result
            if u.get("created_at") and u["created_at"] >= filters["created_after"]
        ]

    if "created_before" in filters:
        result = [
            u for u in result
            if u.get("created_at") and u["created_at"] < filters["created_before"]
        ]

    if "signed_in_after" in filters:
        result = [
            u for u in result
            if u.get("last_sign_in_at") and u["last_sign_in_at"] >= filters["signed_in_after"]
        ]

    if "emails" in filters:
        email_set = set(filters["emails"])
        result = [u for u in result if u["email"] in email_set]

    return result
