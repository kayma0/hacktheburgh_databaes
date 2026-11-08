"""Turn a crisis-simulator result into a donor appeal a charity can send straight away
(WhatsApp, SMS, email). Written by Gemini when GEMINI_API_KEY is set, otherwise from a
plain template, so the button always works.

Only facts passed in are used: blood groups, donor counts, deadlines, country, the size and
age mix of the scenario. No medical advice; donation must be voluntary and unpaid, through
the national blood service.
"""
from __future__ import annotations

import json
import logging
import os

from .schemas import AppealRequest, AppealResponse

log = logging.getLogger(__name__)

TIMEOUT_S = 20
# Tried in order; the first that answers is used. Fast models only: an appeal is a button
# click (gemini-3.8-flash measured ~75 s for a one-word reply; these answer in ~1 s).
# Override with GEMINI_APPEAL_MODEL in .env.
APPEAL_MODELS = ("gemini-3.5-flash", "gemini-3.5-flash-lite")
_cache: dict[str, AppealResponse] = {}


def _wanted(req: AppealRequest) -> list[tuple[str, int, str]]:
    """Groups that need donors, in the order given (the page sends most urgent first)."""
    return [(g, n, req.deadlines.get(g, "")) for g, n in req.donors.items() if n > 0]


def _children(req: AppealRequest) -> int:
    """People under 20 in the scenario (the page's under-5, 5-9 and 10-19 groups)."""
    return sum(n for k, n in req.patients_by_age.items() if k != "adults")


def _template(req: AppealRequest) -> AppealResponse:
    org = req.organisation or "Our charity"
    want = _wanted(req)
    total = sum(n for _, n, _ in want)
    kids = _children(req)
    if not want:
        body = (f"Thank you to everyone who gives blood in {req.country}. Supplies are currently "
                f"holding, and regular voluntary donation is what keeps them that way for people "
                f"living with sickle cell disease. Please keep giving.\n\n{org}")
        return AppealResponse(whatsapp=body, sms=body[:300], email_subject="Thank you, blood donors",
                              email_body=body, source="template")
    lines = "\n".join(f"- {g}: {n} donor{'s' if n != 1 else ''}" + (f", {d}" if d else "")
                      for g, n, d in want)
    span = f"over the next {req.days} days" if req.days > 1 else "in the next 24 hours"
    who = (f"up to {req.people} patients in crisis {span}, {kids} of them children and young people"
           if kids else f"up to {req.people} patients in crisis {span}")
    # Rewrite cycles through these openings so the template varies too.
    openings = [
        f"{org} is appealing urgently for blood donors in {req.country}.",
        f"People living with sickle cell disease in {req.country} urgently need blood, and "
        f"{org} is asking for your help.",
        f"{org} is calling on everyone in {req.country} who can give blood to come forward now.",
    ]
    situation = (
        f"{openings[req.variant % len(openings)]} A sickle cell crisis can strike without "
        f"warning, and a blood transfusion is often what gets a patient through it. We are "
        f"preparing for {who}, and at the current rate of collection there will not be "
        f"enough blood to treat them all."
    )
    how = ("If you are able to give blood, please donate at your nearest national blood service "
           "centre before the dates above. If you do not know your blood group, please still "
           "come forward: it will be tested when you donate. Donation is voluntary and unpaid.")
    whatsapp = (
        f"URGENT APPEAL: blood donors needed in {req.country}\n\n{situation}\n\n"
        f"We need {total} donors:\n{lines}\n\n{how}\n\n"
        f"Please forward this message to family, friends and colleagues.\n\nThank you,\n{org}"
    )
    groups = ", ".join(f"{g} x{n}" for g, n, _ in want[:4])
    sms = (f"URGENT: {org} needs {total} blood donors in {req.country} for sickle cell patients "
           f"in crisis ({groups}). Please donate at your nearest blood service centre and "
           f"share this message.")
    email_body = (
        f"Dear friend,\n\n{situation}\n\nWe are asking for {total} donors, by blood group:\n\n"
        f"{lines}\n\n{how}\n\nIf you cannot donate yourself, you can still help by sharing this "
        f"appeal with people who can.\n\nThank you for your support.\n\nWith gratitude,\n{org}"
    )
    return AppealResponse(
        whatsapp=whatsapp, sms=sms[:300],
        email_subject=f"Urgent appeal: {total} blood donors needed in {req.country}",
        email_body=email_body, source="template")


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
- "sms": at most 300 characters, starting "URGENT:", naming the charity, the total and the most urgent groups.
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


def _call_gemini(req: AppealRequest, api_key: str, model: str) -> AppealResponse:
    """One appeal from one model. req.variant > 0 asks for a fresh rewrite."""
    from google import genai

    client = genai.Client(api_key=api_key)
    want = _wanted(req)
    facts = {
        "country": req.country,
        "organisation": req.organisation or "Our charity",
        "patients_in_crisis": req.people,
        "children_and_young_people_under_20": _children(req),
        "days": req.days,
        "total_donors_needed": sum(n for _, n, _ in want),
        "donors_needed_by_blood_group_most_urgent_first": [
            {"blood_group": g, "donors": n, "deadline": d} for g, n, d in want
        ],
    }
    response = client.models.generate_content(
        model=model,
        contents=PROMPT.format(
            facts=json.dumps(facts, ensure_ascii=False, indent=2),
            variant_note=(
                f"This is rewrite number {req.variant}. {REWRITE_ANGLES[(req.variant - 1) % len(REWRITE_ANGLES)]} "
                f"Use a different opening line and different sentence structure from a standard "
                f"appeal; keep every fact, the list and the tone."
                if req.variant else ""),
        ),
        config={"temperature": min(0.4 + 0.2 * req.variant, 1.0),
                "response_mime_type": "application/json",
                "http_options": {"timeout": TIMEOUT_S * 1000}},
    )
    data = json.loads(response.text)
    return AppealResponse(
        whatsapp=str(data["whatsapp"]).strip(),
        sms=str(data["sms"]).strip()[:300],
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
        return _template(req)

    from concurrent.futures import ThreadPoolExecutor

    models = [m for m in (os.environ.get("GEMINI_APPEAL_MODEL"), *APPEAL_MODELS) if m]
    for model in dict.fromkeys(models):
        # Not a `with` block: its exit waits for the thread, which defeats the timeout.
        pool = ThreadPoolExecutor(max_workers=1)
        try:
            result = pool.submit(_call_gemini, req, api_key, model).result(timeout=TIMEOUT_S)
        except Exception as e:  # unknown model, quota, timeout, bad JSON: try the next one
            log.warning("Gemini appeal with %s failed: %s: %s", model, type(e).__name__, e)
            continue
        finally:
            pool.shutdown(wait=False)
        _cache[key] = result
        return result
    return _template(req)  # not cached, so the next click retries Gemini
