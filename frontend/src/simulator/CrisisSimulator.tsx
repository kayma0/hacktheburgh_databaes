import { useEffect, useState } from "react";
import { getCrisis } from "../api";
import type { CrisisResponse } from "../api";
import { Dial, Toggle } from "../components/controls";
import { fmtWindow } from "../format";
import { MAX_DAYS, SCENARIO_DEFAULTS } from "../scenario";
import type { Scenario } from "../scenario";
import CrisisResult from "./CrisisResult";

/* What if N people with sickle cell go into crisis over the next D days: is there enough
   blood to treat them? Runs GET /api/crisis (backend/app/crisis.py). */

/* Time-frame slider: positions 0–100 map onto 1–365 days on a log scale, so a day, a week
   and a month are as easy to pick as a whole year. */
const posToDays = (p: number) =>
  Math.max(1, Math.min(MAX_DAYS, Math.round(Math.exp((p / 100) * Math.log(MAX_DAYS)))));
const daysToPos = (d: number) => (Math.log(Math.max(d, 1)) / Math.log(MAX_DAYS)) * 100;

export default function CrisisSimulator({
  initial,
  onScenario,
}: {
  /** Where to start; with a seed, that run is repeated straight away (e.g. coming back
   *  from the plan page). */
  initial: Scenario;
  /** The scenario as set now, with the seed of the result on screen if it matches. */
  onScenario: (s: Scenario) => void;
}) {
  const country = initial.country;
  const [people, setPeople] = useState(initial.people);
  const [windowPos, setWindowPos] = useState(daysToPos(initial.days));
  const [oNegFallback, setONegFallback] = useState(initial.oNegFallback);
  const days = posToDays(windowPos);
  const [res, setRes] = useState<CrisisResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A result describes the inputs it was run with; flag when any has changed since.
  const stale =
    !!res &&
    (res.people !== people || res.days !== days || res.country !== country || res.o_neg_fallback !== oNegFallback);
  const isDefault =
    !res &&
    people === SCENARIO_DEFAULTS.people &&
    days === SCENARIO_DEFAULTS.days &&
    oNegFallback === SCENARIO_DEFAULTS.oNegFallback;

  const run = (seed?: number) => {
    if (!country) return;
    setRunning(true);
    setError(null);
    getCrisis(country, people, days, { oNegFallback, seed })
      .then(setRes)
      .catch((e) => setError(String(e)))
      .finally(() => setRunning(false));
  };

  // A new country starts afresh; a seed in the link replays that run.
  useEffect(() => {
    setRes(null);
    setError(null);
    if (initial.seed !== undefined) run(initial.seed);
  }, [country]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onScenario({ country, people, days, oNegFallback, seed: res && !stale ? res.seed : undefined });
  }, [country, people, days, oNegFallback, res, stale]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setPeople(SCENARIO_DEFAULTS.people);
    setWindowPos(daysToPos(SCENARIO_DEFAULTS.days));
    setONegFallback(SCENARIO_DEFAULTS.oNegFallback);
    setRes(null);
    setError(null);
  };

  return (
    <section className="panel sim">
      <header className="panel-head">
        <h2>Crisis simulator</h2>
        <p>What if people with sickle cell go into crisis? Will there be enough blood?</p>
      </header>

      <div className="sim-controls">
        <Dial
          label="People in crisis"
          value={people}
          min={1}
          max={50}
          step={1}
          format={(v) => `${v} ${v === 1 ? "person" : "people"}`}
          onChange={setPeople}
        />
        <Dial
          label="Time frame"
          value={windowPos}
          min={0}
          max={100}
          step={0.5}
          format={(p) => fmtWindow(posToDays(p))}
          onChange={setWindowPos}
        />
      </div>

      <div className="sim-options">
        <Toggle
          label="Use O− when a group runs out"
          hint="Universal donor for anyone"
          checked={oNegFallback}
          onChange={setONegFallback}
        />
      </div>

      <div className="sim-actions">
        <button className="btn sim-run" onClick={() => run()} disabled={running || !country}>
          {running ? "Simulating…" : res ? "Run again" : "Run simulation"}
        </button>
        <button className="btn btn-ghost" onClick={reset} disabled={running || isDefault}>
          ↺ Reset to defaults
        </button>
      </div>

      {error && <div className="alert">Simulation failed: {error}</div>}
      {res && <CrisisResult res={res} stale={stale} />}
    </section>
  );
}
