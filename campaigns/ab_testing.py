"""A/B testing — split recipients and determine winners."""

import math
import random
from typing import Any, Dict, List, Optional

from . import db


def assign_variants(
    recipients: List[Dict[str, Any]], split_pct: int = 50
) -> List[Dict[str, Any]]:
    """Assign A/B variants to recipients.

    split_pct is the percentage that gets variant B.
    """
    shuffled = list(recipients)
    random.shuffle(shuffled)
    split_idx = int(len(shuffled) * (1 - split_pct / 100))
    for i, r in enumerate(shuffled):
        r["ab_variant"] = "A" if i < split_idx else "B"
    return shuffled


def get_variant_stats(campaign_id: str) -> Dict[str, Any]:
    """Get open/click rates per A/B variant."""
    all_recipients = db.get_recipients(campaign_id, limit=100000)

    stats = {"A": _empty_stats(), "B": _empty_stats()}
    for r in all_recipients:
        v = r.get("ab_variant", "A")
        if v not in stats:
            continue
        stats[v]["total"] += 1
        s = r.get("status", "pending")
        if s in ("sent", "delivered", "opened", "clicked"):
            stats[v]["sent"] += 1
        if s in ("opened", "clicked"):
            stats[v]["opened"] += 1
        if s == "clicked":
            stats[v]["clicked"] += 1

    for v in stats:
        s = stats[v]
        s["open_rate"] = (s["opened"] / s["sent"] * 100) if s["sent"] > 0 else 0
        s["click_rate"] = (s["clicked"] / s["sent"] * 100) if s["sent"] > 0 else 0

    return stats


def determine_winner(campaign_id: str) -> Dict[str, Any]:
    """Determine A/B winner by open rate with significance test."""
    stats = get_variant_stats(campaign_id)
    a, b = stats["A"], stats["B"]

    if a["sent"] == 0 or b["sent"] == 0:
        return {"winner": None, "reason": "Not enough data", "stats": stats}

    p_a = a["opened"] / a["sent"]
    p_b = b["opened"] / b["sent"]

    # Two-proportion z-test
    p_pool = (a["opened"] + b["opened"]) / (a["sent"] + b["sent"]) if (a["sent"] + b["sent"]) > 0 else 0
    se = math.sqrt(p_pool * (1 - p_pool) * (1 / a["sent"] + 1 / b["sent"])) if p_pool > 0 and p_pool < 1 else 0
    z = (p_a - p_b) / se if se > 0 else 0
    significant = abs(z) > 1.96  # 95% confidence

    if not significant:
        winner = None
        reason = f"No significant difference (z={z:.2f}, p>0.05)"
    elif p_a > p_b:
        winner = "A"
        reason = f"Variant A wins ({a['open_rate']:.1f}% vs {b['open_rate']:.1f}%, z={z:.2f})"
    else:
        winner = "B"
        reason = f"Variant B wins ({b['open_rate']:.1f}% vs {a['open_rate']:.1f}%, z={z:.2f})"

    return {"winner": winner, "reason": reason, "z_score": z, "significant": significant, "stats": stats}


def _empty_stats() -> Dict[str, Any]:
    return {"total": 0, "sent": 0, "opened": 0, "clicked": 0, "open_rate": 0, "click_rate": 0}
