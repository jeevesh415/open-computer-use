"""Rate-limited SMTP sending engine for WorkMail."""

import logging
import smtplib
import time
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any, Dict, List, Optional

from . import db
from .config import settings

logger = logging.getLogger(__name__)


class TokenBucket:
    """Simple token bucket rate limiter."""

    def __init__(self, rate_per_minute: int):
        self.rate = rate_per_minute
        self.tokens = rate_per_minute
        self.last_refill = time.monotonic()
        self.interval = 60.0 / rate_per_minute

    def wait(self):
        """Block until a token is available."""
        now = time.monotonic()
        elapsed = now - self.last_refill
        self.tokens = min(self.rate, self.tokens + elapsed * (self.rate / 60.0))
        self.last_refill = now

        if self.tokens < 1:
            wait_time = (1 - self.tokens) * (60.0 / self.rate)
            logger.debug(f"Rate limiter: waiting {wait_time:.1f}s")
            time.sleep(wait_time)
            self.tokens = 0
            self.last_refill = time.monotonic()
        else:
            self.tokens -= 1


class CampaignSender:
    """Sends campaign emails via WorkMail SMTP with rate limiting."""

    def __init__(self):
        self.bucket = TokenBucket(settings.SEND_RATE_PER_MINUTE)
        self._smtp: Optional[smtplib.SMTP_SSL] = None

    def _connect(self):
        if self._smtp is not None:
            try:
                self._smtp.noop()
                return
            except Exception:
                self._smtp = None

        logger.info(f"Connecting to {settings.WORKMAIL_SMTP_HOST}:{settings.WORKMAIL_SMTP_PORT}")
        self._smtp = smtplib.SMTP_SSL(settings.WORKMAIL_SMTP_HOST, settings.WORKMAIL_SMTP_PORT)
        self._smtp.login(settings.CAMPAIGN_FROM_EMAIL, settings.CAMPAIGN_FROM_PASSWORD)
        logger.info("SMTP connected")

    def _disconnect(self):
        if self._smtp:
            try:
                self._smtp.quit()
            except Exception:
                pass
            self._smtp = None

    def send_campaign(
        self,
        campaign_id: str,
        dry_run: bool = False,
        test_email: Optional[str] = None,
    ) -> Dict[str, int]:
        """Send a campaign to all pending recipients.

        Returns dict with counts: sent, failed, skipped
        """
        campaign = db.get_campaign(campaign_id)
        if not campaign:
            raise ValueError(f"Campaign {campaign_id} not found")

        if campaign["status"] not in ("draft", "sending", "paused", "scheduled"):
            raise ValueError(f"Campaign status '{campaign['status']}' cannot be sent")

        stats = {"sent": 0, "failed": 0, "skipped": 0}

        # Update status to sending
        if not dry_run:
            now = datetime.now(timezone.utc).isoformat()
            db.update_campaign(campaign_id, {"status": "sending", "started_at": now})

        if not dry_run:
            self._connect()

        try:
            while True:
                # Check if campaign was paused/cancelled
                if not dry_run:
                    current = db.get_campaign(campaign_id)
                    if current and current["status"] in ("paused", "cancelled"):
                        logger.info(f"Campaign {campaign_id} was {current['status']}, stopping")
                        break

                batch = db.get_pending_recipients(campaign_id, batch_size=50)
                if not batch:
                    break

                for recipient in batch:
                    # Skip unsubscribed
                    if db.is_unsubscribed(recipient["email"]):
                        db.update_recipient(recipient["id"], {"status": "unsubscribed"})
                        stats["skipped"] += 1
                        continue

                    # Choose subject (A/B)
                    subject = campaign["subject"]
                    if recipient.get("ab_variant") == "B" and campaign.get("subject_b"):
                        subject = campaign["subject_b"]

                    try:
                        # Render as plain text — looks like a personal email
                        body = campaign["html_template"]
                        variables = recipient.get("variables", {})
                        for key, val in variables.items():
                            body = body.replace("{{" + key + "}}", str(val))

                        if dry_run:
                            if test_email:
                                self._connect()
                                self._send_one(test_email, subject, body, body, campaign)
                                self._disconnect()
                                logger.info(f"[DRY RUN] Sent test to {test_email}")
                                return {"sent": 1, "failed": 0, "skipped": 0}
                            logger.info(f"[DRY RUN] Would send to {recipient['email']}")
                            stats["sent"] += 1
                            continue

                        self.bucket.wait()
                        self._send_one(recipient["email"], subject, body, body, campaign)

                        now = datetime.now(timezone.utc).isoformat()
                        db.update_recipient(recipient["id"], {"status": "sent", "sent_at": now})
                        db.insert_event({
                            "campaign_id": campaign_id,
                            "recipient_id": recipient["id"],
                            "event_type": "sent",
                        })
                        stats["sent"] += 1
                        logger.info(f"[{stats['sent']}] Sent to {recipient['email']}")

                        # Reconnect every 20 emails to avoid WorkMail "too many commands"
                        if stats["sent"] % 20 == 0:
                            self._disconnect()
                            time.sleep(3)
                            self._connect()

                    except smtplib.SMTPRecipientsRefused as e:
                        db.update_recipient(recipient["id"], {
                            "status": "bounced",
                            "error_message": str(e)[:500],
                        })
                        db.insert_event({
                            "campaign_id": campaign_id,
                            "recipient_id": recipient["id"],
                            "event_type": "bounced",
                            "metadata": {"error": str(e)[:500]},
                        })
                        stats["failed"] += 1
                        logger.warning(f"Bounced: {recipient['email']}: {e}")

                    except Exception as e:
                        err_str = str(e).lower()
                        # "too many commands" / throttle — reconnect and retry once
                        if "too many" in err_str or "421" in err_str or "throttl" in err_str:
                            logger.warning(f"Throttled on {recipient['email']}, reconnecting and retrying...")
                            self._disconnect()
                            time.sleep(10)
                            self._connect()
                            try:
                                self._send_one(recipient["email"], subject, body, body, campaign)
                                now = datetime.now(timezone.utc).isoformat()
                                db.update_recipient(recipient["id"], {"status": "sent", "sent_at": now})
                                db.insert_event({
                                    "campaign_id": campaign_id,
                                    "recipient_id": recipient["id"],
                                    "event_type": "sent",
                                })
                                stats["sent"] += 1
                                logger.info(f"[{stats['sent']}] Sent to {recipient['email']} (retry)")
                                continue
                            except Exception as retry_e:
                                logger.error(f"Retry also failed for {recipient['email']}: {retry_e}")
                                e = retry_e

                        db.update_recipient(recipient["id"], {
                            "status": "failed",
                            "error_message": str(e)[:500],
                        })
                        db.insert_event({
                            "campaign_id": campaign_id,
                            "recipient_id": recipient["id"],
                            "event_type": "failed",
                            "metadata": {"error": str(e)[:500]},
                        })
                        stats["failed"] += 1
                        logger.error(f"Failed: {recipient['email']}: {e}")

                        # Reconnect on SMTP errors
                        if isinstance(e, (smtplib.SMTPServerDisconnected, smtplib.SMTPException)):
                            self._disconnect()
                            time.sleep(5)
                            self._connect()

        finally:
            self._disconnect()

            if not dry_run:
                remaining = db.count_recipients(campaign_id, status="pending")
                if remaining == 0:
                    now = datetime.now(timezone.utc).isoformat()
                    db.update_campaign(campaign_id, {"status": "completed", "completed_at": now})
                    logger.info(f"Campaign {campaign_id} completed")

        logger.info(f"Send complete: {stats}")
        return stats

    def _send_one(
        self,
        to_email: str,
        subject: str,
        html: str,
        plain: str,
        campaign: Dict[str, Any],
    ):
        """Send a single email as plain text — looks like a real human sent it."""
        from_addr = campaign.get("from_address", settings.CAMPAIGN_FROM_EMAIL)
        from_name = campaign.get("from_name", settings.CAMPAIGN_FROM_NAME)

        # Plain text only — no HTML wrapper, no styled templates.
        # This looks exactly like a personal email from a real person.
        msg = MIMEText(plain, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"] = f"{from_name} <{from_addr}>"
        msg["To"] = to_email
        msg["Reply-To"] = from_addr

        self._smtp.sendmail(from_addr, to_email, msg.as_string())

    def send_test(self, to_email: str, subject: str, template: str, from_name: str = None, from_email: str = None):
        """Send a single test email directly — no Supabase needed.

        Args:
            to_email: Recipient email
            subject: Email subject line
            template: Template name (loaded from campaigns/templates/)
            from_name: Sender display name
            from_email: Sender email address
        """
        from .templates import load_template

        from_addr = from_email or settings.CAMPAIGN_FROM_EMAIL
        sender_name = from_name or settings.CAMPAIGN_FROM_NAME
        body = load_template(template)

        msg = MIMEText(body, "plain", "utf-8")
        msg["Subject"] = subject
        msg["From"] = f"{sender_name} <{from_addr}>"
        msg["To"] = to_email
        msg["Reply-To"] = from_addr

        self._connect()
        try:
            self._smtp.sendmail(from_addr, to_email, msg.as_string())
        finally:
            self._disconnect()


# Module-level singleton
campaign_sender = CampaignSender()
