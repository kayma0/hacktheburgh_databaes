import { useEffect, useMemo, useState } from "react";
import { getReservoir } from "../api";
import type { ReservoirResponse } from "../api";
import BloodBag from "../components/BloodBag";
import SourceTag from "../components/SourceTag";
import { BLOOD_GROUPS, fmtDays, fmtRate } from "../format";
import { readScenario, scenarioQuery } from "../scenario";
import type { Scenario } from "../scenario";
import CrisisSimulator from "../simulator/CrisisSimulator";

/* Page 2: one country's modelled blood stock by group, then the crisis simulator. The
   simulator's scenario is kept in the address bar, so coming back from the plan page (or
   refreshing) shows the same run, and "Plan the drive" carries it to page 3. */

export default function ReservoirPage({
  country,
  onBack,
  onPlan,
}: {
  country: string;
  onBack: () => void;
  onPlan: (s: Scenario) => void;
}) {
  const initial = useMemo(() => readScenario(country), [country]);
  const [scenario, setScenario] = useState<Scenario>(initial);

  useEffect(() => {
    if (country) window.history.replaceState(null, "", `#/reservoir?${scenarioQuery(scenario)}`);
  }, [country, scenario]);

  const [r, setR] = useState<ReservoirResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!country) return;
    let live = true; // ignore a slow answer for a country we've already left
    setLoading(true);
    getReservoir(country)
      .then((d) => {
        if (!live) return;
        setR(d);
        setError(null);
      })
      .catch((e) => live && setError(String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [country]);

  const target = r?.target_days ?? 6;
  const back = (
    <button className="btn btn-ghost" onClick={onBack}>
      ← Back to hotspots
    </button>
  );

  return (
    <>
      <div className="page-back">{back}</div>
      <section className="hero">
        <p className="eyebrow">
          <span className={`live ${loading ? "is-busy" : ""}`}>
            {loading ? "loading" : "not live stock"}
          </span>
        </p>
        <h1 className="hero-place">
          Blood stock levels across{" "}
          <em className="hero-country">{country || "…"}</em>
        </h1>
      </section>

      {error && <div className="alert">Couldn't load the reservoir: {error}</div>}

      <section className={`bags ${loading ? "is-busy" : ""}`} aria-label="Modelled blood stock by group">
        {r
          ? r.types.map((t) => (
              <BloodBag
                key={t.blood_type}
                type={t.blood_type}
                days={t.days.p50}
                status={t.status}
                target={target}
                caption={
                  <span className="bag-units">
                    <b>{fmtRate(t.donated_per_day.p50)}</b> donated/day
                  </span>
                }
              />
            ))
          : BLOOD_GROUPS.map((g) => <BloodBag key={g} type={g} days={0} status="ok" target={target} ghost />)}
      </section>

      <p className="target-note">
        Full bag = <b>{fmtDays(target)}-day</b> target{" "}
        {r && !r.target_is_assumption && <SourceTag assumed={false} title={r.target_source} />}
      </p>

      <CrisisSimulator key={country} initial={initial} onScenario={setScenario} />

      <div className="hero-actions">
        <button className="btn" onClick={() => onPlan(scenario)} disabled={!country}>
          Plan the drive for {country || "this country"} →
        </button>
      </div>
    </>
  );
}
