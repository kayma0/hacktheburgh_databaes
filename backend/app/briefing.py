"""Gemini-generated field briefing for a country/month, with cache and fallback."""
from __future__ import annotations

import os

from .schemas import BriefingItem, BriefingResponse, BriefingSection

_cache: dict[tuple[str, str], BriefingResponse] = {}

TIMEOUT_S = 15

def _item(text: str, confidence: str, verify_with: str) -> BriefingItem:
    return BriefingItem(text=text, confidence=confidence, verify_with=verify_with)


# Generic, non-time-sensitive starter list used when Gemini is unavailable. It states no
# facts about any particular country; every item says who to confirm it with.
FALLBACK_SECTIONS = [
    BriefingSection(title="Community and cultural considerations", items=[
        _item("Introduce the team through the local health authority or community leaders before approaching families.", "medium", "Local programme partner"),
        _item("Ask local partners how blood donation is talked about locally, and what wording and timing work best, before you plan publicity.", "medium", "Local blood service staff"),
        _item("Agree how people with sickle cell disease and their families will be involved, and how their privacy will be protected.", "medium", "Local patient association"),
    ]),
    BriefingSection(title="Logistics", items=[
        _item("Confirm cold-chain and transport capacity for blood before the drive; collected blood is handled by the national blood service.", "medium", "National blood service"),
        _item("Agree venue, date, opening hours, screening staff, consumables and waste disposal in writing with the blood service.", "medium", "National blood service"),
        _item("Plan for power cuts, heat and travel delays, and check what the venue can really provide.", "medium", "Venue manager / local partner"),
    ]),
    BriefingSection(title="Health and safety", items=[
        _item("Check recommended vaccinations, malaria precautions and any health entry requirements well before you travel.", "medium", "A travel health clinic or your government's travel health service"),
        _item("Carry a basic first-aid kit and confirm the nearest medical facility and emergency numbers.", "medium", "Local partner / trip lead"),
        _item("Arrange travel and medical insurance that covers the countries and activities involved.", "medium", "Your insurer"),
    ]),
    BriefingSection(title="Travel", items=[
        _item("Check official government travel advice for the destination before you book and again just before departure.", "low", "Your government's travel advisory site"),
        _item("Confirm visa and entry rules for every team member, including any rules about carrying medical or event equipment.", "low", "Embassy or consulate"),
    ]),
    BriefingSection(title="Regulation and partners", items=[
        _item("Confirm the drive operates through a licensed national blood service; donation must be voluntary and unpaid.", "high", "National blood service"),
        _item("Ask whether permits or approvals are needed to hold a public blood drive, and who grants them.", "medium", "National blood service / health ministry"),
        _item("Agree who owns the data and how donor information will be stored, so none is kept by your team.", "medium", "National blood service"),
    ]),
    BriefingSection(title="Questions for local partners", items=[
        _item("What is the current donor deferral rate and main cause locally?", "low", "Local blood bank staff"),
        _item("Which blood groups are hardest to get, and what share of donors are regular donors?", "low", "Local blood bank staff"),
        _item("What would make this drive useful to you, and what should we not do?", "low", "Local programme partner"),
    ]),
]


def _fallback(country: str, month: str) -> BriefingResponse:
    return BriefingResponse(
        country=country,
        month=month,
        grounded=False,
        sources=[],
        sections=FALLBACK_SECTIONS,
        fallback_used=True,
    )


def get_briefing(country: str, month: str) -> BriefingResponse:
    key = (country, month)
    if key in _cache:
        return _cache[key]

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        result = _fallback(country, month)
        _cache[key] = result
        return result

    from concurrent.futures import ThreadPoolExecutor

    # Not a `with` block: its exit waits for the thread, which defeats the timeout.
    pool = ThreadPoolExecutor(max_workers=1)
    try:
        future = pool.submit(_call_gemini, country, month, api_key)
        result = future.result(timeout=TIMEOUT_S)
    except Exception:
        # Don't cache transient failures, so the next request retries Gemini.
        return _fallback(country, month)
    finally:
        pool.shutdown(wait=False)

    _cache[key] = result
    return result


def _call_gemini(country: str, month: str, api_key: str) -> BriefingResponse:
    from google import genai

    model = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")
    client = genai.Client(api_key=api_key)

    prompt = (
        f"Produce a field briefing in JSON for a charity team running a blood-donation drive "
        f"in {country} during {month}. Cover: community and cultural considerations (state only "
        f"supported facts, avoid stereotypes), logistics, health and safety, travel (point to "
        f"official government travel advice, never invent current incidents), regulation and "
        f"partners (donations must be voluntary, unpaid, through a licensed national blood "
        f"service), and questions for local partners. Each item needs text, confidence "
        f"(low/medium/high), and verify_with."
    )

    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config={
            "temperature": 0.5,
            "response_mime_type": "application/json",
            "response_schema": list[BriefingSection],
        },
    )

    sections = BriefingResponse.model_validate(
        {"country": country, "month": month, "grounded": False,
            "sections": [], "fallback_used": False}
    )
    import json

    parsed = json.loads(response.text)
    sections.sections = [BriefingSection.model_validate(s) for s in parsed]
    return sections
