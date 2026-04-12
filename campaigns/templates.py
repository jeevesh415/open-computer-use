"""HTML template engine with tracking injection."""

import base64
import re
from pathlib import Path
from typing import Dict

from jinja2 import Environment, FileSystemLoader, BaseLoader

from .config import settings

_templates_dir = Path(__file__).parent / "templates"
_jinja_env = Environment(
    loader=FileSystemLoader(str(_templates_dir)),
    autoescape=False,
)


def load_template(template_name: str) -> str:
    """Load an HTML template file from templates/ directory."""
    if not template_name.endswith(".html"):
        template_name += ".html"
    return _jinja_env.get_template(template_name).render()


def render_email(
    html: str,
    recipient_id: str,
    campaign_id: str,
    variables: Dict[str, str] = None,
) -> str:
    """Render an email with variable substitution and tracking injection.

    1. Substitutes {{variable}} placeholders
    2. Rewrites links for click tracking
    3. Appends open tracking pixel
    4. Injects unsubscribe link
    """
    variables = variables or {}
    base_url = settings.BACKEND_PUBLIC_URL.rstrip("/")

    # Build tracking URLs
    unsubscribe_url = f"{base_url}/api/t/u/{recipient_id}"
    variables["unsubscribe_url"] = unsubscribe_url

    # Substitute variables using Jinja2
    tpl = Environment(loader=BaseLoader()).from_string(html)
    rendered = tpl.render(**variables)

    # Rewrite links for click tracking
    rendered = _inject_click_tracking(rendered, recipient_id, base_url)

    # Append open tracking pixel before </body>
    pixel = (
        f'<img src="{base_url}/api/t/o/{recipient_id}" '
        f'width="1" height="1" style="display:none" alt="" />'
    )
    if "</body>" in rendered:
        rendered = rendered.replace("</body>", f"{pixel}\n</body>")
    else:
        rendered += pixel

    # Ensure unsubscribe link exists
    if "unsubscribe" not in rendered.lower():
        unsub_html = (
            f'<p style="font-size:12px;color:#999;text-align:center;margin-top:30px;">'
            f'<a href="{unsubscribe_url}" style="color:#999;">Unsubscribe</a></p>'
        )
        if "</body>" in rendered:
            rendered = rendered.replace("</body>", f"{unsub_html}\n</body>")
        else:
            rendered += unsub_html

    return rendered


def _inject_click_tracking(html: str, recipient_id: str, base_url: str) -> str:
    """Rewrite <a href="..."> to route through click tracker."""

    def replace_link(match):
        original_url = match.group(1)
        # Don't track unsubscribe links or mailto
        if "unsubscribe" in original_url.lower() or original_url.startswith("mailto:"):
            return match.group(0)
        # Don't track tracking pixels
        if "/api/t/" in original_url:
            return match.group(0)
        encoded = base64.urlsafe_b64encode(original_url.encode()).decode()
        tracked = f"{base_url}/api/t/c/{recipient_id}?url={encoded}"
        return match.group(0).replace(original_url, tracked)

    return re.sub(r'<a\s+[^>]*href="([^"]+)"', replace_link, html, flags=re.IGNORECASE)


def render_plain_text(html: str) -> str:
    """Simple HTML-to-text conversion for multipart emails."""
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"<p[^>]*>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"</p>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<li[^>]*>", "- ", text, flags=re.IGNORECASE)
    text = re.sub(r"<a\s+[^>]*href=\"([^\"]+)\"[^>]*>(.*?)</a>", r"\2 (\1)", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()
