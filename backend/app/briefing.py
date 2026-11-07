"""Gemini field briefing for charity programme staff.

Order of attempts:
  1. Grounded with Google Search (sources returned)            -> status GROUNDED
  2. Ungrounded with a strict JSON response schema              -> status UNGROUNDED ("verify before use")
  3. Static generic checklist (no API key, timeout or error)    -> status FALLBACK
Every result is validated against the Pydantic schema before it is returned.
"""
from __future__ import annotations

import asyncio
import calendar
import hashlib
import json
import re
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from pydantic import ValidationError

from .config import Settings
from .countries import country_name
from .schemas import Briefing, BriefingItem, BriefingRequest, BriefingSections, Source

DISCLAIMER = ("AI-generated planning aid for charity staff. Not clinical, legal or security advice. "
              "Verify every item with the named contact before acting. Donation must be voluntary, unpaid and "
              "run through the national blood transfusion service or a licensed blood bank.")
CACHE_TTL_S = 24 * 3600

SYSTEM = """You write concise field briefings for staff of a health charity who are planning VOLUNTARY, UNPAID
blood-donation drives run by a country's national blood transfusion service or a licensed blood bank, to help
meet the needs of children with sickle cell disease. The readers are programme staff, not clinicians.

Rules:
- Be specific to the country/region and month when you can, but never invent facts. If unsure, say so and lower confidence.
- No clinical advice, no dosing, no medical instructions.
- Never suggest paying donors, collecting blood outside licensed services, or bypassing approvals.
- Travel and security: point to the official government travel advice (e.g. the UK FCDO or the reader's own
  government) and local partners. NEVER describe specific current incidents, attacks or unrest.
- Avoid stereotypes about any community, religion or ethnic group. Describe practices and concerns neutrally,
  e.g. common misconceptions about blood donation or SCD stigma, and how to address them respectfully.
- Every item has: text (1-2 sentences), confidence (low|medium|high), verify_with (a role or organisation type,
  e.g. 'National Blood Transfusion Service', 'Ministry of Health', 'local SCD patient association').
- 2 to 4 items per section.
"""

SECTION_GUIDE = {
    "community_engagement": "community engagement and cultural considerations around blood donation and SCD stigma",
    "logistics": "logistics: distances, cold chain, power reliability, transport",
    "health_and_safety": "health and safety for staff and donors (non-clinical)",
    "travel_and_security": "travel and security: point to official government travel advice; no current incidents",
    "regulation_and_partnerships": "regulation and partnerships: national blood transfusion service, ministry of health, approvals needed",
    "seasonal_factors": "seasonal factors for the given month (rainy season, holidays, school terms, fasting periods)",
    "questions_for_local_partners": "questions to ask local partners before committing",
}


def _prompt(req: BriefingRequest) -> str:
    where = country_name(req.iso3) + (f", {req.admin1}" if req.admin1 else "")
    month = calendar.month_name[req.month]
    schema = json.dumps(BriefingSections.model_json_schema())
    sections = "\n".join(f"- {k}: {v}" for k, v in SECTION_GUIDE.items())
    ctx = req.charity_context or "(none given)"
    return (f"{SYSTEM}\nLocation: {where}\nMonth of the drive: {month}\nCharity context: {ctx}\n\n"
            f"Sections:\n{sections}\n\nReturn ONLY a JSON object that matches this JSON schema, no prose, no code fences:\n{schema}")


def cache_key(req: BriefingRequest, model: str | None) -> str:
    raw = json.dumps({"r": req.model_dump(), "m": model}, sort_keys=True)
    return hashlib.sha256(raw.encode()).hexdigest()


# ------------------------------------------------------------------ rate limiting

class RateLimiter:
    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.hits: dict[str, deque] = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, client: str) -> bool:
        now = time.monotonic()
        with self.lock:
            q = self.hits[client]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= self.per_minute:
                return False
            q.append(now)
            return True


# ------------------------------------------------------------------ fallback

def fallback_sections() -> BriefingSections:
    def it(text: str, verify: str) -> BriefingItem:
        return BriefingItem(text=text, confidence="medium", verify_with=verify)
    return BriefingSections(
        community_engagement=[
            it("Ask a local SCD patient or parent association to co-host the drive and shape the messaging.", "Local SCD patient association"),
            it("Prepare respectful answers to common worries about donating (safety, how blood is used, effect on health).", "National Blood Transfusion Service donor educators"),
            it("Check how SCD is talked about locally so materials do not add to stigma for families.", "Community health workers"),
        ],
        logistics=[
            it("Confirm who supplies collection kits, cold boxes and transport to the processing centre, and the maximum time allowed.", "National Blood Transfusion Service"),
            it("Plan for power cuts: confirm generator or cold-chain backup at the venue.", "Venue manager / partner service"),
        ],
        health_and_safety=[
            it("Collection, screening and donor care are done only by the licensed partner's trained staff.", "National Blood Transfusion Service"),
            it("Agree an incident and first-aid plan with the partner before the day.", "Partner service medical lead"),
        ],
        travel_and_security=[
            it("Read your government's official travel advice for the country and region before travel and on the day.", "Official government travel advice (e.g. UK FCDO)"),
            it("Follow your organisation's security policy and check in with local partners on current conditions.", "Your security focal point / local partners"),
        ],
        regulation_and_partnerships=[
            it("Get written agreement from the national blood transfusion service; drives must run under their licence.", "National Blood Transfusion Service"),
            it("Check whether the Ministry of Health or local authority must approve public health events.", "Ministry of Health"),
            it("Donors must be voluntary and unpaid; agree what refreshments or thanks are allowed.", "National Blood Transfusion Service"),
        ],
        seasonal_factors=[
            it("Check for rainy season, public holidays, exams or fasting periods that affect turnout and roads.", "Local partners"),
        ],
        questions_for_local_partners=[
            it("Which sites and dates have worked best for past drives, and what turnout did they get?", "Partner service"),
            it("How are units allocated to paediatric SCD patients, and how can we track that they were used?", "Partner service / hospital haematology"),
            it("What deferral rate do you usually see, and what are the main reasons?", "Partner service"),
        ],
    )


# ------------------------------------------------------------------ Gemini calls

def _strip_json(text: str) -> str:
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*", "", t)
    t = re.sub(r"\s*```$", "", t)
    if not t.startswith("{"):
        m = re.search(r"\{.*\}", t, re.S)
        if m:
            t = m.group(0)
    return t


def _sources(resp) -> list[Source]:
    out: list[Source] = []
    try:
        for cand in resp.candidates or []:
            gm = getattr(cand, "grounding_metadata", None)
            for ch in (getattr(gm, "grounding_chunks", None) or []):
                web = getattr(ch, "web", None)
                if web and getattr(web, "uri", None):
                    out.append(Source(title=getattr(web, "title", None), url=web.uri))
    except Exception:  # noqa: BLE001
        pass
    seen, uniq = set(), []
    for s in out:
        if s.url not in seen:
            seen.add(s.url)
            uniq.append(s)
    return uniq


def _call_gemini(settings: Settings, req: BriefingRequest) -> tuple[BriefingSections, str, str, list[Source]]:
    """Blocking. Returns (sections, status, note, sources). Raises on total failure."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=settings.gemini_api_key,
                          http_options=types.HttpOptions(timeout=int(settings.gemini_timeout_s * 1000)))
    prompt = _prompt(req)
    errors = []
    # 1) grounded
    try:
        resp = client.models.generate_content(
            model=settings.gemini_model, contents=prompt,
            config=types.GenerateContentConfig(temperature=0.2, tools=[types.Tool(google_search=types.GoogleSearch())]),
        )
        sections = BriefingSections.model_validate_json(_strip_json(resp.text or ""))
        src = _sources(resp)
        if src:
            return sections, "GROUNDED", "Grounded with Google Search. Check the sources listed.", src
        errors.append("grounded call returned no sources")
    except (ValidationError, ValueError) as e:
        errors.append(f"grounded output did not match schema: {str(e)[:200]}")
    except Exception as e:  # noqa: BLE001 - SDK/API errors (unsupported tool, quota, ...)
        errors.append(f"grounded call failed: {str(e)[:200]}")
    # 2) ungrounded, schema-enforced
    resp = client.models.generate_content(
        model=settings.gemini_model, contents=prompt,
        config=types.GenerateContentConfig(temperature=0.2, response_mime_type="application/json",
                                           response_schema=BriefingSections),
    )
    parsed = resp.parsed if isinstance(getattr(resp, "parsed", None), BriefingSections) else \
        BriefingSections.model_validate_json(_strip_json(resp.text or ""))
    return parsed, "UNGROUNDED", "UNGROUNDED, verify before use. (" + "; ".join(errors) + ")", []


async def generate_briefing(settings: Settings, req: BriefingRequest, store) -> Briefing:
    model = settings.gemini_model
    key = cache_key(req, model)
    hit = store.get_briefing(key, CACHE_TTL_S)
    if hit:
        hit["cached"] = True
        return Briefing.model_validate(hit)

    base = dict(iso3=req.iso3, country=country_name(req.iso3), admin1=req.admin1, month=req.month,
                generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds"), disclaimer=DISCLAIMER, model=model)
    if not settings.gemini_api_key or not settings.gemini_model:
        return Briefing(**base, status="FALLBACK", sections=fallback_sections(),
                        status_note="GEMINI_API_KEY / GEMINI_MODEL not set: showing the generic checklist.")
    try:
        sections, status, note, sources = await asyncio.wait_for(
            asyncio.to_thread(_call_gemini, settings, req), timeout=settings.gemini_timeout_s * 2 + 5)
    except asyncio.TimeoutError:
        return Briefing(**base, status="FALLBACK", sections=fallback_sections(),
                        status_note="Gemini timed out: showing the generic checklist.")
    except ImportError:
        return Briefing(**base, status="FALLBACK", sections=fallback_sections(),
                        status_note="google-genai is not installed: showing the generic checklist.")
    except Exception as e:  # noqa: BLE001
        return Briefing(**base, status="FALLBACK", sections=fallback_sections(),
                        status_note=f"Gemini call failed ({type(e).__name__}): showing the generic checklist.")
    b = Briefing(**base, status=status, status_note=note, sections=sections, sources=sources)
    store.put_briefing(key, b.model_dump())   # only real model output is cached; fallbacks are retried next time
    return b
