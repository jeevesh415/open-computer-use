"""Campaign analytics and reporting."""

import csv
import io
import logging
from typing import Any, Dict, List, Optional

from . import db
from .ab_testing import get_variant_stats, determine_winner
from .models import CampaignStats

logger = logging.getLogger(__name__)


def get_campaign_stats(campaign_id: str) -> CampaignStats:
    """Get comprehensive stats for a campaign."""
    campaign = db.get_campaign(campaign_id)
    if not campaign:
        raise ValueError(f"Campaign {campaign_id} not found")

    recipients = db.get_recipients(campaign_id, limit=100000)
    total = len(recipients)

    counts = {"pending": 0, "queued": 0, "sent": 0, "delivered": 0,
              "opened": 0, "clicked": 0, "bounced": 0, "failed": 0, "unsubscribed": 0}
    for r in recipients:
        s = r.get("status", "pending")
        counts[s] = counts.get(s, 0) + 1

    # "sent" includes all sent+ statuses for rate calculation
    total_sent = counts["sent"] + counts["delivered"] + counts["opened"] + counts["clicked"]
    total_opened = counts["opened"] + counts["clicked"]
    total_clicked = counts["clicked"]

    link_stats = db.get_link_stats(campaign_id)

    # A/B stats if campaign has subject_b
    ab_stats = None
    if campaign.get("subject_b"):
        ab_stats = get_variant_stats(campaign_id)

    return CampaignStats(
        campaign_id=campaign_id,
        name=campaign["name"],
        subject=campaign["subject"],
        status=campaign["status"],
        total_recipients=total,
        sent=total_sent,
        delivered=counts["delivered"] + counts["opened"] + counts["clicked"],
        opened=total_opened,
        clicked=total_clicked,
        bounced=counts["bounced"],
        failed=counts["failed"],
        unsubscribed=counts["unsubscribed"],
        open_rate=(total_opened / total_sent * 100) if total_sent > 0 else 0,
        click_rate=(total_clicked / total_sent * 100) if total_sent > 0 else 0,
        bounce_rate=(counts["bounced"] / total_sent * 100) if total_sent > 0 else 0,
        unsubscribe_rate=(counts["unsubscribed"] / total * 100) if total > 0 else 0,
        top_links=link_stats[:10],
        ab_stats=ab_stats,
    )


def get_hourly_timeline(campaign_id: str) -> List[Dict[str, Any]]:
    """Get hourly open/click timeline."""
    events = db.get_events(campaign_id, limit=100000)
    hourly: Dict[str, Dict[str, int]] = {}

    for e in events:
        hour = e.get("created_at", "")[:13]  # "2026-03-23T14"
        if hour not in hourly:
            hourly[hour] = {"opens": 0, "clicks": 0}
        if e["event_type"] == "opened":
            hourly[hour]["opens"] += 1
        elif e["event_type"] == "clicked":
            hourly[hour]["clicks"] += 1

    return [
        {"hour": h, "opens": v["opens"], "clicks": v["clicks"]}
        for h, v in sorted(hourly.items())
    ]


def export_recipients_csv(campaign_id: str) -> str:
    """Export recipient-level data as CSV string."""
    recipients = db.get_recipients(campaign_id, limit=100000)
    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=["email", "status", "ab_variant", "sent_at", "opened_at", "clicked_at", "error_message"],
    )
    writer.writeheader()
    for r in recipients:
        writer.writerow({
            "email": r["email"],
            "status": r["status"],
            "ab_variant": r.get("ab_variant", "A"),
            "sent_at": r.get("sent_at", ""),
            "opened_at": r.get("opened_at", ""),
            "clicked_at": r.get("clicked_at", ""),
            "error_message": r.get("error_message", ""),
        })
    return output.getvalue()


def export_unsubscribes_csv() -> str:
    """Export unsubscribe list as CSV."""
    unsubs = db.list_unsubscribes(limit=100000)
    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["email", "campaign_id", "reason", "created_at"])
    writer.writeheader()
    for u in unsubs:
        writer.writerow({
            "email": u["email"],
            "campaign_id": u.get("campaign_id", ""),
            "reason": u.get("reason", ""),
            "created_at": u.get("created_at", ""),
        })
    return output.getvalue()
