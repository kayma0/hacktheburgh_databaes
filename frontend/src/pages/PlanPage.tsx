import { useEffect, useMemo, useState } from "react";
import { getCrisis, getPlan } from "../api";
import type { CrisisResponse, PlanInputs, PlanResponse } from "../api";
import SourceTag from "../components/SourceTag";
import { fmtRate, fmtWindow, groupLabel, pct } from "../format";
import { readScenario, scenarioQuery } from "../scenario";
import type { Scenario } from "../scenario";
import { needsFromCrisis } from "../simulator/needs";
import type { Need } from "../simulator/needs";
import Outreach from "../simulator/Outreach";
import TrustPanel from "./TrustPanel";

/* Page 3: plan a blood drive from the crisis run on page 2. The link carries that run
   (country, people, days, O− setting and seed), so this page rebuilds the exact same
   simulation, and going back restores it on page 2. */

// Drive assumptions behind "What this rests on" and the trust check (backend/app/plan.py).
const DRIVE_ASSUMPTIONS = { deferral: 0.2, donationsPerDonor: 2, coverage: 0.1 };
const PERCENT_KEYS = new Set(["deferral", "coverage", "share_in_care"]);

const span = (days: number) => fmtWindow(days).replace(/ \(.*\)$/, "");

function verdictText(plan: PlanResponse): string {
  if (plan.verdict === "enough") return `${plan.country} has enough blood`;
  if (plan.verdict === "at_risk") return `${plan.country} might not have enough blood`;
  return `${plan.country} does not have enough blood`;
}

/** Plain-text summary for an email or a meeting. */
function summaryText(plan: PlanResponse, needs: Need[], link: string): string {
  const p = plan.params;
  const groups = (gs: string[]) => gs.map(groupLabel).join(", ");
  return [
    `SickleSignal drive plan: ${plan.country}`,
    `Crisis: ${p.people} people with sickle cell disease in crisis over ${span(p.days)}.`,
    `Crisis test: ${verdictText(plan)}. Everyone got blood in ${pct(plan.p_all_served)} of simulations.`,
    plan.push.length ? `Push for: ${groups(plan.push)}.` : "No blood group needs pushing in this crisis.",
    ...(plan.watch.length ? [`Watch: ${groups(plan.watch)}.`] : []),
    ...(needs.length
      ? ["", "Donors to recruit:", ...needs.map((n) => `  ${groupLabel(n.group)}: ${n.donors} ${n.deadline}`)]
      : []),
    "",
    "What this rests on:",
    ...plan.assumptions.map(
      (a) =>
        `  - ${a.label}${a.value !== null ? `: ${PERCENT_KEYS.has(a.key) ? pct(a.value) : fmtRate(a.value)}` : ""} (${a.is_assumption ? "assumption" : "sourced"}: ${a.source})`,
    ),
    "",
    plan.disclaimer,
    `Link: ${link}`,
  ].join("\n");
}

export default function PlanPage({
  country,
  onCountry,
  onBack,
  onTravel,
}: {
  country: string;
  onCountry: (c: string) => void;
  /** Back to page 2, with this crisis run. */
  onBack: (s: Scenario) => void;
  onTravel: (country: string) => void;
}) {
  const scenario = useMemo(() => readScenario(country), []); // eslint-disable-line react-hooks/exhaustive-deps
  const c = scenario.country;
  const [res, setRes] = useState<CrisisResponse | null>(null);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // The run this page describes: page 2's seed, or a new run if page 2 didn't run one.
  const run: Scenario = { ...scenario, seed: res?.seed ?? scenario.seed };
  const inputs: PlanInputs | null =
    res && { ...run, seed: res.seed, ...DRIVE_ASSUMPTIONS };

  useEffect(() => {
    if (c) onCountry(c);
  }, [c]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!c) return;
    let live = true;
    getCrisis(c, scenario.people, scenario.days, { oNegFallback: scenario.oNegFallback, seed: scenario.seed })
      .then((r) => {
        if (!live) return;
        setRes(r);
        // Pin the run in the address bar, so the link and Back rebuild exactly this.
        window.history.replaceState(null, "", `#/plan?${scenarioQuery({ ...scenario, seed: r.seed })}`);
        return getPlan({ ...scenario, seed: r.seed, ...DRIVE_ASSUMPTIONS });
      })
      .then((p) => live && p && setPlan(p))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [c]); // eslint-disable-line react-hooks/exhaustive-deps

  const flash = (m: string) => {
    setNote(m);
    window.setTimeout(() => setNote(null), 2500);
  };
  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flash(`${what} copied`);
    } catch {
      flash("Couldn't copy: select the text and copy it by hand");
    }
  };

  const needs = res ? needsFromCrisis(res) : [];
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const back = (
    <button className="btn btn-ghost" onClick={() => onBack(run)}>
      ← Back to the crisis simulator
    </button>
  );

  return (
    <>
      <div className="page-back no-print">{back}</div>
      <section className="hero plan-hero no-print">
        <p className="eyebrow">
          <span className={`live ${plan ? "" : "is-busy"}`}>{plan ? "modelled, not live stock" : "loading"}</span>
        </p>
        <h1 className="hero-place">
          Plan a blood drive in <em className="hero-country">{c || "…"}</em>
        </h1>
      </section>

      <div className="print-only plan-print-head">
        <b>SickleSignal · Drive plan · {c}</b>
        <span>{today} · modelled estimates, not live stock</span>
      </div>

      {error && <div className="alert">Couldn't build the plan: {error}</div>}
      {!plan && !error && <p className="fine plan-wait">Building the plan…</p>}

      {plan && res && inputs && (
        <div className="plan-result" aria-live="polite">
          <section className={`panel plan-verdict verdict-${plan.verdict}`}>
            <header className="panel-head">
              <span className="panel-key">1</span>
              <h2>What the crisis test says</h2>
            </header>
            <p className="plan-verdict-line">
              For{" "}
              <b>
                {plan.params.people} {plan.params.people === 1 ? "person" : "people"}
              </b>{" "}
              in crisis over <b>{span(plan.params.days)}</b>,{" "}
              <b className="sim-verdict-word">{verdictText(plan)}</b>
              {plan.push.length > 0 && (
                <>
                  . Push for{" "}
                  {plan.push.map((g) => (
                    <span key={g} className="chip chip-critical sim-chip">
                      {groupLabel(g)}
                    </span>
                  ))}
                </>
              )}
              {plan.watch.length > 0 && (
                <>
                  {plan.push.length ? "; watch " : ". Watch "}
                  {plan.watch.map((g) => (
                    <span key={g} className="chip chip-low sim-chip">
                      {groupLabel(g)}
                    </span>
                  ))}
                </>
              )}
              .
            </p>
            <p className="plan-sub">
              Everyone got blood in <b>{pct(plan.p_all_served)}</b> of {res.draws.toLocaleString("en-GB")}{" "}
              simulations.
            </p>
          </section>

          <section className="panel plan-reach no-print">
            <header className="panel-head">
              <span className="panel-key">2</span>
              <h2>Reach donors</h2>
              <p>Send the urgent appeal to the donors this crisis needs.</p>
            </header>
            {needs.length ? (
              <Outreach res={res} needs={needs} />
            ) : (
              <p>
                <b>No donation drive needed</b> for this crisis. Keep regular donors coming in.
              </p>
            )}
          </section>

          <section className="panel plan-assume">
            <header className="panel-head">
              <span className="panel-key">3</span>
              <h2>What this rests on</h2>
            </header>
            <ul className="plan-assume-list">
              {plan.assumptions.map((a) => (
                <li key={a.key}>
                  <span>
                    {a.label}
                    {a.value !== null && <b> {PERCENT_KEYS.has(a.key) ? pct(a.value) : fmtRate(a.value)}</b>}
                  </span>
                  {a.is_assumption ? <span aria-hidden /> : <SourceTag assumed={false} title={a.source} />}
                  <small>{a.source}</small>
                </li>
              ))}
            </ul>
            <p className="plan-fine">{plan.disclaimer}</p>
          </section>

          <TrustPanel inputs={inputs} step={4} />
        </div>
      )}

      <div className="hero-actions plan-actions no-print">
        <button className="btn" onClick={() => onTravel(c)} disabled={!c}>
          Before you travel →
        </button>
        {note && <span className="plan-note">{note}</span>}
      </div>
    </>
  );
}
