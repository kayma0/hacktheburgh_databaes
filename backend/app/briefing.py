"""Gemini-generated field briefing for a country/month, with cache and fallback."""
from __future__ import annotations

import os

from .schemas import BriefingItem, BriefingResponse, BriefingSection

_cache: dict[tuple[str, str], BriefingResponse] = {}

TIMEOUT_S = 15

FALLBACK_SECTIONS = [
    BriefingSection(
        title="Community and cultural considerations",
        items=[
            BriefingItem(
                text="Introduce the team through the local health authority or community leaders before approaching families.",
                confidence="medium",
                verify_with="Local programme partner",
            )
        ],
    ),
    BriefingSection(
        title="Logistics",
        items=[
            BriefingItem(
                text="Confirm cold-chain and transport capacity for blood samples before the drive.",
                confidence="medium",
                verify_with="National blood service",
            )
        ],
    ),
    BriefingSection(
        title="Health and safety",
        items=[
            BriefingItem(
                text="Carry a basic first-aid kit and confirm nearest medical facility.",
                confidence="medium",
                verify_with="Local partner / trip lead",
            )
        ],
    ),
    BriefingSection(
        title="Travel",
        items=[
            BriefingItem(
                text="Check official government travel advice before departure.",
                confidence="low",
                verify_with="Your government's travel advisory site",
            )
        ],
    ),
    BriefingSection(
        title="Regulation and partners",
        items=[
            BriefingItem(
                text="Confirm the drive operates through a licensed national blood service; voluntary unpaid donation only.",
                confidence="high",
                verify_with="National blood service",
            )
        ],
    ),
    BriefingSection(
        title="Questions for local partners",
        items=[
            BriefingItem(
                text="What is the current donor deferral rate and main cause locally?",
                confidence="low",
                verify_with="Local blood bank staff",
            )
        ],
    ),
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

    try:
        from concurrent.futures import ThreadPoolExecutor

        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(_call_gemini, country, month, api_key)
            result = future.result(timeout=TIMEOUT_S)
    except Exception:
        result = _fallback(country, month)

    _cache[key] = result
    return result


def _call_gemini(country: str, month: str, api_key: str) -> BriefingResponse:
    from google import genai

    model = os.environ.get("GEMINI_MODEL", "gemini-2.0-flash")
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
        {"country": country, "month": month, "grounded": False, "sections": [], "fallback_used": False}
    )
    import json

    parsed = json.loads(response.text)
    sections.sections = [BriefingSection.model_validate(s) for s in parsed]
    return sections
