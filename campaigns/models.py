"""Pydantic data models for the campaign system."""

from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field


class Campaign(BaseModel):
    id: Optional[str] = None
    name: str
    subject: str
    subject_b: Optional[str] = None
    from_address: str = "hello@coasty.ai"
    from_name: str = "Coasty"
    html_template: str = ""
    text_template: Optional[str] = None
    status: str = "draft"
    segment: str = "all"
    segment_filter: Dict[str, Any] = {}
    ab_split_pct: int = 50
    scheduled_at: Optional[str] = None
    started_at: Optional[str] = None
    completed_at: Optional[str] = None
    created_by: Optional[str] = None
    metadata: Dict[str, Any] = {}
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class Recipient(BaseModel):
    id: Optional[str] = None
    campaign_id: str
    user_id: Optional[str] = None
    email: str
    variables: Dict[str, Any] = {}
    ab_variant: str = "A"
    status: str = "pending"
    sent_at: Optional[str] = None
    opened_at: Optional[str] = None
    clicked_at: Optional[str] = None
    error_message: Optional[str] = None


class Event(BaseModel):
    id: Optional[str] = None
    campaign_id: str
    recipient_id: str
    event_type: str
    link_url: Optional[str] = None
    user_agent: Optional[str] = None
    ip_address: Optional[str] = None
    metadata: Dict[str, Any] = {}
    created_at: Optional[str] = None


class CampaignStats(BaseModel):
    campaign_id: str
    name: str
    subject: str
    status: str
    total_recipients: int = 0
    sent: int = 0
    delivered: int = 0
    opened: int = 0
    clicked: int = 0
    bounced: int = 0
    failed: int = 0
    unsubscribed: int = 0
    open_rate: float = 0.0
    click_rate: float = 0.0
    bounce_rate: float = 0.0
    unsubscribe_rate: float = 0.0
    top_links: List[Dict[str, Any]] = []
    ab_stats: Optional[Dict[str, Any]] = None
