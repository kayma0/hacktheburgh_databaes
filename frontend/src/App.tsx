import { useEffect, useId, useMemo, useRef, useState } from "react";
import africaGeo from "./africaGeo.json";
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import {
  askAssistant,
  getBriefing,
  getCountries,
  getHealth,
  getHotspots,
  simulate,
} from "./api";
import type {
  BloodTypeStock,
  BriefingResponse,
  ChatMessage,
  HotspotItem,
  HotspotsResponse,
  Percentiles,
  YearPoint,
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

type Page = "hotspots" | "stock" | "briefing" | "blank";
// "blank" is a placeholder for the next page to build; it is reached from the
// hotspots page button rather than from the tab bar.
const PAGES: { id: Page; num: string; label: string }[] = [
  { id: "hotspots", num: "01", label: "Hotspots" },
  { id: "stock", num: "02", label: "Blood stock" },
  { id: "briefing", num: "03", label: "Field briefing" },
];
const ALL_PAGES: Page[] = ["hotspots", "stock", "briefing", "blank"];

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

/* Demo session only: no real authentication; the password is never stored. */
type Session = { org: string; email: string; country: string };
const SESSION_KEY = "sicklesignal.session";
function loadSession(): Session | null {
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}
function saveSession(s: Session | null) {
  try {
    if (s) window.localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable: session lasts for this tab only */
  }
}

export default function App() {
  const [session, setSession] = useState<Session | null>(loadSession);
  const [page, setPage] = useState<Page>(readPage);
  const [countries, setCountries] = useState<string[]>([]);
  const [country, setCountryState] = useState(session?.country ?? "");

  const setCountry = (c: string) => {
    setCountryState(c);
    setSession((s) => {
      if (!s) return s;
      const next = { ...s, country: c };
      saveSession(next);
      return next;
    });
  };
  const [month, setMonth] = useState(MONTHS[new Date().getMonth()]);
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

  if (!session) {
    return (
      <Login
        countries={countries}
        isSample={isSample}
        onLogin={(s) => {
          saveSession(s);
          setSession(s);
          setCountryState(s.country);
          go("hotspots");
        }}
      />
    );
  }

  const signOut = () => {
    saveSession(null);
    setSession(null);
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
          <div className="who">
            <span className="who-org" title={session.email}>
              {session.org}
            </span>
            <button className="who-out" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="page">
        {page === "stock" && (
          <StockPage
            countries={countries}
            country={country}
            setCountry={setCountry}
          />
        )}
        {page === "hotspots" && (
          <HotspotsPage
            onOpen={(c) => {
              setCountry(c);
              go("stock");
            }}
            onBlank={() => go("blank")}
          />
        )}
        {page === "blank" && <BlankPage onBack={() => go("hotspots")} />}
        {page === "briefing" && (
          <BriefingPage
            countries={countries}
            country={country}
            setCountry={setCountry}
            month={month}
            setMonth={setMonth}
          />
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

/* ───────────────────────── login ───────────────────────── */

function Login({
  countries,
  isSample,
  onLogin,
}: {
  countries: string[];
  isSample: boolean;
  onLogin: (s: Session) => void;
}) {
  const [org, setOrg] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [country, setCountry] = useState("");

  useEffect(() => {
    if (!country && countries.length) setCountry(countries[0]);
  }, [countries, country]);

  const ready =
    org.trim() && email.includes("@") && password.length > 0 && country;

  return (
    <div className="login">
      <section className="login-art">
        <a className="brand" href="#/stock" aria-label="SickleSignal">
          <BrandMark />
          <span className="brand-word">
            <em>Sickle</em>Signal
          </span>
        </a>
        <h1>
          See what the blood bank can give <em>before</em> the next crisis does.
        </h1>
        <p>
          Modelled blood stock, sickle cell hotspots and field briefings for
          charities running donation drives.
        </p>
        <div className="login-groups" aria-hidden>
          {["O+", "A+", "B+", "AB+", "O−", "A−", "B−", "AB−"].map((g, i) => (
            <span
              key={g}
              style={
                {
                  "--lvl": `${[42, 64, 58, 80, 22, 70, 55, 86][i]}%`,
                } as CSSProperties
              }
            >
              {g}
            </span>
          ))}
        </div>
        {isSample && <span className="stamp">Sample data</span>}
      </section>

      <form
        className="login-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onLogin({ org: org.trim(), email: email.trim(), country });
        }}
      >
        <p className="eyebrow">Charity sign-in</p>
        <h2>Open your blood bank</h2>
        <label className="field">
          <span>Organisation</span>
          <input
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="e.g. Sickle Cell Society"
            autoComplete="organization"
          />
        </label>
        <label className="field">
          <span>Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@charity.org"
            autoComplete="email"
          />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </label>
        <label className="field">
          <span>Which country's blood bank?</span>
          <span className="select-wrap select-sm select-field">
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
            >
              {countries.length === 0 && (
                <option value="">Loading countries…</option>
              )}
              {countries.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </span>
        </label>
        <button className="btn btn-wide" disabled={!ready}>
          Enter the blood bank →
        </button>
        <p className="fine">
          Demo sign-in: nothing is checked or sent to a server, and the password
          isn't stored. You can switch country any time after signing in.
        </p>
      </form>
    </div>
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
            s={s}
            target={target}
            max={bagMax}
            ghost={!result}
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
  s,
  target,
  max,
  ghost,
}: {
  s: BloodTypeStock;
  target: number;
  max: number;
  ghost: boolean;
}) {
  const clip = useId().replace(/:/g, "");
  const top = 34;
  const bottom = 146;
  const h = bottom - top;
  const fill = clamp(s.days_of_cover.p50 / max, 0, 1);
  const level = bottom - fill * h;
  const targetY = bottom - clamp(target / max, 0, 1) * h;
  const label = s.blood_type.replace("-", "−");

  return (
    <figure className={`bag bag-${s.status} ${ghost ? "is-ghost" : ""}`}>
      <svg
        viewBox="0 0 100 176"
        role="img"
        aria-label={`${label}: ${fmtDays(s.days_of_cover.p50)} days`}
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
        <span className="bag-days">
          {ghost ? "–" : fmtDays(s.days_of_cover.p50)}
        </span>
        <span className="bag-unit">days</span>
        {!ghost && (
          <>
            <span className="bag-range">
              {fmtDays(s.days_of_cover.p10)}–{fmtDays(s.days_of_cover.p90)}
            </span>
            <span className="bag-units">
              <b>{fmt(s.units_after_crisis.p50)}</b> / {fmt(s.target_units)}{" "}
              units
            </span>
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
  { min: 0.4, label: "Very high", color: "#7A0000" },
  { min: 0.2, label: "High", color: "#B22222" },
  { min: 0.1, label: "Moderate", color: "#D96A5C" },
  { min: 0.03, label: "Low", color: "#EFA48E" },
  { min: 0, label: "Very low", color: "#F9DDD1" },
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

/** A big number with its P10–P90 range underneath. */
function Stat({
  label,
  p,
  prefix = "",
  suffix = "",
  digits = 0,
  tone,
}: {
  label: string;
  p: Percentiles;
  prefix?: string;
  suffix?: string;
  digits?: number;
  tone?: "up" | "down";
}) {
  const f = (v: number) =>
    digits ? `${v.toFixed(digits)}${suffix}` : `${fmtBig(v)}${suffix}`;
  const sign = (v: number) => (v > 0 && prefix ? prefix : "");
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ""}`}>
      <span className="stat-label">{label}</span>
      <b className="stat-value">
        {sign(p.p50)}
        {f(p.p50)}
      </b>
      <small className="stat-range">
        likely {f(p.p10)} to {f(p.p90)}
      </small>
    </div>
  );
}

/** History (solid) + projection (dashed, with P10–P90 band) for one country. */
function TrendChart({
  history,
  path,
  dataYear,
}: {
  history: YearPoint[];
  path: YearPoint[];
  dataYear: number;
}) {
  const W = 400;
  const H = 170;
  const padL = 44;
  const padB = 22;
  const padT = 10;
  const all = [...history, ...path];
  const x0 = history[0]?.year ?? dataYear;
  const x1 = path[path.length - 1]?.year ?? dataYear;
  const yMax = niceCeil(Math.max(...all.map((p) => p.p90), 1));
  const X = (yr: number) => padL + ((yr - x0) / (x1 - x0 || 1)) * (W - padL - 8);
  const Y = (v: number) => padT + (1 - v / yMax) * (H - padT - padB);
  const line = (pts: YearPoint[], k: "p10" | "p50" | "p90") =>
    pts
      .map((p, i) => `${i ? "L" : "M"}${X(p.year).toFixed(1)} ${Y(p[k]).toFixed(1)}`)
      .join(" ");
  const band =
    path.length > 1
      ? `${line(path, "p90")} ${[...path]
          .reverse()
          .map((p) => `L${X(p.year).toFixed(1)} ${Y(p.p10).toFixed(1)}`)
          .join(" ")} Z`
      : "";
  const ticks = [0, 0.5, 1].map((f) => f * yMax);
  const xt = [x0, dataYear, x1];
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="trend"
      role="img"
      aria-label="People living with SCD to date and projection"
    >
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W - 8} y1={Y(t)} y2={Y(t)} className="trend-grid" />
          <text x={padL - 6} y={Y(t) + 3} textAnchor="end" className="trend-tick">
            {fmtBig(t)}
          </text>
        </g>
      ))}
      {band && <path d={band} className="trend-band" />}
      <path d={line(history, "p50")} className="trend-hist" />
      <path d={line(path, "p50")} className="trend-proj" />
      <line x1={X(dataYear)} x2={X(dataYear)} y1={padT} y2={H - padB} className="trend-now" />
      {xt.map((yr, i) => (
        <text
          key={`${yr}-${i}`}
          x={X(yr)}
          y={H - 6}
          textAnchor={i === 0 ? "start" : i === 2 ? "end" : "middle"}
          className="trend-tick"
        >
          {yr}
        </text>
      ))}
    </svg>
  );
}

function HotspotsPage({
  onOpen,
  onBlank,
}: {
  onOpen: (country: string) => void;
  onBlank: () => void;
}) {
  const [data, setData] = useState<HotspotsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [horizon, setHorizon] = useState(2035);
  // The slider moves freely; the request is sent once it settles.
  const [query, setQuery] = useState(2035);
  const [tip, setTip] = useState<{ name: string; x: number; y: number } | null>(
    null,
  );
  const figRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(horizon), 250);
    return () => window.clearTimeout(t);
  }, [horizon]);

  useEffect(() => {
    let live = true;
    setError(null);
    getHotspots(query)
      .then((d) => {
        if (!live) return;
        setData(d);
        setSel((cur) => cur ?? d.items[0]?.country ?? null);
      })
      .catch((e) => live && setError(String(e)));
    return () => {
      live = false;
    };
  }, [query]);

  const byName = useMemo(
    () => new Map((data?.items ?? []).map((i) => [i.country, i])),
    [data],
  );
  const selected = data?.items.find((i) => i.country === sel) ?? null;
  const selectedGeo = GEO.countries.filter((g) => g.name === sel);
  const dataYear = data?.data_year ?? 2023;
  const hz = data?.horizon ?? query;

  const showTip = (e: ReactMouseEvent, name: string) => {
    const r = figRef.current?.getBoundingClientRect();
    if (r) setTip({ name, x: e.clientX - r.left, y: e.clientY - r.top });
  };

  return (
    <div className="atlas">
      <figure className="map-card" ref={figRef}>
        <svg
          viewBox={`0 0 ${GEO.w} ${GEO.h}`}
          className="map"
          role="img"
          aria-label="Map of Africa, each country shaded by sickle cell heat"
          onMouseLeave={() => setTip(null)}
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
                onClick={() => it && setSel(g.name)}
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
                r={5}
                className="island"
                style={{ fill: heatColor(byName.get(g.name)!.heat) }}
                onClick={() => setSel(g.name)}
                onMouseMove={(e) => showTip(e, g.name)}
              />
            ))}
          {selectedGeo.map((g, i) => (
            <path key={`sel-${i}`} d={g.d} className="ctry-sel" />
          ))}
        </svg>
        {tip && (
          <div className="map-tip" style={{ left: tip.x, top: tip.y }}>
            <b>{tip.name}</b>
            {byName.get(tip.name) ? (
              <span>
                {heatClass(byName.get(tip.name)!.heat).label} ·{" "}
                {fmtBig(byName.get(tip.name)!.cases_now.p50)} people today
              </span>
            ) : (
              <span>No data</span>
            )}
          </div>
        )}
        <figcaption className="legend">
          {HEAT_CLASSES.slice()
            .reverse()
            .map((c) => (
              <span key={c.label} className="legend-item">
                <i style={{ background: c.color }} />
                {c.label}
              </span>
            ))}
          <span className="legend-item">
            <i className="legend-nodata" />
            No data
          </span>
        </figcaption>
      </figure>

      <aside className="atlas-side">
        {error && <div className="alert">Couldn't load hotspots: {error}</div>}
        {!selected && !error && <p className="fine">Loading…</p>}
        {selected && (
          <article className="country">
            <header className="country-head">
              <div>
                <p className="eyebrow">Sickle cell disease</p>
                <h2>{selected.country}</h2>
              </div>
              <span
                className="pill"
                style={{ background: heatColor(selected.heat) }}
              >
                {heatClass(selected.heat).label}
              </span>
            </header>

            <div className="stat-pair">
              <Stat label={`People living with SCD, ${dataYear}`} p={selected.cases_now} />
              <Stat label={`Expected by ${hz}`} p={selected.cases_horizon} />
            </div>

            <TrendChart
              history={selected.history}
              path={selected.path}
              dataYear={dataYear}
            />
            <p className="trend-key">
              <span>
                <i className="k-hist" />
                Measured
              </span>
              <span>
                <i className="k-proj" />
                Projected, shaded range
              </span>
            </p>

            <Dial
              label="Look ahead to"
              value={horizon}
              min={2025}
              max={2050}
              step={1}
              format={(v) => String(v)}
              onChange={setHorizon}
            />

            <dl className="rows">
              <div>
                <dt>Change by {hz}</dt>
                <dd>
                  {selected.change.p50 >= 0 ? "+" : "−"}
                  {fmtBig(Math.abs(selected.change.p50))}
                  <small>
                    {" "}
                    ({selected.growth_pct_per_year.p50 >= 0 ? "+" : "−"}
                    {Math.abs(selected.growth_pct_per_year.p50).toFixed(1)}% a
                    year)
                  </small>
                </dd>
              </div>
              <div>
                <dt>Newborns with SCD a year, {hz}</dt>
                <dd>
                  {fmtBig(selected.births_per_year_horizon.p50)}
                  <small>
                    {" "}
                    ({fmtBig(selected.births_per_year_horizon.p10)}–
                    {fmtBig(selected.births_per_year_horizon.p90)})
                  </small>
                </dd>
              </div>
            </dl>

            <p className="country-note">
              Modelled estimates with a likely range, not observations. Newborns
              are the children early screening could reach.
            </p>

            <button className="btn" onClick={onBlank}>
              Next page →
            </button>
          </article>
        )}
      </aside>
    </div>
  );
}

function BlankPage({ onBack }: { onBack: () => void }) {
  return (
    <section className="hero hero-left">
      <p className="eyebrow">Next page</p>
      <h1 className="hero-title">
        <em>Blank</em> for now
      </h1>
      <p className="hero-sub">This page is reserved for what we build next.</p>
      <div className="hero-actions">
        <button className="btn" onClick={onBack}>
          ← Back to hotspots
        </button>
      </div>
    </section>
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
