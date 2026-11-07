import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  ErrorBar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  getCountries,
  simulate,
  getBriefing,
  SimulateResponse,
  BriefingResponse,
} from "./api";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export default function App() {
  const [countries, setCountries] = useState<string[]>([]);
  const [country, setCountry] = useState("");
  const [month, setMonth] = useState(MONTHS[new Date().getMonth()]);

  const [unitsPerEvent, setUnitsPerEvent] = useState(2.0);
  const [donorDeferralRate, setDonorDeferralRate] = useState(0.2);
  const [shareDiagnosed, setShareDiagnosed] = useState(0.2);
  const [shareOnHydroxyurea, setShareOnHydroxyurea] = useState(0.15);
  const [targetCoverage, setTargetCoverage] = useState(0.5);

  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [briefing, setBriefing] = useState<BriefingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCountries().then((list) => {
      setCountries(list);
      if (list.length) setCountry(list[0]);
    });
  }, []);

  useEffect(() => {
    if (!country) return;
    setLoading(true);
    setError(null);
    simulate({
      country,
      units_per_event: unitsPerEvent,
      donor_deferral_rate: donorDeferralRate,
      share_diagnosed: shareDiagnosed,
      share_on_hydroxyurea: shareOnHydroxyurea,
      target_coverage: targetCoverage,
    })
      .then(setResult)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [country, unitsPerEvent, donorDeferralRate, shareDiagnosed, shareOnHydroxyurea, targetCoverage]);

  useEffect(() => {
    if (!country || !month) return;
    getBriefing(country, month).then(setBriefing).catch(() => setBriefing(null));
  }, [country, month]);

  const chartData = result
    ? [
        {
          scenario: "Baseline",
          units: result.baseline.demand_units.p50,
          errorRange: [
            result.baseline.demand_units.p50 - result.baseline.demand_units.p10,
            result.baseline.demand_units.p90 - result.baseline.demand_units.p50,
          ],
        },
        {
          scenario: "Universal diagnosis + HU",
          units: result.universal_diagnosis_hydroxyurea.demand_units.p50,
          errorRange: [
            result.universal_diagnosis_hydroxyurea.demand_units.p50 -
              result.universal_diagnosis_hydroxyurea.demand_units.p10,
            result.universal_diagnosis_hydroxyurea.demand_units.p90 -
              result.universal_diagnosis_hydroxyurea.demand_units.p50,
          ],
        },
      ]
    : [];

  return (
    <div className="page">
      <h1>SickleSupply</h1>
      <p className="subtitle">
        Modelled blood demand from sickle cell disease, and donors needed to cover it. Not a
        medical device. No clinical advice. Aggregate, modelled estimates only.
      </p>

      {result?.is_sample_data && <div className="banner">SAMPLE DATA — placeholder, not real statistics</div>}

      <div className="controls">
        <label>
          Country
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            {countries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <Slider label="Units per transfusion event" value={unitsPerEvent} min={1} max={4} step={0.1} onChange={setUnitsPerEvent} />
        <Slider label="Donor deferral rate" value={donorDeferralRate} min={0} max={0.5} step={0.01} onChange={setDonorDeferralRate} />
        <Slider label="Share diagnosed" value={shareDiagnosed} min={0} max={1} step={0.01} onChange={setShareDiagnosed} />
        <Slider label="Share on hydroxyurea (scenario)" value={shareOnHydroxyurea} min={0} max={1} step={0.01} onChange={setShareOnHydroxyurea} />
        <Slider label="Target coverage of demand" value={targetCoverage} min={0} max={1} step={0.01} onChange={setTargetCoverage} />
      </div>

      {error && <div className="banner error">{error}</div>}
      {loading && <p>Running simulation…</p>}

      {result && (
        <>
          <section className="card">
            <h2>Results for {result.country}</h2>
            <ResultsTable label="Baseline demand (units/year)" p={result.baseline.demand_units} />
            <ResultsTable label="Baseline donors needed/year" p={result.baseline.donors_needed} />
            <ResultsTable
              label="Scenario demand (units/year)"
              p={result.universal_diagnosis_hydroxyurea.demand_units}
            />
            <ResultsTable
              label="Scenario donors needed/year"
              p={result.universal_diagnosis_hydroxyurea.donors_needed}
            />
            <ResultsTable label="Units avoided by scenario" p={result.units_avoided} />
          </section>

          <section className="card">
            <h2>Baseline vs. scenario demand</h2>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="scenario" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="units" name="P50 demand (units/year)" fill="#8884d8">
                  <ErrorBar dataKey="errorRange" width={6} strokeWidth={2} stroke="#333" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </section>
        </>
      )}

      <section className="card">
        <h2>Assumptions</h2>
        <p>
          Affected children, transfusion events and donor needs are MODELLED, not observed. Any
          figure not from a cited source is an ASSUMPTION, listed and adjustable above. See{" "}
          <code>docs/METHOD.md</code> for sources.
        </p>
      </section>

      <section className="card">
        <h2>Field briefing — {country}, {month}</h2>
        <label>
          Month
          <select value={month} onChange={(e) => setMonth(e.target.value)}>
            {MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        {!briefing?.grounded && <div className="banner">UNGROUNDED — verify before use</div>}
        {briefing?.fallback_used && <div className="banner">Static fallback checklist (Gemini unavailable)</div>}
        {briefing?.sections.map((section) => (
          <div key={section.title} className="briefing-section">
            <h3>{section.title}</h3>
            <ul>
              {section.items.map((item, i) => (
                <li key={i}>
                  {item.text} <em>({item.confidence} confidence — verify with: {item.verify_with})</em>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="slider">
      {label}: {value.toFixed(2)}
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

function ResultsTable({ label, p }: { label: string; p: { p10: number; p50: number; p90: number } }) {
  return (
    <p>
      <strong>{label}:</strong> P10 {Math.round(p.p10).toLocaleString()} — P50{" "}
      {Math.round(p.p50).toLocaleString()} — P90 {Math.round(p.p90).toLocaleString()}
    </p>
  );
}
