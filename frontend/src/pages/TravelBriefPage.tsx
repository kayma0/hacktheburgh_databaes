import { useEffect, useMemo, useState } from "react";
import { getBriefing } from "../api";
import type { BriefingResponse } from "../api";
import { hashQuery } from "../scenario";

/* Page 4: before you travel. A trip checklist written for the country (Gemini, or a fixed
   list), opening with the UK government's current advice (backend/app/travel_advice.py),
   then links to official travel advice. */

const OFFICIAL_ADVICE = [
  { label: "UK government travel advice", href: "https://www.gov.uk/foreign-travel-advice" },
  { label: "US State Department advisories", href: "https://travel.state.gov/content/travel/en/traveladvisories/traveladvisories.html" },
  { label: "WHO travel advice", href: "https://www.who.int/travel-advice" },
];

/** The section title the backend gives the gov.uk-sourced points. */
const CURRENT_SITUATION = "Current situation";

/** "2026-11-04" -> "04/11/2026". */
function ukDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d && m && y ? `${d}/${m}/${y}` : iso;
}

export default function TravelBriefPage({
  country,
  onCountry,
  onBack,
}: {
  country: string;
  onCountry: (c: string) => void;
  onBack: () => void;
}) {
  const c = useMemo(() => hashQuery().get("c") || country, []); // eslint-disable-line react-hooks/exhaustive-deps
  const [brief, setBrief] = useState<BriefingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (c) onCountry(c);
  }, [c]); // eslint-disable-line react-hooks/exhaustive-deps

  // Built from the country alone, so the page needs nothing from the visitor.
  useEffect(() => {
    if (!c) return;
    let live = true;
    setBrief(null);
    setError(null);
    getBriefing(c)
      .then((b) => live && setBrief(b))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [c]);

  // A collapsed <details> prints as its heading alone, because the browser hides the rest
  // in a way print CSS cannot reach. So open every section for the printout and put the
  // closed ones back afterwards. Covers the button and the browser's own print command.
  useEffect(() => {
    let reopened: HTMLDetailsElement[] | null = null;

    const openAll = () => {
      if (reopened) return; // some browsers fire both events below
      reopened = [...document.querySelectorAll<HTMLDetailsElement>(".brief-sec")].filter(
        (d) => !d.open,
      );
      reopened.forEach((d) => (d.open = true));
    };
    const restore = () => {
      reopened?.forEach((d) => (d.open = false));
      reopened = null;
    };
    const onMedia = (e: MediaQueryListEvent) => (e.matches ? openAll() : restore());

    const mql = window.matchMedia("print"); // Safari has no beforeprint/afterprint
    window.addEventListener("beforeprint", openAll);
    window.addEventListener("afterprint", restore);
    mql.addEventListener("change", onMedia);
    return () => {
      window.removeEventListener("beforeprint", openAll);
      window.removeEventListener("afterprint", restore);
      mql.removeEventListener("change", onMedia);
    };
  }, []);

  const shown = brief && brief.country === c ? brief : null;

  return (
    <>
      <section className="hero plan-hero">
        <p className="eyebrow">Before you travel</p>
        <div className="hero-place">
          A trip checklist for
          <em className="hero-country">{c || "…"}</em>
        </div>
      </section>

      <section className="panel brief-list checklist">
        <header className="panel-head">
          <span className="panel-key">✓</span>
          <h2>Checklist</h2>
        </header>
        {error && <div className="alert">Couldn't load the checklist: {error}</div>}
        {!shown && !error && <p className="fine">Loading…</p>}
        {shown?.sections.map((sec, i) => (
          <details key={sec.title} open={i === 0} className="brief-sec">
            <summary>{sec.title}</summary>
            {sec.title === CURRENT_SITUATION && shown.updated && (
              <p className="brief-source">
                updated {ukDate(shown.updated)} from{" "}
                <a href={shown.sources[0]} target="_blank" rel="noopener noreferrer">
                  gov.uk travel advice ↗
                </a>
              </p>
            )}
            <ul>
              {sec.items.map((it, j) => (
                <li key={j}>{it.text}</li>
              ))}
            </ul>
          </details>
        ))}
        {shown && (
          <p className="plan-fine">
            {shown.fallback_used ? "" : "Written by Gemini for this country, so it can be wrong or out of date. "}
            {shown.grounded
              ? "The current situation is drawn from the UK government's published advice, which is written for British passport holders; if your team holds other passports, check your own government's advice too."
              : "No government advice could be loaded for this country, so check the links below yourself."}
          </p>
        )}
      </section>

      <section className="panel brief-official">
        <header className="panel-head">
          <span className="panel-key">!</span>
          <h2>Official advice comes first</h2>
          <p>Current safety, entry rules and health requirements change often. Check:</p>
        </header>
        <ul className="brief-links">
          {OFFICIAL_ADVICE.map((l) => (
            <li key={l.href}>
              <a href={l.href} target="_blank" rel="noopener noreferrer">
                {l.label} ↗
              </a>
            </li>
          ))}
          <li>Your own government's travel advice, if it is not listed</li>
        </ul>
      </section>

      <div className="hero-actions plan-actions no-print">
        <button className="btn" onClick={() => window.print()} disabled={!shown}>
          Print / save as PDF
        </button>
        <button className="btn btn-ghost" onClick={onBack}>
          ← Back to the plan
        </button>
      </div>
    </>
  );
}
