import { useEffect, useId, useMemo, useRef, useState } from "react";
import africaGeo from "./africaGeo.json";
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  askAssistant,
  getBriefing,
  getCalibration,
  getCountries,
  getHealth,
  getHotspots,
  getReservoir,
  simulate,
} from "./api";
import type {
  BloodTypeStock,
  BriefingResponse,
  CalibrationResponse,
  ChatMessage,
  HotspotItem,
  HotspotsResponse,
  Percentiles,
  ReservoirResponse,
  StockStatus,
  SimulateResponse,
} from "./api";

/* ───────────────────────── helpers ───────────────────────── */

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// The app is the hotspots map plus the blood reservoir page. StockPage and BriefingPage
// below are kept but not routed (the stock model's data/raw/ files are missing).
type Page = "hotspots" | "reservoir";
const PAGES: { id: Page; num: string; label: string }[] = [
  { id: "hotspots", num: "01", label: "Hotspots" },
  { id: "reservoir", num: "02", label: "Blood reservoir" },
];
const ALL_PAGES: Page[] = ["hotspots", "reservoir"];

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");
const pct = (v: number) => `${Math.round(v * 100)}%`;
const fmtDays = (d: number) =>
  d >= 99 ? "99+" : d < 1 ? d.toFixed(1) : String(Math.round(d));
const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));
const niceCeil = (x: number) => {
  if (x <= 0) return 100;
  const mag = Math.pow(10, Math.floor(Math.log10(x)));
  return Math.ceil(x / mag) * mag;
};

function readPage(): Page {
  const h = window.location.hash.replace("#/", "");
  return ALL_PAGES.includes(h as Page) ? (h as Page) : "hotspots";
}

/* ───────────────────────── app shell ───────────────────────── */

export default function App() {
  const [page, setPage] = useState<Page>(readPage);
  const [countries, setCountries] = useState<string[]>([]);
  const [country, setCountryState] = useState("");
  const setCountry = (c: string) => setCountryState(c);
  const [isSample, setIsSample] = useState(false);

  useEffect(() => {
    const on = () => setPage(readPage());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);

  useEffect(() => {
    getCountries()
      .then((list) => {
        setCountries(list);
        if (list.length)
          setCountryState((c) => (c && list.includes(c) ? c : list[0]));
      })
      .catch(() => setCountries([]));
    getHealth()
      .then((h) => setIsSample(h.is_sample_data))
      .catch(() => undefined);
  }, []);

  const go = (p: Page) => {
    window.location.hash = `#/${p}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="shell">
      <header className="mast">
        <div className="mast-inner">
          <a className="brand" href="#/hotspots" aria-label="SickleSignal home">
            <BrandMark />
            <span className="brand-word">
              <em>Sickle</em>Signal
            </span>
          </a>
          <nav className="tabs" aria-label="Pages">
            {PAGES.map((p) => (
              <button
                key={p.id}
                className={`tab ${page === p.id ? "is-on" : ""}`}
                onClick={() => go(p.id)}
              >
                <span className="tab-num">{p.num}</span>
                {p.label}
              </button>
            ))}
          </nav>
          {isSample && <span className="stamp">Sample data</span>}
        </div>
      </header>

      <main className={`page ${page === "hotspots" ? "page-wide" : ""}`}>
        {page === "hotspots" && (
          <HotspotsPage
            onOpen={(c) => {
              setCountry(c);
              go("reservoir");
            }}
            onNext={(c) => {
              setCountry(c);
              go("reservoir");
            }}
            onSelect={setCountry}
          />
        )}
        {page === "reservoir" && (
          <ReservoirPage country={country} onBack={() => go("hotspots")} />
        )}
      </main>

      <footer className="foot">
        <span>SickleSignal</span>
        <span>
          Not a medical device · No clinical advice · Aggregate, modelled
          estimates only
        </span>
        <span>Method &amp; sources: docs/METHOD.md</span>
      </footer>
    </div>
  );
}

function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 32 40" aria-hidden>
      <path
        d="M16 2 C16 2 4 17 4 26 a12 12 0 0 0 24 0 C28 17 16 2 16 2Z"
        fill="currentColor"
      />
      <path
        d="M12 21 a8 8 0 1 0 9 12 a6.2 6.2 0 1 1 -9 -12Z"
        fill="var(--oxblood)"
      />
    </svg>
  );
}

/* ───────────────────────── page 01: stock ───────────────────────── */

const AGE_BANDS = [
  {
    id: "under_5",
    label: "Under 5",
    note: "≈0.6 unit each, dosed by weight",
    color: "#FA8072",
  },
  {
    id: "age_5_14",
    label: "5–14 years",
    note: "≈1.3 units each",
    color: "#E9967A",
  },
  {
    id: "age_15_24",
    label: "15–24 years",
    note: "≈2.2 units each",
    color: "#CD5C5C",
  },
  {
    id: "age_25_plus",
    label: "25 and over",
    note: "≈2.5 units each",
    color: "#8B0000",
  },
] as const;
type AgeBand = (typeof AGE_BANDS)[number]["id"];

function StockPage({
  countries,
  country,
  setCountry,
}: {
  countries: string[];
  country: string;
  setCountry: (c: string) => void;
}) {
  const [crisisByAge, setCrisisByAge] = useState<Record<AgeBand, number>>({
    under_5: 90,
    age_5_14: 120,
    age_15_24: 35,
    age_25_plus: 10,
  });
  const crisisPatients = Object.values(crisisByAge).reduce((a, b) => a + b, 0);
  const [stockDays, setStockDays] = useState(5);
  const [unitsPerEvent, setUnitsPerEvent] = useState(2.0);
  const [deferral, setDeferral] = useState(0.2);
  const [shareDiagnosed, setShareDiagnosed] = useState(0.2);
  const [shareHU, setShareHU] = useState(0.15);
  const [coverage, setCoverage] = useState(0.5);

  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!country) return;
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(() => {
      simulate({
        country,
        crisis_by_age: crisisByAge,
        stock_days_on_hand: stockDays,
        units_per_event: unitsPerEvent,
        donor_deferral_rate: deferral,
        share_diagnosed: shareDiagnosed,
        share_on_hydroxyurea: shareHU,
        target_coverage: coverage,
      })
        .then((r) => {
          if (cancelled) return;
          setResult(r);
          setError(null);
        })
        .catch((e) => !cancelled && setError(String(e)))
        .finally(() => !cancelled && setLoading(false));
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [
    country,
    crisisByAge,
    stockDays,
    unitsPerEvent,
    deferral,
    shareDiagnosed,
    shareHU,
    coverage,
  ]);

  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "long",
  });

  const crisisMax = result
    ? Math.max(
        100,
        niceCeil(result.affected_children.p50 * Math.max(shareDiagnosed, 0.05)),
      )
    : 1000;
  useEffect(() => {
    if (Object.values(crisisByAge).some((v) => v > crisisMax)) {
      setCrisisByAge((prev) => {
        const next = { ...prev };
        (Object.keys(next) as AgeBand[]).forEach(
          (k) => (next[k] = Math.min(next[k], crisisMax)),
        );
        return next;
      });
    }
  }, [crisisMax, crisisByAge]);
  const totalTargetUnits = (result?.stock ?? []).reduce(
    (a, s) => a + s.target_units,
    0,
  );

  const target = result?.target_stock_days ?? 6;
  const bagMax = target * 1.5;

  const needs = (result?.stock ?? [])
    .filter((s) => s.shortfall_units.p50 > 0.5)
    .sort((a, b) => b.shortfall_units.p50 - a.shortfall_units.p50);

  return (
    <>
      <section className="hero">
        <p className="eyebrow">
          Modelled red-cell stock outlook <span className="dot-sep">·</span>
          <span className={`live ${loading ? "is-busy" : ""}`}>
            {loading ? "re-running 10,000 draws" : "10,000 draws"}
          </span>
        </p>
        <h1 className="hero-date">{today}</h1>
        <div className="hero-place">
          Blood stock across
          <span className="select-wrap">
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </span>
        </div>
        <p className="hero-sub">
          Days of cover left in each blood group after{" "}
          <b>{fmt(crisisPatients)}</b> people with sickle cell disease go into
          crisis at once
          {result && (
            <>
              {" "}
              and need <b>~{fmt(result.crisis_units_total.p50)}</b> units
              between them
            </>
          )}
          . The big number is the median; the small one is the P10–P90 range.
        </p>
      </section>

      {error && <div className="alert">Simulation failed: {error}</div>}

      <section
        className={`bags ${loading ? "is-busy" : ""}`}
        aria-label="Blood stock by group"
      >
        {(result?.stock ?? placeholderStock()).map((s) => (
          <BloodBag
            key={s.blood_type}
            type={s.blood_type}
            days={s.days_of_cover}
            status={s.status}
            target={target}
            max={bagMax}
            ghost={!result}
            caption={
              <span className="bag-units">
                <b>{fmt(s.units_after_crisis.p50)}</b> / {fmt(s.target_units)}{" "}
                units
              </span>
            }
          />
        ))}
      </section>

      <p className="target-note">
        We aim to retain <b>{target} days</b> of stock at any time
        {result && (
          <>
            , about <b>{fmt(totalTargetUnits)} units</b> across all groups,
          </>
        )}{" "}
        to meet the needs of patients in {country || "this country"}. The dashed
        line on each bag marks it.
        {result && (
          <span className="target-sub">
            ≈{fmt(result.collections_per_day)} units collected a day nationally
            (modelled)
          </span>
        )}
      </p>

      <div className="split">
        <section className="panel">
          <header className="panel-head">
            <span className="panel-key">A</span>
            <h2>Stress test</h2>
            <p>Change the situation and watch the bags drain.</p>
          </header>
          <div className="age-head">
            <span>People in crisis at the same time, by age</span>
            <b>{fmt(crisisPatients)} total</b>
          </div>
          <p className="dial-hint age-why">
            e.g. a malaria season or heatwave triggering acute chest syndrome or
            severe anaemia. Children are transfused by body weight, so age
            changes how much blood each crisis uses.
          </p>
          {AGE_BANDS.map((b) => (
            <Dial
              key={b.id}
              label={b.label}
              value={Math.min(crisisByAge[b.id], crisisMax)}
              min={0}
              max={crisisMax}
              step={Math.max(1, Math.round(crisisMax / 200))}
              format={fmt}
              hint={b.note}
              swatch={b.color}
              onChange={(v) =>
                setCrisisByAge((prev) => ({ ...prev, [b.id]: v }))
              }
            />
          ))}
          {result && <AgeMix r={result} />}
          <Dial
            label="Stock on hand before the surge"
            value={stockDays}
            min={0}
            max={12}
            step={0.5}
            format={(v) => `${v.toFixed(1)} days`}
            hint="Assumption: days of national collections sitting in fridges"
            onChange={setStockDays}
          />
          <Dial
            label="Donor deferral rate"
            value={deferral}
            min={0}
            max={0.5}
            step={0.01}
            format={pct}
            hint="Share of volunteers turned away (low Hb, malaria, infection)"
            onChange={setDeferral}
          />
        </section>

        <section className="panel panel-ink">
          <header className="panel-head">
            <span className="panel-key">B</span>
            <h2>Push for these groups</h2>
            <p>
              Units needed to climb back to the {target}-day target, ranked.
            </p>
          </header>
          {!result ? (
            <p className="muted">Waiting for the model…</p>
          ) : needs.length === 0 ? (
            <p className="all-clear">
              Every group holds {target}+ days under this scenario. No targeted
              appeal needed.
            </p>
          ) : (
            <ol className="needs">
              {needs.map((s, i) => (
                <li key={s.blood_type} className={`need need-${s.status}`}>
                  <span className="need-rank">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="need-type">{s.blood_type}</span>
                  <span className="need-body">
                    <b>{fmt(s.shortfall_units.p50)}</b> units short
                    <small>
                      {fmt(s.shortfall_units.p10)}–{fmt(s.shortfall_units.p90)}{" "}
                      · ≈ {fmt(s.donors_to_target.p50)} donors to recruit
                    </small>
                  </span>
                  <span className={`chip chip-${s.status}`}>{s.status}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="fine">
            Children with SCD who are transfused often need units matched for
            extra antigens (Rh C/E, Kell). Ask the national blood service
            whether it phenotypes donors before running an appeal for one group.
          </p>
        </section>
      </div>

      <section className="panel ledger">
        <header className="panel-head">
          <span className="panel-key">C</span>
          <h2>Annual demand ledger</h2>
          <p>
            Yearly red-cell demand from SCD today versus a future where every
            affected child is diagnosed and a share take hydroxyurea.
          </p>
        </header>
        <div className="ledger-grid">
          <div className="ledger-dials">
            <Dial
              label="Units per transfusion event"
              value={unitsPerEvent}
              min={1}
              max={4}
              step={0.1}
              format={(v) => v.toFixed(1)}
              onChange={setUnitsPerEvent}
            />
            <Dial
              label="Share diagnosed today"
              value={shareDiagnosed}
              min={0}
              max={1}
              step={0.01}
              format={pct}
              onChange={setShareDiagnosed}
            />
            <Dial
              label="Share on hydroxyurea (scenario)"
              value={shareHU}
              min={0}
              max={1}
              step={0.01}
              format={pct}
              onChange={setShareHU}
            />
            <Dial
              label="Target coverage of demand"
              value={coverage}
              min={0}
              max={1}
              step={0.01}
              format={pct}
              onChange={setCoverage}
            />
          </div>
          {result && <Ledger r={result} />}
        </div>
      </section>

      <section className="assume">
        <h3>What's modelled and what's assumed</h3>
        <p>
          Affected children, crisis transfusions, stock and donor needs are{" "}
          <b>modelled</b>, not observed, and these aren't live blood-bank
          figures. Blood-group mix (sub-Saharan default), extra pull on O− as
          the emergency group, stock on hand and day-to-day demand noise are{" "}
          <b>assumptions</b>; you can override them in{" "}
          <code>parameters.yaml</code>.
        </p>
      </section>
    </>
  );
}

function placeholderStock(): BloodTypeStock[] {
  const z: Percentiles = { p10: 0, p50: 0, p90: 0 };
  return ["O+", "A+", "B+", "AB+", "O-", "A-", "B-", "AB-"].map((t) => ({
    blood_type: t,
    supply_share: 0,
    demand_share: 0,
    units_on_hand: 0,
    target_units: 0,
    units_after_crisis: z,
    days_of_cover: z,
    crisis_units: z,
    shortfall_units: z,
    donors_to_target: z,
    status: "ok",
  }));
}

function BloodBag({
  type,
  days,
  status,
  target,
  max,
  ghost,
  caption,
}: {
  type: string;
  days: Percentiles;
  status: StockStatus;
  target: number;
  max: number;
  ghost: boolean;
  caption?: ReactNode;
}) {
  const clip = useId().replace(/:/g, "");
  const top = 34;
  const bottom = 146;
  const h = bottom - top;
  const fill = clamp(days.p50 / max, 0, 1);
  const level = bottom - fill * h;
  const targetY = bottom - clamp(target / max, 0, 1) * h;
  const label = type.replace("-", "−");

  return (
    <figure className={`bag bag-${status} ${ghost ? "is-ghost" : ""}`}>
      <svg
        viewBox="0 0 100 176"
        role="img"
        aria-label={`${label}: ${fmtDays(days.p50)} days`}
      >
        <defs>
          <clipPath id={clip}>
            <rect x="14" y="32" width="72" height="116" rx="15" />
          </clipPath>
        </defs>
        <circle
          cx="50"
          cy="12"
          r="6"
          className="bag-line"
          fill="none"
          strokeWidth="4"
        />
        <rect
          x="43"
          y="18"
          width="14"
          height="14"
          rx="2"
          className="bag-solid"
        />
        <rect
          x="14"
          y="32"
          width="72"
          height="116"
          rx="15"
          className="bag-glass"
        />
        <g clipPath={`url(#${clip})`}>
          <g
            className="bag-level"
            style={{ transform: `translateY(${level}px)` }}
          >
            <path
              className="bag-wave"
              d="M-60 0 q10 -5 20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 t20 0 V140 H-60 Z"
            />
          </g>
        </g>
        <line
          x1="14"
          x2="86"
          y1={targetY}
          y2={targetY}
          className="bag-target"
        />
        <rect
          x="14"
          y="32"
          width="72"
          height="116"
          rx="15"
          className="bag-line"
          fill="none"
          strokeWidth="5"
        />
        <path
          d="M30 148 q20 10 40 0"
          className="bag-line"
          fill="none"
          strokeWidth="6"
        />
        <rect x="46" y="152" width="8" height="12" className="bag-solid" />
        <text x="50" y="84" textAnchor="middle" className="bag-type">
          {label}
        </text>
      </svg>
      <figcaption>
        <span className="bag-days">{ghost ? "–" : fmtDays(days.p50)}</span>
        <span className="bag-unit">days</span>
        {!ghost && (
          <>
            <span className="bag-range">
              {fmtDays(days.p10)}–{fmtDays(days.p90)}
            </span>
            {caption}
          </>
        )}
      </figcaption>
    </figure>
  );
}

function AgeMix({ r }: { r: SimulateResponse }) {
  const parts = AGE_BANDS.map((b) => ({
    ...b,
    units: r.crisis_units_by_age[b.id]?.p50 ?? 0,
  }));
  const total = parts.reduce((a, p) => a + p.units, 0);
  return (
    <div className="agemix">
      <div className="agemix-head">
        <span>Where the crisis units go</span>
        <b>
          ~{fmt(r.crisis_units_total.p50)} units
          <small>
            {" "}
            ({fmt(r.crisis_units_total.p10)}–{fmt(r.crisis_units_total.p90)})
          </small>
        </b>
      </div>
      <div className="agemix-bar">
        {total > 0 ? (
          parts.map((p) =>
            p.units > 0 ? (
              <span
                key={p.id}
                style={{
                  width: `${(p.units / total) * 100}%`,
                  background: p.color,
                }}
                title={`${p.label}: ~${fmt(p.units)} units`}
              />
            ) : null,
          )
        ) : (
          <em>No one in crisis</em>
        )}
      </div>
      <ul className="agemix-key">
        {parts.map((p) => (
          <li key={p.id}>
            <i style={{ background: p.color }} />
            {p.label} <b>{fmt(p.units)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Ledger({ r }: { r: SimulateResponse }) {
  const b = r.baseline;
  const sc = r.universal_diagnosis_hydroxyurea;
  const unitScale = Math.max(b.demand_units.p90, sc.demand_units.p90) * 1.05;
  const donorScale = Math.max(b.donors_needed.p90, sc.donors_needed.p90) * 1.05;
  const pctScale =
    Math.max(
      b.demand_pct_of_collections.p90,
      sc.demand_pct_of_collections.p90,
    ) * 1.05;
  const delta = -r.units_avoided.p50;

  return (
    <div className="ledger-rows">
      <h4>Units / year</h4>
      <RangeRow label="Today" p={b.demand_units} scale={unitScale} />
      <RangeRow label="Scenario" p={sc.demand_units} scale={unitScale} accent />
      <h4>Donors needed / year</h4>
      <RangeRow label="Today" p={b.donors_needed} scale={donorScale} />
      <RangeRow
        label="Scenario"
        p={sc.donors_needed}
        scale={donorScale}
        accent
      />
      <h4>Share of national collections</h4>
      <RangeRow
        label="Today"
        p={b.demand_pct_of_collections}
        scale={pctScale}
        suffix="%"
      />
      <RangeRow
        label="Scenario"
        p={sc.demand_pct_of_collections}
        scale={pctScale}
        suffix="%"
        accent
      />
      <p className="ledger-verdict">
        {delta >= 0 ? (
          <>
            Diagnosing every affected child brings <b>~{fmt(delta)}</b> more
            units a year into the system. These are children who are currently
            undiagnosed and untreated, not avoided demand. Plan donor growth for
            it.
          </>
        ) : (
          <>
            The scenario <b>avoids ~{fmt(-delta)}</b> units a year compared with
            today.
          </>
        )}
        <span>
          {" "}
          Affected children: {fmt(r.affected_children.p50)} (
          {fmt(r.affected_children.p10)}–{fmt(r.affected_children.p90)}).
        </span>
      </p>
    </div>
  );
}

function RangeRow({
  label,
  p,
  scale,
  accent,
  suffix = "",
}: {
  label: string;
  p: Percentiles;
  scale: number;
  accent?: boolean;
  suffix?: string;
}) {
  const x = (v: number) => clamp((v / (scale || 1)) * 100, 0, 100);
  const show = (v: number) =>
    (suffix ? v.toFixed(v < 10 ? 1 : 0) : fmt(v)) + suffix;
  return (
    <div className={`range ${accent ? "is-accent" : ""}`}>
      <span className="range-label">{label}</span>
      <span className="range-track">
        <span
          className="range-span"
          style={{ left: `${x(p.p10)}%`, width: `${x(p.p90) - x(p.p10)}%` }}
        />
        <span className="range-mid" style={{ left: `${x(p.p50)}%` }} />
      </span>
      <span className="range-nums">
        <b>{show(p.p50)}</b>
        <small>
          {show(p.p10)}–{show(p.p90)}
        </small>
      </span>
    </div>
  );
}

function Dial({
  label,
  value,
  min,
  max,
  step,
  format,
  hint,
  swatch,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  hint?: string;
  swatch?: string;
  onChange: (v: number) => void;
}) {
  const fillPct = ((value - min) / (max - min || 1)) * 100;
  return (
    <label className="dial">
      <span className="dial-top">
        <span className="dial-label">
          {swatch && <i className="swatch" style={{ background: swatch }} />}
          {label}
        </span>
        <span className="dial-value">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--fill": `${fillPct}%` } as CSSProperties}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {hint && <span className="dial-hint">{hint}</span>}
    </label>
  );
}

/* ───────────────────────── page 01: hotspots ───────────────────────── */

// Country outlines (Natural Earth 1:50m, pre-projected). Generated, not hand-drawn.
type GeoCountry = {
  name: string;
  data: boolean;
  d: string;
  cx: number;
  cy: number;
  area: number;
};
const GEO = africaGeo as unknown as {
  w: number;
  h: number;
  context: string;
  countries: GeoCountry[];
};

// Five heat classes, like the reference map's legend: a country is filled with its class.
const HEAT_CLASSES = [
  { min: 0.4, label: "Highest", color: "#6E0A12", ink: "#fff" },
  { min: 0.2, label: "High", color: "#A3161C", ink: "#fff" },
  { min: 0.1, label: "Medium", color: "#CF3A2E", ink: "#fff" },
  { min: 0.03, label: "Lower", color: "#EC8466", ink: "#3a0d08" },
  { min: 0, label: "Lowest", color: "#F6C3B0", ink: "#3a0d08" },
];
const heatClass = (h: number) =>
  HEAT_CLASSES.find((c) => h >= c.min) ?? HEAT_CLASSES[HEAT_CLASSES.length - 1];
const heatColor = (h: number) => heatClass(h).color;

const fmtBig = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
};

/* ── map zoom: +/− buttons, pinch, Ctrl/⌘ + scroll, double-click; drag to pan ── */

type MapView = { x: number; y: number; w: number; h: number };
const MAX_ZOOM = 10;

function useMapZoom(W: number, H: number) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<MapView>({ x: 0, y: 0, w: W, h: H });
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ moved: false, dist: 0, sx: 0, sy: 0 });

  const clampView = (v: MapView): MapView => {
    const w = Math.min(W, Math.max(W / MAX_ZOOM, v.w));
    const h = (w * H) / W;
    return {
      x: Math.min(W - w, Math.max(0, v.x)),
      y: Math.min(H - h, Math.max(0, v.y)),
      w,
      h,
    };
  };

  /** Screen point -> map units, matching the SVG's default "xMidYMid meet" fit. */
  const toMap = (cx: number, cy: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const v = viewRef.current;
    const s = Math.min(r.width / v.w, r.height / v.h);
    const ox = (r.width - v.w * s) / 2;
    const oy = (r.height - v.h * s) / 2;
    return { x: v.x + (cx - r.left - ox) / s, y: v.y + (cy - r.top - oy) / s, s };
  };

  /** Zoom by `factor` (>1 = in) keeping the point under (cx, cy) fixed. */
  const zoomAt = (factor: number, cx?: number, cy?: number) => {
    const v = viewRef.current;
    let px = v.x + v.w / 2;
    let py = v.y + v.h / 2;
    if (cx !== undefined && cy !== undefined) {
      const p = toMap(cx, cy);
      if (p) ({ x: px, y: py } = p);
    }
    const w = Math.min(W, Math.max(W / MAX_ZOOM, v.w / factor));
    const f = w / v.w;
    const next = clampView({ x: px - (px - v.x) * f, y: py - (py - v.y) * f, w, h: (w * H) / W });
    viewRef.current = next;
    setView(next);
  };

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    // Plain scrolling keeps scrolling the page; Ctrl/⌘ + scroll (and trackpad pinch,
    // which browsers report as Ctrl + wheel) zooms the map.
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * 0.0025), e.clientX, e.clientY);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1)
      gesture.current = { moved: false, dist: 0, sx: e.clientX, sy: e.clientY };
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current.dist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    const g = gesture.current;
    if (pointers.current.size === 2) {
      // Pinch: zoom by the change in finger distance, around the midpoint.
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (g.dist > 0) zoomAt(d / g.dist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      g.dist = d;
      g.moved = true;
      return;
    }
    const v = viewRef.current;
    if (v.w >= W) return; // nothing to pan when fully zoomed out
    if (!g.moved && Math.hypot(cur.x - g.sx, cur.y - g.sy) < 5) return;
    if (!g.moved) {
      g.moved = true;
      // Capture only once dragging, so an ordinary tap still reaches the country.
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const s = toMap(cur.x, cur.y)?.s ?? 1;
    const next = clampView({ ...v, x: v.x - (cur.x - prev.x) / s, y: v.y - (cur.y - prev.y) / s });
    viewRef.current = next;
    setView(next);
  };
  const onPointerEnd = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) gesture.current.dist = 0;
  };

  const zoom = W / view.w;
  return {
    svgRef,
    viewBox: `${view.x} ${view.y} ${view.w} ${view.h}`,
    zoom,
    zoomIn: () => zoomAt(1.6),
    zoomOut: () => zoomAt(1 / 1.6),
    reset: () => {
      const full = { x: 0, y: 0, w: W, h: H };
      viewRef.current = full;
      setView(full);
    },
    /** True right after a drag or pinch, so it isn't treated as a tap. */
    wasDrag: () => gesture.current.moved,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: onPointerEnd,
      onPointerCancel: onPointerEnd,
      onDoubleClick: (e: ReactMouseEvent<SVGSVGElement>) => zoomAt(2, e.clientX, e.clientY),
    },
  };
}

function HotspotsPage({
  onOpen: _onOpen,
  onNext,
  onSelect,
}: {
  onOpen: (country: string) => void;
  onNext: (country: string) => void;
  onSelect?: (country: string) => void;
}) {
  const [data, setData] = useState<HotspotsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  // Keep the app-wide country in step with the map, so the reservoir tab opens on it.
  useEffect(() => {
    if (sel) onSelect?.(sel);
  }, [sel]); // eslint-disable-line react-hooks/exhaustive-deps
  const [tip, setTip] = useState<{ name: string; x: number; y: number } | null>(
    null,
  );
  const figRef = useRef<HTMLElement>(null);
  const mz = useMapZoom(GEO.w, GEO.h);
  const pick = (name: string) => {
    if (!mz.wasDrag()) setSel(name);
  };

  useEffect(() => {
    getHotspots()
      .then((d) => {
        setData(d);
        setSel((cur) => cur ?? d.items[0]?.country ?? null);
      })
      .catch((e) => setError(String(e)));
  }, []);

  const byName = useMemo(
    () => new Map((data?.items ?? []).map((i) => [i.country, i])),
    [data],
  );
  const selected = data?.items.find((i) => i.country === sel) ?? null;
  const selectedGeo = GEO.countries.filter((g) => g.name === sel);
  const dataYear = data?.data_year ?? 2023;

  const showTip = (e: ReactMouseEvent, name: string) => {
    const r = figRef.current?.getBoundingClientRect();
    if (r) setTip({ name, x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const cls = selected ? heatClass(selected.heat) : null;
  const rank = selected ? (data?.items.findIndex((i) => i.country === selected.country) ?? 0) + 1 : 0;
  const totalCases = (data?.items ?? []).reduce((a, i) => a + i.cases_now.p50, 0) || 1;
  const shareOfTotal = selected
    ? ((selected.cases_now.p50 / totalCases) * 100).toFixed(
        selected.cases_now.p50 / totalCases < 0.1 ? 1 : 0,
      )
    : "0";

  return (
    <>
      <header className="ah">
        <div>
          <p className="eyebrow">Hotspot atlas · Africa</p>
          <h1 className="hero-title ah-title">
            See where sickle cell is <em>most common</em>
          </h1>
          <p className="ah-sub">
            Each country is shaded by how many people live with sickle cell
            disease. Tap a country to see its numbers.
          </p>
        </div>
        <button
          className="btn ah-next"
          onClick={() => sel && onNext(sel)}
          disabled={!sel}
        >
          {sel ? `${sel}'s blood reservoir →` : "Next page →"}
        </button>
      </header>

      <div className="atlas">
        <figure className="map-card" ref={figRef}>
          <figcaption className="map-top">
            <span>Tap a country · pinch, Ctrl + scroll or + / − to zoom</span>
            <span className="map-top-note">Shade = people living with Sickle Cell Disease</span>
          </figcaption>
          <div className="map-stage">
          <svg
            ref={mz.svgRef}
            viewBox={mz.viewBox}
            className={`map ${mz.zoom > 1.01 ? "is-zoomed" : ""}`}
            role="img"
            aria-label="Map of Africa, each country shaded by people living with sickle cell disease"
            onMouseLeave={() => setTip(null)}
            {...mz.handlers}
          >
            <rect width={GEO.w} height={GEO.h} className="sea" />
            <path d={GEO.context} className="ctx" />
            {GEO.countries.map((g, i) => {
              const it = byName.get(g.name);
              return (
                <path
                  key={`${g.name}-${i}`}
                  d={g.d}
                  className={`ctry ${it ? "has-data" : "no-data"}`}
                  style={it ? { fill: heatColor(it.heat) } : undefined}
                  onClick={() => it && pick(g.name)}
                  onMouseMove={(e) => showTip(e, g.name)}
                  tabIndex={it ? 0 : -1}
                  role={it ? "button" : undefined}
                  aria-label={
                    it ? `${g.name}, ${heatClass(it.heat).label}` : undefined
                  }
                  onKeyDown={(e) => it && e.key === "Enter" && setSel(g.name)}
                />
              );
            })}
            {/* Small island states are too small to see as shapes: add a marker. */}
            {GEO.countries
              .filter((g) => g.area < 20 && byName.has(g.name))
              .map((g) => (
                <circle
                  key={`dot-${g.name}`}
                  cx={g.cx}
                  cy={g.cy}
                  r={5 / mz.zoom}
                  className="island"
                  style={{ fill: heatColor(byName.get(g.name)!.heat) }}
                  onClick={() => pick(g.name)}
                  onMouseMove={(e) => showTip(e, g.name)}
                />
              ))}
            {selectedGeo.map((g, i) => (
              <path key={`sel-${i}`} d={g.d} className="ctry-sel" />
            ))}
            {selectedGeo[0] && (
              <g className="signal" pointerEvents="none">
                <circle cx={selectedGeo[0].cx} cy={selectedGeo[0].cy} r={5 / mz.zoom} />
                <circle cx={selectedGeo[0].cx} cy={selectedGeo[0].cy} r={5 / mz.zoom} />
                <circle
                  cx={selectedGeo[0].cx}
                  cy={selectedGeo[0].cy}
                  r={3.4 / mz.zoom}
                  className="signal-dot"
                />
              </g>
            )}
          </svg>
          <div className="map-zoom" role="group" aria-label="Map zoom">
            <button onClick={mz.zoomIn} disabled={mz.zoom >= MAX_ZOOM - 0.01} aria-label="Zoom in">
              +
            </button>
            <button onClick={mz.zoomOut} disabled={mz.zoom <= 1.01} aria-label="Zoom out">
              −
            </button>
            <button onClick={mz.reset} disabled={mz.zoom <= 1.01} aria-label="Show all of Africa" title="Show all of Africa">
              ⤢
            </button>
          </div>
          </div>
          {tip && (
            <div className="map-tip" style={{ left: tip.x, top: tip.y }}>
              <b>{tip.name}</b>
              {byName.get(tip.name) ? (
                <span>
                  {fmtBig(byName.get(tip.name)!.cases_now.p50)} people living
                  with SCD
                </span>
              ) : (
                <span>No data</span>
              )}
            </div>
          )}
          <div className="legend">
            <span className="legend-title">Fewer</span>
            <span className="legend-ramp">
              {HEAT_CLASSES.slice()
                .reverse()
                .map((c) => (
                  <i key={c.label} style={{ background: c.color }} title={c.label} />
                ))}
            </span>
            <span className="legend-title">More</span>
            <span className="legend-item legend-gap">
              <i className="legend-nodata" />
              No data
            </span>
          </div>
        </figure>

        <aside className="atlas-side">
          {error && <div className="alert">Couldn't load hotspots: {error}</div>}
          {!selected && !error && <p className="fine">Loading…</p>}
          {selected && cls && (
            <article className="country">
              <header className="country-head">
                <div>
                  <p className="eyebrow">Selected country</p>
                  <h2>{selected.country}</h2>
                </div>
                <span className="pill" style={{ background: cls.color, color: cls.ink }}>
                  {cls.label}
                </span>
              </header>

              <section className="block">
                <p className="block-label">
                  People living with sickle cell disease, {dataYear}
                </p>
                <p className="big">{fmtBig(selected.cases_now.p50)}</p>
                <p className="rng">
                  likely between {fmtBig(selected.cases_now.p10)} and{" "}
                  {fmtBig(selected.cases_now.p90)}
                </p>
              </section>

              <dl className="facts-list">
                <div>
                  <dt>Rank among {data?.items.length ?? 54} countries</dt>
                  <dd>#{rank}</dd>
                </div>
                <div>
                  <dt>Share of all people counted</dt>
                  <dd>{shareOfTotal}%</dd>
                </div>
              </dl>

              <p className="country-note">
                Modelled estimates from the Global Burden of Disease study, with
                a likely range. Not a medical device.
              </p>
            </article>
          )}
        </aside>
      </div>
    </>
  );
}

/* ───────────────────────── reservoir page ───────────────────────── */

const SCD_BANDS: { id: string; label: string }[] = [
  { id: "under_5", label: "Under 5" },
  { id: "age_5_14", label: "5–14" },
  { id: "age_15_24", label: "15–19" },
  { id: "age_25_plus", label: "20+" },
];

const fmtRate = (v: number) =>
  v >= 100 ? fmt(v) : v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2);

function SourceTag({ assumed }: { assumed: boolean }) {
  return (
    <span className={`src-tag ${assumed ? "is-assumed" : ""}`}>
      {assumed ? "Assumption" : "Sourced"}
    </span>
  );
}

function ReservoirPage({
  country,
  onBack,
}: {
  country: string;
  onBack: () => void;
}) {
  const [shareInCare, setShareInCare] = useState(0.3);
  const [r, setR] = useState<ReservoirResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!country) return;
    let live = true;
    setLoading(true);
    const t = window.setTimeout(() => {
      getReservoir(country, shareInCare)
        .then((d) => {
          if (!live) return;
          setR(d);
          setError(null);
        })
        .catch((e) => live && setError(String(e)))
        .finally(() => live && setLoading(false));
    }, 200);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [country, shareInCare]);

  const target = r?.target_days ?? 6;
  const ghostDays: Percentiles = { p10: 0, p50: 0, p90: 0 };
  const types = r?.types ?? [];
  const maxRate = Math.max(
    1,
    ...types.map((t) => Math.max(t.donated_per_day.p50, t.demand_per_day.p50)),
  );
  const short = types
    .filter((t) => t.extra_donations_per_day.p50 >= 0.5)
    .sort((a, b) => b.extra_donations_per_day.p50 - a.extra_donations_per_day.p50);
  const totalExtra = types.reduce((a, t) => a + t.extra_donations_per_day.p50, 0);

  return (
    <>
      <section className="hero">
        <p className="eyebrow">
          Modelled blood reservoir <span className="dot-sep">·</span>
          <span className={`live ${loading ? "is-busy" : ""}`}>
            {loading ? "re-running 10,000 draws" : "not live stock"}
          </span>
        </p>
        <div className="hero-place">
          Blood stock levels across
          <em className="hero-country">{country || "…"}</em>
        </div>
        <p className="hero-sub">
          How many days each blood group could hold, given what{" "}
          {country || "this country"} collects and what its hospitals and
          sickle cell patients use. Big number: median. Small: P10–P90 range.
          {r && (
            <>
              {" "}
              Collections from <b>{r.data_year}</b>, the latest WHO year.
            </>
          )}
        </p>
      </section>

      {error && <div className="alert">Couldn't load the reservoir: {error}</div>}

      <section
        className={`bags ${loading ? "is-busy" : ""}`}
        aria-label="Modelled blood stock by group"
      >
        {r
          ? r.types.map((t) => (
              <BloodBag
                key={t.blood_type}
                type={t.blood_type}
                days={t.days}
                status={t.status}
                target={target}
                max={target}
                ghost={false}
                caption={
                  <span className="bag-units">
                    <b>{fmtRate(t.donated_per_day.p50)}</b> donated/day
                  </span>
                }
              />
            ))
          : ["O+", "A+", "B+", "AB+", "O-", "A-", "B-", "AB-"].map((g) => (
              <BloodBag
                key={g}
                type={g}
                days={ghostDays}
                status="ok"
                target={target}
                max={target}
                ghost
              />
            ))}
      </section>

      <p className="target-note">
        {country || "This country"} aims to retain <b>{fmtDays(target)} days</b> of
        stock at any time. A full bag means that target is met.{" "}
        {r && <SourceTag assumed={r.target_is_assumption} />}
        {r && <span className="target-sub">{r.target_source}</span>}
      </p>

      <div className="split">
        <section className="panel">
          <header className="panel-head">
            <span className="panel-key">A</span>
            <h2>Donation rate by blood group</h2>
            <p>
              Whole-blood donations a day, split by the donor blood-group mix,
              against the units each group is used at.
            </p>
          </header>
          {r && (
            <>
              <p className="rate-total">
                <b>{fmt(r.donated_per_day)}</b> donations a day nationally (
                {r.donations_per_1000.toFixed(1)} per 1,000 people a year; WHO
                minimum is 10){" "}
                <SourceTag assumed={r.donations_is_assumption} />
              </p>
              <table className="rates">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Donors</th>
                    <th className="rates-bar-h">
                      <span className="k-don">Donated</span> vs{" "}
                      <span className="k-use">used</span> a day
                    </th>
                    <th title="Extra donations a day needed to cover use, after discards">
                      Extra donors a day
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {types.map((t) => (
                    <tr key={t.blood_type}>
                      <th scope="row">{t.blood_type.replace("-", "−")}</th>
                      <td>{(t.donor_share * 100).toFixed(1)}%</td>
                      <td className="rates-bar">
                        <span
                          className="bar bar-don"
                          style={{ width: `${(t.donated_per_day.p50 / maxRate) * 100}%` }}
                        />
                        <span
                          className="bar bar-use"
                          style={{ width: `${(t.demand_per_day.p50 / maxRate) * 100}%` }}
                        />
                        <small>
                          {fmtRate(t.donated_per_day.p50)} vs{" "}
                          {fmtRate(t.demand_per_day.p50)}
                        </small>
                      </td>
                      <td>
                        {t.extra_donations_per_day.p50 < 0.5 ? (
                          <span className="chip chip-ok">covered</span>
                        ) : (
                          <>
                            <b>{fmtRate(t.extra_donations_per_day.p50)}</b>
                            <small className="rates-range">
                              {fmtRate(t.extra_donations_per_day.p10)}–
                              {fmtRate(t.extra_donations_per_day.p90)}
                            </small>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="fine">
                Blood-group mix: {r.blood_type_source}.{" "}
                <SourceTag assumed={r.blood_type_is_assumption} />
                {r.donations_note && <> {r.donations_note}.</>}
              </p>
            </>
          )}
        </section>

        <section className="panel">
          <header className="panel-head">
            <span className="panel-key">B</span>
            <h2>Sickle cell pull on the reservoir</h2>
            <p>
              Units a day used by people with SCD who are in care, by age.
              Children are transfused by body weight.
            </p>
          </header>
          {r && (
            <>
              <dl className="res-rows">
                <div>
                  <dt>People living with SCD, {r.scd_data_year}</dt>
                  <dd>{fmtBig(r.scd_patients)}</dd>
                </div>
                <div>
                  <dt>SCD units a day</dt>
                  <dd>
                    {fmtRate(r.scd_demand_per_day.p50)}
                    <small>
                      {" "}
                      ({fmtRate(r.scd_demand_per_day.p10)}–
                      {fmtRate(r.scd_demand_per_day.p90)})
                    </small>
                  </dd>
                </div>
                <div>
                  <dt>Share of all blood used</dt>
                  <dd>
                    {pct(r.scd_share_of_demand.p50)}
                    <small>
                      {" "}
                      ({pct(r.scd_share_of_demand.p10)}–
                      {pct(r.scd_share_of_demand.p90)})
                    </small>
                  </dd>
                </div>
              </dl>
              <ul className="scd-ages">
                {SCD_BANDS.map((b) => {
                  const a = r.scd_by_age[b.id];
                  if (!a) return null;
                  const w = r.scd_demand_per_day.p50
                    ? (a.units_per_day.p50 / r.scd_demand_per_day.p50) * 100
                    : 0;
                  return (
                    <li key={b.id}>
                      <span>{b.label}</span>
                      <span className="scd-bar">
                        <i style={{ width: `${w}%` }} />
                      </span>
                      <b>{fmtRate(a.units_per_day.p50)}</b>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          <Dial
            label="People with SCD in care"
            value={shareInCare}
            min={0}
            max={1}
            step={0.05}
            format={pct}
            hint="Assumption: only diagnosed patients in care draw on the blood bank"
            onChange={setShareInCare}
          />
          {r && (
            <p className="fine">
              {short.length === 0
                ? "Every group covers its use under this scenario."
                : `To reach the target, ${country} needs about ${fmt(totalExtra)} more donations a day, most of all ${short
                    .slice(0, 3)
                    .map((t) => t.blood_type.replace("-", "−"))
                    .join(", ")}.`}
            </p>
          )}
        </section>
      </div>

      <section className="assume">
        <h3>What's sourced and what's assumed</h3>
        <p>
          These are <b>modelled</b> stock levels, not live blood-bank figures.
          Days of stock = the national target × (usable donations ÷ use),
          capped at the target. <b>Sourced:</b> whole-blood donations (WHO Global
          status report 2021, Annex 3), population (World Bank), blood-group mix
          where a national study exists, South Africa's 5-day target (SANBS),
          the share of units discarded (WHO Africa 2022 survey) and people
          living with SCD by age (GBD). <b>Calibrated:</b> everyday (non-sickle
          cell) blood need
          {r && (
            <>
              {" "}
              of {r.need_per_1000.min.toFixed(1)}–{r.need_per_1000.max.toFixed(1)}{" "}
              donations per 1,000 people a year
            </>
          )}
          , fitted to published national requirements (below).{" "}
          <b>Assumed:</b> the 6-day target where no country policy is
          published, the extra pull on O−, and the share of SCD patients in
          care. See <code>docs/METHOD.md</code>.
        </p>
        <CalibrationCheck />
        <div className="hero-actions">
          <button className="btn" onClick={onBack}>
            ← Back to hotspots
          </button>
        </div>
      </section>
    </>
  );
}

/** Published national requirements the need is calibrated to, against the model. */
function CalibrationCheck() {
  const [cal, setCal] = useState<CalibrationResponse | null>(null);
  useEffect(() => {
    getCalibration()
      .then(setCal)
      .catch(() => setCal(null));
  }, []);
  if (!cal) return null;
  return (
    <div className="calib">
      <p className="calib-head">
        Calibration check: published yearly requirement vs this model
      </p>
      <table className="rates calib-table">
        <thead>
          <tr>
            <th>Country</th>
            <th>Published</th>
            <th>Model (likely range)</th>
            <th>Fit</th>
          </tr>
        </thead>
        <tbody>
          {cal.rows.map((c) => {
            const m = c.modelled_units;
            const inside = c.requirement_units >= m.p10 && c.requirement_units <= m.p90;
            const off = (m.p50 - c.requirement_units) / c.requirement_units;
            return (
              <tr key={c.country}>
                <td>
                  <a href={c.url} target="_blank" rel="noreferrer" title={c.note}>
                    {c.country.replace("United Republic of ", "")}
                  </a>{" "}
                  <small className="rates-range">
                    {c.year} · {c.source}
                  </small>
                </td>
                <td>{fmtBig(c.requirement_units)}</td>
                <td>
                  {fmtBig(m.p50)}
                  <small className="rates-range">
                    {fmtBig(m.p10)}–{fmtBig(m.p90)}
                  </small>
                </td>
                <td>
                  <span className={`chip ${inside ? "chip-ok" : "chip-low"}`}>
                    {inside ? "in range" : `${off > 0 ? "+" : "−"}${Math.round(Math.abs(off) * 100)}%`}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="fine">
        Most national figures are themselves worked out from WHO's rule of
        thumb (10 per 1,000 people); Tanzania's is the only one measured in
        hospitals. Hover a country for its note.
      </p>
    </div>
  );
}

function Fact({
  k,
  p,
  suffix = "",
  big = false,
}: {
  k: string;
  p: Percentiles;
  suffix?: string;
  big?: boolean;
}) {
  const show = (v: number) =>
    big
      ? fmtBig(v)
      : (suffix ? v.toFixed(Math.abs(v) < 10 ? 1 : 0) : fmt(v)) + suffix;
  return (
    <div className="fact">
      <dt>{k}</dt>
      <dd>
        <b>{show(p.p50)}</b>
        <small>
          {show(p.p10)}–{show(p.p90)}
        </small>
      </dd>
    </div>
  );
}

/* ───────────────────────── page 03: field briefing ───────────────────────── */

function BriefingPage({
  countries,
  country,
  setCountry,
  month,
  setMonth,
}: {
  countries: string[];
  country: string;
  setCountry: (c: string) => void;
  month: string;
  setMonth: (m: string) => void;
}) {
  const [checklist, setChecklist] = useState<BriefingResponse | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!country) return;
    setChecklist(null);
    getBriefing(country, month)
      .then(setChecklist)
      .catch(() => setChecklist(null));
  }, [country, month]);

  useEffect(() => {
    setMessages([]);
  }, [country]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, sending]);

  const suggestions = [
    `What should our team know before travelling to ${country || "this country"} in ${month}?`,
    "Which vaccinations and health precautions should we check?",
    "How do we partner with the national blood service?",
    "Are there cultural considerations around giving blood?",
    "What should we ask local partners on day one?",
  ];

  const send = (text: string) => {
    const q = text.trim();
    if (!q || sending || !country) return;
    const history: ChatMessage[] = [...messages, { role: "user", text: q }];
    setMessages(history);
    setDraft("");
    setSending(true);
    askAssistant(country, month, q, messages)
      .then((r) =>
        setMessages([
          ...history,
          { role: "assistant", text: r.answer, sources: r.sources },
        ]),
      )
      .catch(() =>
        setMessages([
          ...history,
          {
            role: "assistant",
            offline: true,
            text: "The assistant isn't connected yet; this is a UI preview. Once /api/assistant is live, answers for this trip will appear here. Meanwhile, use the checklist on the left and check your government's official travel advice.",
          },
        ]),
      )
      .finally(() => setSending(false));
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(draft);
    }
  };

  return (
    <>
      <section className="hero hero-left">
        <p className="eyebrow">
          Gemini field assistant · ungrounded, verify everything
        </p>
        <h1 className="hero-title">
          Before you fly, <em>ask the briefing desk</em>
        </h1>
      </section>

      <div className="desk">
        <aside className="trip">
          <div className="ticket">
            <span className="ticket-k">Destination</span>
            <span className="select-wrap select-sm">
              <select
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              >
                {countries.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </span>
            <span className="ticket-k">Travelling in</span>
            <span className="select-wrap select-sm">
              <select value={month} onChange={(e) => setMonth(e.target.value)}>
                {MONTHS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </span>
            <span className="ticket-perf" aria-hidden />
            <span className="ticket-code">
              SCD-DRIVE · {country.slice(0, 3).toUpperCase() || "---"} ·{" "}
              {month.slice(0, 3).toUpperCase()}
            </span>
          </div>

          <div className="checklist">
            <h3>Pre-trip checklist</h3>
            {!checklist && <p className="muted">Loading…</p>}
            {checklist?.fallback_used && (
              <p className="chip chip-low">Static fallback</p>
            )}
            {checklist?.sections.map((sec) => (
              <details
                key={sec.title}
                open={sec.title === checklist.sections[0]?.title}
              >
                <summary>{sec.title}</summary>
                <ul>
                  {sec.items.map((it, i) => (
                    <li key={i}>
                      {it.text}
                      <span className="verify">
                        <i className={`conf conf-${it.confidence}`}>
                          {it.confidence}
                        </i>{" "}
                        verify with {it.verify_with}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </aside>

        <section className="chat">
          <div className="chat-log">
            {messages.length === 0 && (
              <div className="chat-empty">
                <p className="chat-hello">
                  Ask about safety, health precautions, logistics or local
                  partners for a blood drive in <b>{country || "…"}</b> in{" "}
                  <b>{month}</b>.
                </p>
                <div className="prompts">
                  {suggestions.map((s) => (
                    <button key={s} className="prompt" onClick={() => send(s)}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`msg msg-${m.role} ${m.offline ? "is-offline" : ""}`}
              >
                <span className="msg-who">
                  {m.role === "user" ? "You" : "Briefing desk"}
                </span>
                <p>{m.text}</p>
                {m.sources && m.sources.length > 0 && (
                  <ul className="msg-src">
                    {m.sources.map((s) => (
                      <li key={s}>{s}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {sending && (
              <div className="msg msg-assistant">
                <span className="msg-who">Briefing desk</span>
                <span className="typing">
                  <i />
                  <i />
                  <i />
                </span>
              </div>
            )}
            <div ref={endRef} />
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(draft);
            }}
          >
            <textarea
              rows={2}
              value={draft}
              placeholder={`Ask about ${country || "your destination"}…`}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
            />
            <button className="btn" disabled={!draft.trim() || sending}>
              Send
            </button>
          </form>
          <p className="fine">
            AI answers can be wrong or out of date. Check current safety advice
            on your government's official travel site and with the national
            blood service.
          </p>
        </section>
      </div>
    </>
  );
}
