"""Messages a charity can send straight away, from a crisis-simulator result.

`draft_appeal` writes the appeal for WhatsApp, SMS and email: by Gemini when GEMINI_API_KEY
is set, otherwise from a plain template, so the button always works. The page sends it as
written, or to registered donors with their name and last donation added in front.

Only facts passed in are used: blood groups, donor counts, deadlines, country, the size and
age mix of the scenario. No medical advice; donation is voluntary and unpaid, through the
national blood service.
"""
from __future__ import annotations

import json
import logging
import os
import time

from .schemas import AppealRequest, AppealResponse
from .timeout import call_with_timeout

log = logging.getLogger(__name__)

TIMEOUT_S = 20
# Tried in order; the first that answers is used. Override with GEMINI_APPEAL_MODEL.
APPEAL_MODELS = ("gemini-3.5-flash", "gemini-3.5-flash-lite")
# Minimal thinking: a short, fact-bound message gains nothing from long reasoning, and it
# cuts a draft from ~12 s to ~2.5 s.
THINKING_LEVEL = "minimal"
DEFAULT_ORG = "Your local sickle cell charity"
SMS_LIMIT = 300
# A model that is out of quota (HTTP 429) is skipped for this long instead of being
# retried on every click, so the fallback answers straight away.
QUOTA_BACKOFF_S = 15 * 60

_cache: dict[str, AppealResponse] = {}
_skip_until: dict[str, float] = {}


def label(group: str) -> str:
    """Blood group for people to read: a true minus sign, e.g. O−."""
    return group.replace("-", "−")


def _org(req: AppealRequest) -> str:
    return req.organisation or DEFAULT_ORG


def _wanted(req: AppealRequest) -> list[tuple[str, int, str]]:
    """(group label, donors, deadline) for groups that need donors, in the order given
    (the page sends the most urgent first)."""
    return [(label(g), n, req.deadlines.get(g, "")) for g, n in req.donors.items() if n > 0]


def _children(req: AppealRequest) -> int:
    """People under 20 in the scenario (the page's under-5, 5-9 and 10-19 groups)."""
    return sum(n for k, n in req.patients_by_age.items() if k != "adults")


def _donors(n: int) -> str:
    return f"{n} donor{'' if n == 1 else 's'}"


# ───────────── template ─────────────

HOW_TO_HELP = (
    "If you are able to give blood, please donate at your nearest national blood service "
    "centre before the dates above. If you do not know your blood group, please still come "
    "forward: it will be tested when you donate. Donation is voluntary and unpaid."
)


def _sms(org: str, country: str, want: list[tuple[str, int, str]]) -> str:
    """Two or three plain sentences: who is asking, the most urgent need, what to do."""
    total = sum(n for _, n, _ in want)
    group, n, deadline = want[0]
    first = f"one {group} donor" if n == 1 else f"{n} {group} donors"
    when = f" {deadline}" if deadline else ""
    others = f", and {total - n} more from other groups" if total > n else ""
    return (
        f"URGENT from {org}: people with sickle cell in {country} need blood. "
        f"We need {first}{when}{others}. "
        f"Please give at your nearest blood service centre and pass this on. Thank you."
    )


def _template(req: AppealRequest) -> AppealResponse:
    org = _org(req)
    want = _wanted(req)
    if not want:
        body = (f"Thank you to everyone who gives blood in {req.country}. Supplies are currently "
                f"holding, and regular voluntary donation is what keeps them that way for people "
                f"living with sickle cell disease. Please keep giving.\n\n{org}")
        return AppealResponse(whatsapp=body, sms=body[:SMS_LIMIT], email_subject="Thank you, blood donors",
                              email_body=body, source="template")
    total = sum(n for _, n, _ in want)
    kids = _children(req)
    lines = "\n".join(f"- {g}: {_donors(n)}" + (f", {d}" if d else "") for g, n, d in want)
    span = f"over the next {req.days} days" if req.days > 1 else "in the next 24 hours"
    who = f"up to {req.people} patients in crisis {span}"
    if kids:
        who += f", {kids} of them children and young people"
    # Rewrite cycles through these openings so the template varies too.
    openings = (
        f"{org} is appealing urgently for blood donors in {req.country}.",
        f"People living with sickle cell disease in {req.country} urgently need blood, and "
        f"{org} is asking for your help.",
        f"{org} is calling on everyone in {req.country} who can give blood to come forward now.",
    )
    situation = (
        f"{openings[req.variant % len(openings)]} A sickle cell crisis can strike without "
        f"warning, and a blood transfusion is often what gets a patient through it. We are "
        f"preparing for {who}, and at the current rate of collection there will not be "
        f"enough blood to treat them all."
    )
    return AppealResponse(
        whatsapp=(
            f"URGENT APPEAL: blood donors needed in {req.country}\n\n{situation}\n\n"
            f"We need {total} donors:\n{lines}\n\n{HOW_TO_HELP}\n\n"
            f"Please forward this message to family, friends and colleagues.\n\nThank you,\n{org}"
        ),
        sms=_sms(org, req.country, want)[:SMS_LIMIT],
        email_subject=f"Urgent appeal: {total} blood donors needed in {req.country}",
        email_body=(
            f"Dear friend,\n\n{situation}\n\nWe are asking for {total} donors, by blood group:\n\n"
            f"{lines}\n\n{HOW_TO_HELP}\n\nIf you cannot donate yourself, you can still help by "
            f"sharing this appeal with people who can.\n\nThank you for your support.\n\n"
            f"With gratitude,\n{org}"
        ),
        source="template",
    )


# ───────────── Gemini ─────────────

PROMPT = """You are the communications officer of a respected sickle cell charity writing an urgent public appeal for blood donors. Write it from these facts ONLY:

{facts}

Voice: professional, compassionate and urgent, like a real NGO appeal (think Red Cross or a national blood service). Serious and dignified: never casual, never alarmist, no exclamation marks, no emoji, no hashtags. Plain English that anyone can follow.

Content, in this order:
1. Open with the need: blood donors are urgently needed in the country, for people living with sickle cell disease.
2. Why: a sickle cell crisis can strike without warning and a blood transfusion is often what gets a patient through it. Say the charity is preparing for the number of patients in crisis over the stated number of days, mentioning children and young people if their count is above zero, and that at the current rate of collection there will not be enough blood.
3. The ask: the total donors needed, then one line per blood group, in the order given, with its deadline exactly as given.
4. How to help: donate at the nearest national blood service centre before those dates; people who do not know their blood group should still come, as it is tested when they donate; donation is voluntary and unpaid. Ask people who cannot donate to share the appeal.
5. Thank the reader and sign off with the organisation name.

Do not invent any statistic, place, date, phone number, website, eligibility rule or medical claim beyond the facts above. Use the blood group names exactly as given.

{variant_note}

Return JSON with exactly these keys:
- "whatsapp": the full appeal, at most 1000 characters, starting with a short capitalised line such as "URGENT APPEAL: blood donors needed in <country>", line breaks between paragraphs, blood groups as a "- " list.
- "sms": a text message of at most 300 characters, starting "URGENT from <organisation>:". Two or three short, complete, natural sentences that a person would actually write: the need, the single most urgent blood group with its donor count and deadline (mention the rest only as a total), and what to do, ending with "Thank you." No list, no brackets, no abbreviations or shorthand such as "x23" or "pls".
- "email_subject": a clear, serious subject line under 80 characters.
- "email_body": the full appeal as a letter, starting "Dear friend," and ending with a sign-off and the organisation name."""

# Each Rewrite leads with a different, still factual, angle.
REWRITE_ANGLES = (
    "Lead with the human impact: the children and young people among those in crisis "
    "(if their count is above zero; otherwise the patients and their families).",
    "Lead with community solidarity: one donation from a neighbour can carry a patient "
    "through a crisis.",
    "Lead with urgency of time: the nearest deadline and the most urgently needed blood group.",
)


def _facts(req: AppealRequest) -> dict:
    want = _wanted(req)
    return {
        "country": req.country,
        "organisation": _org(req),
        "patients_in_crisis": req.people,
        "children_and_young_people_under_20": _children(req),
        "days": req.days,
        "total_donors_needed": sum(n for _, n, _ in want),
        "donors_needed_by_blood_group_most_urgent_first": [
            {"blood_group": g, "donors": n, "deadline": d} for g, n, d in want
        ],
    }


def _variant_note(variant: int) -> str:
    if not variant:
        return ""
    angle = REWRITE_ANGLES[(variant - 1) % len(REWRITE_ANGLES)]
    return (f"This is rewrite number {variant}. {angle} Use a different opening line and "
            f"different sentence structure from a standard appeal; keep every fact, the list "
            f"and the tone.")


def _call_gemini(req: AppealRequest, api_key: str, model: str) -> AppealResponse:
    """One appeal from one model. req.variant > 0 asks for a fresh rewrite."""
    from google import genai

    client = genai.Client(api_key=api_key)  # keep a reference: it closes when collected
    response = client.models.generate_content(
        model=model,
        contents=PROMPT.format(
            facts=json.dumps(_facts(req), ensure_ascii=False, indent=2),
            variant_note=_variant_note(req.variant),
        ),
        config={
            "temperature": min(0.4 + 0.2 * req.variant, 1.0),
            "response_mime_type": "application/json",
            "thinking_config": {"thinking_level": THINKING_LEVEL},
            "http_options": {"timeout": TIMEOUT_S * 1000},
        },
    )
    data = json.loads(response.text)
    return AppealResponse(
        whatsapp=str(data["whatsapp"]).strip(),
        sms=str(data["sms"]).strip()[:SMS_LIMIT],
        email_subject=str(data["email_subject"]).strip(),
        email_body=str(data["email_body"]).strip(),
        source="gemini",
    )


def draft_appeal(req: AppealRequest) -> AppealResponse:
    key = req.model_dump_json()
    if key in _cache:
        return _cache[key]
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key or not _wanted(req):
        log.info("appeal: template (%s)", "no_api_key" if not api_key else "nothing to ask for")
        return _template(req)

    models = [m for m in (os.environ.get("GEMINI_APPEAL_MODEL"), *APPEAL_MODELS) if m]
    for model in dict.fromkeys(models):
        if _skip_until.get(model, 0) > time.monotonic():
            continue
        try:
            result = call_with_timeout(_call_gemini, TIMEOUT_S, req, api_key, model)
        except Exception as e:  # unknown model, busy, quota, timeout, bad JSON: try the next
            log.warning("Gemini appeal with %s failed: %s: %s", model, type(e).__name__, e)
            if "RESOURCE_EXHAUSTED" in str(e):
                _skip_until[model] = time.monotonic() + QUOTA_BACKOFF_S
            continue
        log.info("appeal: gemini (%s)", model)
        _cache[key] = result
        return result
    log.info("appeal: template (every model failed)")
    return _template(req)  # not cached, so the next click retries Gemini
