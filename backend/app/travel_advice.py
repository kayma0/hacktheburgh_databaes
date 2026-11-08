"""UK government (FCDO) travel advice for one country, from the gov.uk Content API.

This module only fetches and tidies facts: the advisory status, when gov.uk last changed the
page, what changed, and the safety and regional-risk text. `briefing.py` feeds them to Gemini
so the trip checklist can open with the country's current situation.

Nothing here asks Gemini anything, and the status lines are copied from gov.uk rather than
written, so no advisory can be invented. Entry and visa rules are left out on purpose: FCDO
advice is written for British passport holders and we do not know a visitor's nationality.
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
import urllib.request

log = logging.getLogger(__name__)

API = "https://www.gov.uk/api/content/foreign-travel-advice/"
PAGE = "https://www.gov.uk/foreign-travel-advice/"

FETCH_TIMEOUT_S = 10

# Country names in our data that gov.uk files under a different slug.
SLUG_OVERRIDES = {"Cabo Verde": "cape-verde", "United Republic of Tanzania": "tanzania"}

# gov.uk's machine-readable status codes, in plain words. Copied, never generated.
ALERT_LABELS = {
    "avoid_all_travel": "The FCDO advises against all travel here.",
    "avoid_all_but_essential_travel": "The FCDO advises against all but essential travel here.",
    "avoid_all_travel_to_parts": "The FCDO advises against all travel to parts of the country.",
    "avoid_all_but_essential_travel_to_parts":
        "The FCDO advises against all but essential travel to parts of the country.",
}

# Only these sections are read. Entry requirements and health are left out on purpose.
PARTS_USED = ("safety-and-security", "regional-risks")


def slug(country: str) -> str:
    if country in SLUG_OVERRIDES:
        return SLUG_OVERRIDES[country]
    s = unicodedata.normalize("NFKD", country).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def page_url(country: str) -> str:
    return PAGE + slug(country)


def _text(html: str, limit: int = 2500) -> str:
    """gov.uk part bodies are HTML; we only need the words."""
    s = re.sub(r"<[^>]+>", " ", html or "")
    s = re.sub(r"&[a-z]+;", " ", s)
    return re.sub(r"\s+", " ", s).strip()[:limit]


def _fetch(country: str) -> dict:
    req = urllib.request.Request(API + slug(country), headers={"User-Agent": "SickleSignal/1.0"})
    with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_S) as r:
        return json.load(r)


def facts(country: str) -> dict | None:
    """What gov.uk currently says, or None if it could not be reached."""
    try:
        doc = _fetch(country)
    except Exception as e:
        log.info("gov.uk advice for %s unavailable: %s: %s", country, type(e).__name__, e)
        return None
    details = doc.get("details", {})
    parts = {p.get("slug"): p.get("body", "") for p in details.get("parts", [])}
    return {
        "alerts": [ALERT_LABELS[a] for a in details.get("alert_status", []) if a in ALERT_LABELS],
        "updated": (doc.get("public_updated_at") or "")[:10],
        "latest_update": (details.get("change_description") or "").strip() or None,
        "risk_text": " ".join(_text(parts.get(p, "")) for p in PARTS_USED if parts.get(p)).strip(),
        "url": page_url(country),
    }
