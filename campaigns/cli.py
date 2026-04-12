#!/usr/bin/env python3
"""
Coasty Email Campaign CLI

Usage:
    python campaigns/cli.py create --name "v2 Launch" --subject "..." --template announcement
    python campaigns/cli.py list
    python campaigns/cli.py preview <campaign_id> --email test@example.com
    python campaigns/cli.py send <campaign_id>
    python campaigns/cli.py send <campaign_id> --dry-run
    python campaigns/cli.py pause <campaign_id>
    python campaigns/cli.py resume <campaign_id>
    python campaigns/cli.py schedule <campaign_id> --at "2026-03-25T09:00:00Z"
    python campaigns/cli.py cancel <campaign_id>
    python campaigns/cli.py stats <campaign_id>
    python campaigns/cli.py export <campaign_id> --format csv
    python campaigns/cli.py unsubscribes
    python campaigns/cli.py ab-winner <campaign_id>
    python campaigns/cli.py duplicate <campaign_id> --name "New campaign"
"""

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Ensure project root is on path
sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent))

from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.text import Text

console = Console()


def cmd_create(args):
    from campaigns import db, segments, templates
    from campaigns.ab_testing import assign_variants

    # Load template HTML
    if args.template:
        html = templates.load_template(args.template)
    elif args.html_file:
        html = Path(args.html_file).read_text(encoding="utf-8")
    else:
        console.print("[red]Must provide --template or --html-file[/red]")
        return

    data = {
        "name": args.name,
        "subject": args.subject,
        "subject_b": args.subject_b,
        "from_address": args.from_address,
        "from_name": args.from_name,
        "html_template": html,
        "status": "draft",
        "segment": args.segment,
        "segment_filter": json.loads(args.segment_filter) if args.segment_filter else {},
        "ab_split_pct": args.ab_split,
        "created_by": args.created_by or "cli",
    }

    campaign = db.create_campaign(data)
    campaign_id = campaign["id"]
    console.print(f"[green]Campaign created: {campaign_id}[/green]")

    # Resolve segment and add recipients
    console.print(f"Resolving segment '{args.segment}'...")
    users = segments.resolve_segment(args.segment, data["segment_filter"])
    console.print(f"Found {len(users)} recipients")

    recipients = [
        {
            "campaign_id": campaign_id,
            "user_id": u["user_id"],
            "email": u["email"],
            "variables": u.get("variables", {}),
            "status": "pending",
        }
        for u in users
    ]

    # A/B assignment
    if args.subject_b:
        recipients = assign_variants(recipients, args.ab_split)

    count = db.add_recipients(recipients)
    console.print(f"[green]Added {count} recipients[/green]")
    console.print(f"\nCampaign ID: [bold]{campaign_id}[/bold]")
    console.print(f"Next: test with `python campaigns/cli.py test --template announcement --email your@email.com --subject \"...\"`")
    console.print(f"Then send: `python campaigns/cli.py send {campaign_id}`")


def cmd_list(args):
    from campaigns import db

    campaigns = db.list_campaigns(status=args.status, limit=args.limit)
    if not campaigns:
        console.print("[dim]No campaigns found[/dim]")
        return

    table = Table(title="Email Campaigns")
    table.add_column("ID", style="dim", max_width=8)
    table.add_column("Name")
    table.add_column("Subject", max_width=40)
    table.add_column("Status")
    table.add_column("Segment")
    table.add_column("Created")

    for c in campaigns:
        status_color = {
            "draft": "yellow", "sending": "blue", "paused": "orange1",
            "completed": "green", "scheduled": "cyan", "cancelled": "red",
        }.get(c["status"], "white")
        table.add_row(
            c["id"][:8],
            c["name"],
            c["subject"][:40],
            f"[{status_color}]{c['status']}[/{status_color}]",
            c.get("segment", "all"),
            c.get("created_at", "")[:16],
        )

    console.print(table)


def cmd_test(args):
    """Send a test email directly — no Supabase tables needed."""
    from campaigns.sender import campaign_sender

    console.print(f"Sending test email to [bold]{args.email}[/bold]...")
    console.print(f"  Template: {args.template}")
    console.print(f"  Subject: {args.subject}")
    console.print(f"  From: {args.from_name} <{args.from_email}>")

    campaign_sender.send_test(
        to_email=args.email,
        subject=args.subject,
        template=args.template,
        from_name=args.from_name,
        from_email=args.from_email,
    )
    console.print(f"[green]Done! Check {args.email} inbox.[/green]")


def cmd_send(args):
    from campaigns import db
    from campaigns.sender import campaign_sender

    campaign = db.get_campaign(args.campaign_id)
    if not campaign:
        console.print(f"[red]Campaign {args.campaign_id} not found[/red]")
        return

    pending = db.count_recipients(args.campaign_id, status="pending")
    total = db.count_recipients(args.campaign_id)

    if args.dry_run:
        console.print(f"[yellow][DRY RUN] Would send to {pending}/{total} recipients[/yellow]")
        stats = campaign_sender.send_campaign(args.campaign_id, dry_run=True)
        console.print(f"Dry run complete: {stats}")
        return

    console.print(f"Sending campaign '{campaign['name']}' to {pending} pending recipients ({total} total)")
    if not args.yes:
        confirm = input("Continue? [y/N] ").strip().lower()
        if confirm != "y":
            console.print("[dim]Cancelled[/dim]")
            return

    stats = campaign_sender.send_campaign(args.campaign_id)
    console.print(Panel(
        f"Sent: [green]{stats['sent']}[/green]  Failed: [red]{stats['failed']}[/red]  Skipped: [yellow]{stats['skipped']}[/yellow]",
        title="Send Complete",
    ))


def cmd_pause(args):
    from campaigns import db
    db.update_campaign(args.campaign_id, {"status": "paused"})
    console.print(f"[yellow]Campaign {args.campaign_id} paused[/yellow]")


def cmd_resume(args):
    from campaigns import db
    db.update_campaign(args.campaign_id, {"status": "sending"})
    console.print(f"[blue]Campaign {args.campaign_id} resumed — run 'send' to continue[/blue]")


def cmd_schedule(args):
    from campaigns import db
    db.update_campaign(args.campaign_id, {"status": "scheduled", "scheduled_at": args.at})
    console.print(f"[cyan]Campaign {args.campaign_id} scheduled for {args.at}[/cyan]")


def cmd_cancel(args):
    from campaigns import db
    db.update_campaign(args.campaign_id, {"status": "cancelled"})
    console.print(f"[red]Campaign {args.campaign_id} cancelled[/red]")


def cmd_stats(args):
    from campaigns.analytics import get_campaign_stats, get_hourly_timeline

    stats = get_campaign_stats(args.campaign_id)

    # Main stats panel
    table = Table(title=f"Campaign: {stats.name}", show_header=False)
    table.add_column("Metric", style="bold")
    table.add_column("Value")
    table.add_row("Status", stats.status)
    table.add_row("Total Recipients", str(stats.total_recipients))
    table.add_row("Sent", f"[green]{stats.sent}[/green]")
    table.add_row("Opened", f"[cyan]{stats.opened}[/cyan] ({stats.open_rate:.1f}%)")
    table.add_row("Clicked", f"[blue]{stats.clicked}[/blue] ({stats.click_rate:.1f}%)")
    table.add_row("Bounced", f"[red]{stats.bounced}[/red] ({stats.bounce_rate:.1f}%)")
    table.add_row("Failed", f"[red]{stats.failed}[/red]")
    table.add_row("Unsubscribed", f"[yellow]{stats.unsubscribed}[/yellow] ({stats.unsubscribe_rate:.1f}%)")
    console.print(table)

    # Top links
    if stats.top_links:
        link_table = Table(title="Top Links")
        link_table.add_column("URL", max_width=60)
        link_table.add_column("Clicks", justify="right")
        for link in stats.top_links[:10]:
            link_table.add_row(link["url"][:60], str(link["clicks"]))
        console.print(link_table)

    # A/B stats
    if stats.ab_stats:
        ab_table = Table(title="A/B Test Results")
        ab_table.add_column("Variant")
        ab_table.add_column("Sent", justify="right")
        ab_table.add_column("Opened", justify="right")
        ab_table.add_column("Open Rate", justify="right")
        ab_table.add_column("Clicked", justify="right")
        ab_table.add_column("Click Rate", justify="right")
        for v in ("A", "B"):
            s = stats.ab_stats[v]
            ab_table.add_row(
                v, str(s["sent"]), str(s["opened"]),
                f"{s['open_rate']:.1f}%", str(s["clicked"]),
                f"{s['click_rate']:.1f}%",
            )
        console.print(ab_table)

    # Timeline
    if args.timeline:
        timeline = get_hourly_timeline(args.campaign_id)
        if timeline:
            t_table = Table(title="Hourly Timeline")
            t_table.add_column("Hour")
            t_table.add_column("Opens", justify="right")
            t_table.add_column("Clicks", justify="right")
            for t in timeline[-24:]:
                t_table.add_row(t["hour"], str(t["opens"]), str(t["clicks"]))
            console.print(t_table)


def cmd_export(args):
    from campaigns.analytics import export_recipients_csv

    csv_data = export_recipients_csv(args.campaign_id)
    out_path = args.output or f"campaign_{args.campaign_id[:8]}_export.csv"
    Path(out_path).write_text(csv_data, encoding="utf-8")
    console.print(f"[green]Exported to {out_path}[/green]")


def cmd_unsubscribes(args):
    from campaigns import db
    from campaigns.analytics import export_unsubscribes_csv

    if args.export:
        csv_data = export_unsubscribes_csv()
        Path(args.export).write_text(csv_data, encoding="utf-8")
        console.print(f"[green]Exported to {args.export}[/green]")
        return

    unsubs = db.list_unsubscribes(limit=args.limit)
    table = Table(title=f"Unsubscribes ({len(unsubs)})")
    table.add_column("Email")
    table.add_column("Reason")
    table.add_column("Date")
    for u in unsubs:
        table.add_row(u["email"], u.get("reason", ""), u.get("created_at", "")[:16])
    console.print(table)


def cmd_ab_winner(args):
    from campaigns.ab_testing import determine_winner

    result = determine_winner(args.campaign_id)
    if result["winner"]:
        console.print(f"[green bold]Winner: Variant {result['winner']}[/green bold]")
    else:
        console.print("[yellow]No clear winner[/yellow]")
    console.print(f"Reason: {result['reason']}")
    if result.get("stats"):
        for v in ("A", "B"):
            s = result["stats"][v]
            console.print(f"  Variant {v}: {s['sent']} sent, {s['open_rate']:.1f}% open rate")


def cmd_duplicate(args):
    from campaigns import db

    campaign = db.get_campaign(args.campaign_id)
    if not campaign:
        console.print(f"[red]Campaign {args.campaign_id} not found[/red]")
        return

    new_data = {k: v for k, v in campaign.items() if k not in ("id", "created_at", "updated_at", "started_at", "completed_at")}
    new_data["name"] = args.name or f"{campaign['name']} (copy)"
    new_data["status"] = "draft"

    new_campaign = db.create_campaign(new_data)
    console.print(f"[green]Duplicated to {new_campaign['id']}[/green]")


def cmd_delete(args):
    from campaigns import db

    campaign = db.get_campaign(args.campaign_id)
    if not campaign:
        console.print(f"[red]Campaign {args.campaign_id} not found[/red]")
        return

    if not args.yes:
        confirm = input(f"Delete campaign '{campaign['name']}'? This cannot be undone. [y/N] ").strip().lower()
        if confirm != "y":
            console.print("[dim]Cancelled[/dim]")
            return

    db.delete_campaign(args.campaign_id)
    console.print(f"[red]Campaign {args.campaign_id} deleted[/red]")


def main():
    parser = argparse.ArgumentParser(description="Coasty Email Campaign Manager")
    parser.add_argument("--log-level", default="INFO", choices=["DEBUG", "INFO", "WARNING", "ERROR"])
    sub = parser.add_subparsers(dest="command", required=True)

    # create
    p = sub.add_parser("create", help="Create a new campaign")
    p.add_argument("--name", required=True)
    p.add_argument("--subject", required=True)
    p.add_argument("--subject-b", dest="subject_b", help="A/B test subject line")
    p.add_argument("--template", help="Template name from campaigns/templates/")
    p.add_argument("--html-file", dest="html_file", help="Path to HTML file")
    p.add_argument("--segment", default="all", choices=["all", "active", "pro", "starter", "enterprise", "basic", "free", "custom"])
    p.add_argument("--segment-filter", dest="segment_filter", help="JSON filter for custom segment")
    p.add_argument("--from-address", dest="from_address", default="hello@coasty.ai")
    p.add_argument("--from-name", dest="from_name", default="Founders from Coasty - #1 Computer Use OS World")
    p.add_argument("--ab-split", dest="ab_split", type=int, default=50, help="% for variant B")
    p.add_argument("--created-by", dest="created_by")

    # list
    p = sub.add_parser("list", help="List campaigns")
    p.add_argument("--status", choices=["draft", "sending", "paused", "completed", "scheduled", "cancelled"])
    p.add_argument("--limit", type=int, default=50)

    # test
    p = sub.add_parser("test", help="Send a test email (no Supabase needed)")
    p.add_argument("--email", required=True, help="Recipient email address")
    p.add_argument("--subject", default="Apologies from Coasty Desktop v2.0.0 - A Fresh Start + Remote Phone Control")
    p.add_argument("--template", default="announcement", help="Template name from campaigns/templates/")
    p.add_argument("--from-name", dest="from_name", default="Founders from Coasty - #1 Computer Use OS World")
    p.add_argument("--from-email", dest="from_email", default="hello@coasty.ai")

    # send
    p = sub.add_parser("send", help="Send a campaign")
    p.add_argument("campaign_id")
    p.add_argument("--dry-run", dest="dry_run", action="store_true")
    p.add_argument("-y", "--yes", action="store_true", help="Skip confirmation")

    # pause / resume / schedule / cancel
    for cmd_name in ("pause", "resume", "cancel"):
        p = sub.add_parser(cmd_name, help=f"{cmd_name.title()} a campaign")
        p.add_argument("campaign_id")

    p = sub.add_parser("schedule", help="Schedule a campaign")
    p.add_argument("campaign_id")
    p.add_argument("--at", required=True, help="ISO datetime (e.g. 2026-03-25T09:00:00Z)")

    # stats
    p = sub.add_parser("stats", help="Show campaign statistics")
    p.add_argument("campaign_id")
    p.add_argument("--timeline", action="store_true", help="Show hourly timeline")

    # export
    p = sub.add_parser("export", help="Export recipient data as CSV")
    p.add_argument("campaign_id")
    p.add_argument("--output", "-o", help="Output file path")

    # unsubscribes
    p = sub.add_parser("unsubscribes", help="List or export unsubscribes")
    p.add_argument("--export", help="Export to CSV file path")
    p.add_argument("--limit", type=int, default=100)

    # ab-winner
    p = sub.add_parser("ab-winner", help="Determine A/B test winner")
    p.add_argument("campaign_id")

    # duplicate
    p = sub.add_parser("duplicate", help="Duplicate a campaign")
    p.add_argument("campaign_id")
    p.add_argument("--name", help="Name for the copy")

    # delete
    p = sub.add_parser("delete", help="Delete a campaign")
    p.add_argument("campaign_id")
    p.add_argument("-y", "--yes", action="store_true")

    args = parser.parse_args()
    logging.basicConfig(level=getattr(logging, args.log_level), format="%(levelname)s: %(message)s")

    commands = {
        "create": cmd_create, "list": cmd_list, "test": cmd_test,
        "send": cmd_send, "pause": cmd_pause, "resume": cmd_resume,
        "schedule": cmd_schedule, "cancel": cmd_cancel, "stats": cmd_stats,
        "export": cmd_export, "unsubscribes": cmd_unsubscribes,
        "ab-winner": cmd_ab_winner, "duplicate": cmd_duplicate, "delete": cmd_delete,
    }
    commands[args.command](args)


if __name__ == "__main__":
    main()
