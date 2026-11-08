import { useEffect, useState } from "react";
import { getBacktest, getSensitivity } from "../api";
import type { BacktestResponse, PlanInputs, SensitivityResponse } from "../api";
import { fmt, pct } from "../format";

/* How far to trust the plan: the case-trend method back-tested on the past, and which
   assumption moves the donor numbers most (GET /api/backtest, /api/sensitivity). Loads
   only when opened. */

export default function TrustPanel({ inputs, step }: { inputs: PlanInputs; step: number }) {
  const [open, setOpen] = useState(false);
  const [bt, setBt] = useState<BacktestResponse | null>(null);
  const [sens, setSens] = useState<SensitivityResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = `${inputs.country}|${inputs.people}|${inputs.days}|${inputs.deferral}|${inputs.donationsPerDonor}|${inputs.coverage}`;

  useEffect(() => {
    if (!open || bt) return;
    getBacktest()
      .then(setBt)
      .catch((e) => setError(String(e)));
  }, [open, bt]);

  useEffect(() => {
    if (!open || !inputs.country) return;
    let live = true;
    setSens(null);
    getSensitivity(inputs)
      .then((s) => live && setSens(s))
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [open, key]); // eslint-disable-line react-hooks/exhaustive-deps

  const first = bt?.by_horizon[0];
  const last = bt?.by_horizon[bt.by_horizon.length - 1];
  const scale = sens ? Math.max(...sens.rows.flatMap((r) => [r.low_donors, r.high_donors]), sens.base_donors, 1) : 1;
  const shownVal = (r: SensitivityResponse["rows"][number], v: number) =>
    r.as_percent ? pct(v) : `${v} a year`;

  return (
    <details className="panel plan-trust no-print" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>
        <span className="panel-key">{step}</span>
        <h2>How far to trust this</h2>
        <span className="plan-trust-hint">A back-test on the past, and which assumptions matter most</span>
      </summary>

      {error && <div className="alert">Couldn't load this: {error}</div>}

      <h3 className="trust-h">1. Does the case-trend method hold up?</h3>
      {!bt && !error && <p className="fine">Running the back-test…</p>}
      {bt && first && last && (
        <>
          <p className="trust-text">
            We tested the method on the past: fitted the trend to GBD data up to{" "}
            <b>{bt.train_end}</b> only, then predicted the years after it and compared. A year
            ahead the typical (median) error was <b>{(first.median_error * 100).toFixed(1)}%</b>;{" "}
            {last.years_ahead} years ahead it was <b>{(last.median_error * 100).toFixed(1)}%</b>, with{" "}
            <b>{pct(last.share_within_10pct)}</b> of countries within 10%.
            {bt.worst_at_longest.length > 0 && (
              <>
                {" "}
                The method struggled most with{" "}
                {bt.worst_at_longest.map((w) => `${w.country} (${(w.error * 100).toFixed(0)}% off)`).join(", ")}
                : treat those countries' projections with extra care.
              </>
            )}
          </p>
          <div className="plan-table-wrap">
            <table className="plan-table trust-table">
              <thead>
                <tr>
                  <th>Years ahead</th>
                  <th>Year</th>
                  <th>Typical error</th>
                  <th>Worst 1 in 10</th>
                  <th>Countries within 10%</th>
                </tr>
              </thead>
              <tbody>
                {bt.by_horizon.map((h) => (
                  <tr key={h.years_ahead}>
                    <th scope="row">{h.years_ahead}</th>
                    <td>{h.year}</td>
                    <td>{(h.median_error * 100).toFixed(1)}%</td>
                    <td>{(h.p90_error * 100).toFixed(1)}%</td>
                    <td>{pct(h.share_within_10pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="plan-fine">
            Honest limit: the GBD figures are themselves modelled and smooth, so this shows the
            trend method is stable, not that it matches counted patients. Countries with fewer than{" "}
            {fmt(bt.min_cases)} cases are left out because small numbers make percentages
            meaningless.
          </p>
        </>
      )}

      <h3 className="trust-h">2. Which assumption matters most?</h3>
      {!sens && !error && <p className="fine">Testing the assumptions…</p>}
      {sens && (
        <>
          <p className="trust-text">
            Regular donors needed in {sens.country} is about <b>{fmt(sens.base_donors)}</b> with
            the default assumptions. Changing one assumption at a time, across a plausible range, moves it
            like this (longest bar = biggest effect):
          </p>
          <ul className="trust-bars">
            {sens.rows.map((r) => {
              const lo = Math.min(r.low_donors, r.high_donors);
              const hi = Math.max(r.low_donors, r.high_donors);
              return (
                <li key={r.key}>
                  <div className="trust-bar-head">
                    <span>{r.label}</span>
                    <small>
                      {shownVal(r, r.low_value)} → {fmt(r.low_donors)} donors · {shownVal(r, r.high_value)} →{" "}
                      {fmt(r.high_donors)}
                    </small>
                  </div>
                  <div className="trust-track" aria-hidden>
                    <i
                      className="trust-range"
                      style={{ left: `${(lo / scale) * 100}%`, width: `${Math.max(((hi - lo) / scale) * 100, 1)}%` }}
                    />
                    <i className="trust-base" style={{ left: `${(sens.base_donors / scale) * 100}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="plan-fine">
            The dark tick is the default. These are assumptions, not measurements: if one
            of them is the long bar, that is the number to confirm with the national blood service
            first.
          </p>
        </>
      )}
    </details>
  );
}
