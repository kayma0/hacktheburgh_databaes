import { useEffect, useId, useMemo, useRef, useState } from "react";
import africaGeo from "./africaGeo.json";
import { AuthControls, useAuth } from "./auth";
import { deleteSavedPlan, listSavedPlans, savePlan } from "./savedPlans";
import type { SavedPlanItem } from "./savedPlans";
import type {
  CSSProperties,
  KeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  draftCrisisAppeal,
  getBriefing,
  getCountries,
  getCrisis,
  getHotspots,
  getBacktest,
  getPlan,
  getSensitivity,
  writeAppeal,
  getReservoir,
} from "./api";
import type {
  CrisisAppealResponse,
  BriefingResponse,
  CrisisResponse,
  HotspotItem,
  HotspotsResponse,
  AppealChannel,
  AppealLanguage,
  AppealResponse,
  AppealTone,
  BacktestResponse,
  SensitivityResponse,
  PlanInputs,
  PlanResponse,
  Percentiles,
  ReservoirResponse,
  StockStatus,
} from "./api";

/* ───────────────────────── helpers ───────────────────────── */

// Flow: map -> reservoir (+ crisis test) -> drive plan (+ appeal) -> before you travel.
// Pages are reached through the buttons on each page, not a nav bar.
type Page = "hotspots" | "reservoir" | "plan" | "briefing";
const ALL_PAGES: Page[] = ["hotspots", "reservoir", "plan", "briefing"];

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
  const h = window.location.hash.replace("#/", "").split("?")[0];
  return ALL_PAGES.includes(h as Page) ? (h as Page) : "hotspots";
}

/* ───────────────────────── app shell ───────────────────────── */

export default function App() {
  const [page, setPage] = useState<Page>(readPage);
  // Bumped to rebuild the plan page when a saved plan is opened from inside it.
  const [planKey, setPlanKey] = useState(0);
  const [countries, setCountries] = useState<string[]>([]);
  const [country, setCountryState] = useState("");
  const setCountry = (c: string) => setCountryState(c);

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
  }, []);

  const go = (p: Page, query = "") => {
    window.location.hash = `#/${p}${query ? `?${query}` : ""}`;
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="shell">
      <header className={`mast ${page === "hotspots" ? "is-wide" : ""}`}>
        <div className="mast-inner">
          <a className="brand" href="#/hotspots" aria-label="SickleSignal home">
            <BrandMark />
            <span className="brand-word">
              <em>Sickle</em>Signal
            </span>
          </a>
          <AuthControls />
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
          <ReservoirPage
            country={country}
            onBack={() => go("hotspots")}
            onPlan={(s) =>
              go(
                "plan",
                planQueryString({
                  country,
                  people: s.people,
                  days: s.days,
                  deferral: PLAN_DEFAULTS.deferral,
                  donationsPerDonor: PLAN_DEFAULTS.donationsPerDonor,
                  coverage: PLAN_DEFAULTS.coverage,
                  oNegFallback: s.oNegFallback,
                  crisisFirst: s.crisisFirst,
                }),
              )
            }
          />
        )}
        {page === "plan" && (
          <PlanPage
            key={planKey}
            country={country}
            onCountry={setCountry}
            onBack={() => go("reservoir")}
            onTravel={(c) => go("briefing", `c=${encodeURIComponent(c)}`)}
            onOpenSaved={(q) => {
              window.history.replaceState(null, "", `#/plan?${q}`);
              setPlanKey((k) => k + 1);
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        )}
        {page === "briefing" && (
          <TravelBriefPage
            country={country}
            onCountry={setCountry}
            onBack={() =>
              window.history.length > 1 ? window.history.back() : go("reservoir")
            }
          />
        )}
      </main>

      <footer className={`foot ${page === "hotspots" ? "is-wide" : ""}`}>
        <span>SickleSignal</span>
        <span>
          Not a medical device · No clinical advice · Aggregate, modelled
          estimates only
        </span>
      </footer>
    </div>
  );
}

function BrandMark() {
  // The SickleSignal logo: a blood drop with two signal arcs above it.
  return (
    <svg className="brand-mark" viewBox="60 60 1056 880" aria-hidden>
      <path d="M85 318Q588-152 1091 318Q588 32 85 318Z" fill="#F0AAB4" />
      <path d="M202 417Q588 57 973 417Q588 211 202 417Z" fill="#E5667A" />
      <path d="M588 377L430 650A183 183 0 1 0 746 650Z" fill="#D81F3A" />
    </svg>
  );
}

function BloodBag({
  type,
  days,
  status,
  target,
  max,
  ghost,
  caption,
  showRange = true,
}: {
  type: string;
  days: Percentiles;
  status: StockStatus;
  target: number;
  max: number;
  ghost: boolean;
  caption?: ReactNode;
  /** The small P10–P90 pill under the days. */
  showRange?: boolean;
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
            {showRange && (
              <span className="bag-range">
                {fmtDays(days.p10)}–{fmtDays(days.p90)}
              </span>
            )}
            {caption}
          </>
        )}
      </figcaption>
    </figure>
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
// The map is coloured by the legend bucket from data/processed/heatmap.json.
const BUCKET_CLASS: Record<string, number> = {
  "very high": 0,
  high: 1,
  moderate: 2,
  low: 3,
  "very low": 4,
};
const bucketClass = (b: string) => HEAT_CLASSES[BUCKET_CLASS[b] ?? 4];

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
  const year = data?.year ?? 2026;
  const dataYear = data?.data_year ?? 2023;

  const showTip = (e: ReactMouseEvent, name: string) => {
    const r = figRef.current?.getBoundingClientRect();
    if (r) setTip({ name, x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const cls = selected ? bucketClass(selected.bucket) : null;
  const rank = selected ? (data?.items.findIndex((i) => i.country === selected.country) ?? 0) + 1 : 0;
  const totalCases = (data?.items ?? []).reduce((a, i) => a + i.cases, 0) || 1;
  const shareOfTotal = selected
    ? ((selected.cases / totalCases) * 100).toFixed(
        selected.cases / totalCases < 0.1 ? 1 : 0,
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
                  style={it ? { fill: bucketClass(it.bucket).color } : undefined}
                  onClick={() => it && pick(g.name)}
                  onMouseMove={(e) => showTip(e, g.name)}
                  tabIndex={it ? 0 : -1}
                  role={it ? "button" : undefined}
                  aria-label={
                    it ? `${g.name}, ${bucketClass(it.bucket).label}` : undefined
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
                  style={{ fill: bucketClass(byName.get(g.name)!.bucket).color }}
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
                  {fmtBig(byName.get(tip.name)!.cases)} people living
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
                  People living with sickle cell disease, {year} (estimated)
                </p>
                <p className="big">{fmtBig(selected.cases)}</p>
                <p className="rng">
                  likely between {fmtBig(selected.cases_low)} and{" "}
                  {fmtBig(selected.cases_high)}
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
                Estimated for {year} by carrying the Global Burden of Disease
                trend forward from {dataYear}. Modelled, not observed. Not a
                medical device.
              </p>

              <button className="btn" onClick={() => onNext(selected.country)}>
                {selected.country}'s blood reservoir →
              </button>
            </article>
          )}
        </aside>
      </div>
    </>
  );
}

/* ───────────────────────── reservoir page ───────────────────────── */

const fmtRate = (v: number) =>
  v >= 100 ? fmt(v) : v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2);

function SourceTag({ assumed, title }: { assumed: boolean; title?: string }) {
  return (
    <span className={`src-tag ${assumed ? "is-assumed" : ""}`} title={title}>
      {assumed ? "Assumption" : "Sourced"}
    </span>
  );
}

const ALL_GROUPS = ["O+", "A+", "B+", "AB+", "O-", "A-", "B-", "AB-"];
const groupLabel = (g: string) => g.replace("-", "−");

/* Time-frame slider: positions 0–100 map onto 1–365 days on a log scale, so a day, a
   week and a month are as easy to pick as a whole year. */
const MAX_WINDOW = 365;
const posToDays = (p: number) =>
  Math.max(1, Math.min(MAX_WINDOW, Math.round(Math.exp((p / 100) * Math.log(MAX_WINDOW)))));
const daysToPos = (d: number) => (Math.log(Math.max(d, 1)) / Math.log(MAX_WINDOW)) * 100;
const fmtWindow = (d: number) => {
  const base = `${d} day${d === 1 ? "" : "s"}`;
  if (d >= 360) return `${base} (about a year)`;
  if (d >= 56) return `${base} (about ${Math.round(d / 30.4)} months)`;
  if (d >= 14) return `${base} (about ${Math.round(d / 7)} weeks)`;
  return base;
};

/** "a, b and c" */
const listJoin = (xs: string[]) =>
  xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;

const AGE_ORDER = ["under_5", "children", "teens", "adults"] as const;
const AGE_SINGULAR: Record<string, string> = {
  under_5: "under-5",
  children: "child aged 5–9",
  teens: "teen aged 10–19",
  adults: "adult aged 20+",
};

type SimSettings = { people: number; days: number; oNegFallback: boolean; crisisFirst: boolean };

function ReservoirPage({
  country,
  onBack,
  onPlan,
}: {
  country: string;
  onBack: () => void;
  onPlan: (s: SimSettings) => void;
}) {
  const [sim, setSim] = useState<SimSettings>(SIM_DEFAULTS);
  const [r, setR] = useState<ReservoirResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!country) return;
    let live = true;
    setLoading(true);
    getReservoir(country, 0.3)
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
  const ghostDays: Percentiles = { p10: 0, p50: 0, p90: 0 };

  return (
    <>
      <div className="page-back">
        <button className="btn btn-ghost" onClick={onBack}>
          ← Back to hotspots
        </button>
      </div>
      <section className="hero">
        <p className="eyebrow">
          <span className={`live ${loading ? "is-busy" : ""}`}>
            {loading ? "loading" : "not live stock"}
          </span>
        </p>
        <div className="hero-place">
          Blood stock levels across
          <em className="hero-country">{country || "…"}</em>
        </div>
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
                showRange={false}
                caption={
                  <span className="bag-units">
                    <b>{fmtRate(t.donated_per_day.p50)}</b> donated/day
                  </span>
                }
              />
            ))
          : ALL_GROUPS.map((g) => (
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
        Full bag = <b>{fmtDays(target)}-day</b> target{" "}
        {r && <SourceTag assumed={r.target_is_assumption} title={r.target_source} />}
      </p>

      <CrisisSimulator country={country} onSettings={setSim} />

      <div className="hero-actions">
        <button className="btn" onClick={() => onPlan(sim)} disabled={!country}>
          Plan the drive for {country || "this country"} →
        </button>
        <button className="btn btn-ghost" onClick={onBack}>
          ← Back to hotspots
        </button>
      </div>
    </>
  );
}

/* ───────────── crisis simulator: two sliders, two options, run + reset ───────────── */

const SIM_DEFAULTS = { people: 25, days: 30, oNegFallback: false, crisisFirst: false };

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`toggle ${checked ? "is-on" : ""}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden>
        <span className="toggle-knob" />
      </span>
      <span className="toggle-text">
        <b>{label}</b>
        <small>{hint}</small>
      </span>
    </label>
  );
}

function CrisisSimulator({
  country,
  onSettings,
}: {
  country: string;
  onSettings?: (s: SimSettings) => void;
}) {
  const [people, setPeople] = useState(SIM_DEFAULTS.people);
  const [windowPos, setWindowPos] = useState(daysToPos(SIM_DEFAULTS.days));
  const [oNegFallback, setONegFallback] = useState(SIM_DEFAULTS.oNegFallback);
  const [crisisFirst, setCrisisFirst] = useState(SIM_DEFAULTS.crisisFirst);
  const days = posToDays(windowPos);
  // Tell the page what is set, so "Plan the drive" starts from the same crisis.
  useEffect(() => {
    onSettings?.({ people, days, oNegFallback, crisisFirst });
  }, [people, days, oNegFallback, crisisFirst]); // eslint-disable-line react-hooks/exhaustive-deps
  const [res, setRes] = useState<CrisisResponse | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Results describe the inputs they were run with; flag when anything has changed.
  const stale =
    !!res &&
    (res.people !== people ||
      res.days !== days ||
      res.country !== country ||
      res.o_neg_fallback !== oNegFallback ||
      res.crisis_first !== crisisFirst);
  const isDefault =
    people === SIM_DEFAULTS.people &&
    days === SIM_DEFAULTS.days &&
    oNegFallback === SIM_DEFAULTS.oNegFallback &&
    crisisFirst === SIM_DEFAULTS.crisisFirst &&
    !res;

  useEffect(() => {
    setRes(null);
    setError(null);
  }, [country]);

  const run = () => {
    if (!country) return;
    setRunning(true);
    setError(null);
    getCrisis(country, people, days, { oNegFallback, crisisFirst })
      .then(setRes)
      .catch((e) => setError(String(e)))
      .finally(() => setRunning(false));
  };

  const reset = () => {
    setPeople(SIM_DEFAULTS.people);
    setWindowPos(daysToPos(SIM_DEFAULTS.days));
    setONegFallback(SIM_DEFAULTS.oNegFallback);
    setCrisisFirst(SIM_DEFAULTS.crisisFirst);
    setRes(null);
    setError(null);
  };

  return (
    <section className="panel sim">
      <header className="panel-head">
        <h2>Crisis simulator</h2>
        <p>
          What if people with sickle cell go into crisis? Will there be enough blood?
        </p>
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
        <Toggle
          label="Crisis patients first"
          hint="Other patients wait"
          checked={crisisFirst}
          onChange={setCrisisFirst}
        />
      </div>

      <div className="sim-actions">
        <button className="btn sim-run" onClick={run} disabled={running || !country}>
          {running ? "Simulating…" : res ? "Run again" : "Run simulation"}
        </button>
        <button className="btn btn-ghost" onClick={reset} disabled={running || isDefault}>
          ↺ Reset to default blood rates
        </button>
      </div>

      {error && <div className="alert">Simulation failed: {error}</div>}
      {res && <CrisisResult res={res} stale={stale} />}
    </section>
  );
}

/* Donated blood is tested and processed before use (typically 1-2 days), so donors must
   give this many days before the shortage they cover. */
const PROCESSING_DAYS = 2;

/** Day N of the window as a calendar date from today, e.g. "Mon 10 Nov". */
const dayToDate = (day: number) => {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(0, Math.floor(day)));
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
};

function CrisisResult({ res, stale }: { res: CrisisResponse; stale: boolean }) {
  const span = fmtWindow(res.days).replace(/ \(.*\)$/, "");
  const without = res.example.filter((p) => !p.served).length;
  const groups = res.by_group.filter((g) => g.share_of_sims_with_patients > 0.05);
  const short = new Set(res.lacking);
  const risky = new Set(res.at_risk);
  // Most urgent first: earliest deadline, then most donors.
  const plan = [...res.by_group]
    .filter((g) => g.donors_to_cover > 0)
    .sort(
      (a, b) =>
        (a.deadline_day ?? Infinity) - (b.deadline_day ?? Infinity) ||
        b.donors_to_cover - a.donors_to_cover,
    );
  const firstDeadline = plan.find((g) => g.deadline_day !== null)?.deadline_day ?? null;
  const weeks = res.days / 7;
  const ageLabel = (a: string, n: number) =>
    n === 1 ? AGE_SINGULAR[a] : res.age_group_labels[a].replace(/(\d)-(\d)/g, "$1–$2");
  const who = AGE_ORDER.filter((a) => res.example_counts[a] > 0).map((a) => {
    const n = res.example_counts[a];
    const lost = res.example.filter((p) => p.age_group === a && !p.served).length;
    return { a, n, lost };
  });
  // Recruit-by date: PROCESSING_DAYS before the shortage it covers.
  const byWhen = (day: number | null) => {
    const by = (day ?? res.days) - PROCESSING_DAYS;
    return by < 1 ? "now" : `by ${dayToDate(by)}`;
  };

  const headline =
    res.verdict === "enough" ? "Enough blood" : res.verdict === "at_risk" ? "Might run short" : "Not enough blood";
  const because = res.crisis_first
    ? res.verdict === "enough"
      ? "if hospitals put these patients first"
      : "even with crisis patients put first"
    : "at today's collection rate";
  const firstDay = res.first_short_day;
  const noShortage = firstDay === null || res.share_runs_with_shortage < 0.1;

  return (
    <div className={`sim-result verdict-${res.verdict} ${stale ? "is-stale" : ""}`} aria-live="polite">
      {stale && <p className="sim-stale">Settings changed. Run again to update.</p>}

      <div className="sim-banner">
        <p className="sim-banner-head">{headline}</p>
        <p className="sim-banner-sub">
          for <b>{res.people}</b> {res.people === 1 ? "person" : "people"} in crisis over{" "}
          <b>{span}</b> in {res.country}, {because}.
        </p>
      </div>

      <div className="sim-tiles">
        <div className="sim-tile">
          <span className="sim-tile-k">Go without blood</span>
          <span className="sim-tile-v">
            {without}
            <small> of {res.people}</small>
          </span>
          <span className="sim-tile-n">in a typical run</span>
        </div>
        <div className="sim-tile">
          <span className="sim-tile-k">First shortage</span>
          <span className="sim-tile-v">{noShortage ? "None" : dayToDate(firstDay!)}</span>
          <span className="sim-tile-n">
            {noShortage
              ? "in 9 of 10 runs"
              : Math.floor(firstDay!) < 1
                ? "today"
                : `in ${Math.floor(firstDay!)} day${Math.floor(firstDay!) === 1 ? "" : "s"}`}
          </span>
        </div>
        <div className="sim-tile">
          <span className="sim-tile-k">Everyone covered</span>
          <span className="sim-tile-v">{pct(res.p_all_served)}</span>
          <span className="sim-tile-n">of {fmt(res.draws)} runs</span>
        </div>
        <div className={`sim-tile ${res.donors_to_cover_total > 0 ? "is-action" : ""}`}>
          <span className="sim-tile-k">Donors to recruit</span>
          <span className="sim-tile-v">{fmt(res.donors_to_cover_total)}</span>
          <span className="sim-tile-n">
            {res.donors_to_cover_total > 0 ? byWhen(firstDeadline) : "none needed"}
          </span>
        </div>
      </div>

      <div className="sim-todo">
        <h3 className="sim-h">What to do</h3>
        {plan.length === 0 ? (
          <p>
            <b>No donation drive needed</b> for this scenario. Keep regular donors coming in.
          </p>
        ) : (
          <>
            <p className="sim-todo-lead">
              Recruit <b>{fmt(res.donors_to_cover_total)} donors</b>, starting with{" "}
              <b>{groupLabel(plan[0].blood_group)}</b> {byWhen(plan[0].deadline_day)}. This
              covers the gap in {Math.round(res.cover_share * 10)} of 10 runs, allowing{" "}
              {PROCESSING_DAYS} days to test and process each donation.
            </p>
            <ol className="sim-plan">
              {plan.map((g, i) => (
                <li key={g.blood_group} className={i === 0 ? "is-first" : ""}>
                  <span className="sim-plan-g">{groupLabel(g.blood_group)}</span>
                  <span className="sim-plan-n">
                    <b>{fmt(g.donors_to_cover)}</b> donor{g.donors_to_cover === 1 ? "" : "s"}
                    {weeks >= 2 && (
                      <small> · about {Math.max(1, Math.ceil(g.donors_to_cover / weeks))} a week</small>
                    )}
                  </span>
                  <span className="sim-plan-d">{byWhen(g.deadline_day)}</span>
                </li>
              ))}
            </ol>
          </>
        )}
        {res.o_neg_fallback && (
          <p className="sim-note">
            {res.o_neg_patients_helped >= 0.005
              ? `O− covered someone whose own group ran out in about ${pct(Math.min(res.o_neg_patients_helped, 1))} of runs.`
              : "O− could not help: it runs out first."}
          </p>
        )}
        {res.crisis_first && res.routine_displaced_units.p50 >= 0.5 && (
          <p className="sim-note">
            This takes about {fmtRate(res.routine_displaced_units.p50)} units from other hospital
            patients.
          </p>
        )}
        {plan.length > 0 && <AppealPanel res={res} plan={plan} byWhen={byWhen} />}
      </div>

      <p className="sim-who">
        <span className="sim-h">Who is in crisis</span>
        {who.map((x) => (
          <span key={x.a} className="sim-who-item">
            <b>{x.n}</b> {ageLabel(x.a, x.n)}
            {x.lost > 0 && <em> · {x.lost} without</em>}
          </span>
        ))}
      </p>

      <h3 className="sim-h">By blood group</h3>
      <div className="sim-table-wrap">
        <table className="rates sim-table">
          <thead>
            <tr>
              <th>Group</th>
              <th title="Share of runs where someone with this group went without">Chance short</th>
              <th>Donors to recruit</th>
              <th>Recruit by</th>
              <th>Collected a day</th>
              <th>Used a day</th>
              <th>Stock runs out</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => {
              const deficit = g.routine_use_per_day > g.collected_per_day;
              return (
                <tr key={g.blood_group} className={short.has(g.blood_group) ? "is-short" : ""}>
                  <th scope="row">{groupLabel(g.blood_group)}</th>
                  <td>
                    <span
                      className={`chip ${
                        short.has(g.blood_group) ? "chip-critical" : risky.has(g.blood_group) ? "chip-low" : "chip-ok"
                      }`}
                    >
                      {pct(g.p_short)}
                    </span>
                  </td>
                  <td>{g.donors_to_cover > 0 ? <b>{fmt(g.donors_to_cover)}</b> : "–"}</td>
                  <td>{g.donors_to_cover > 0 ? byWhen(g.deadline_day).replace(/^by /, "") : "–"}</td>
                  <td>{fmtRate(g.collected_per_day)}</td>
                  <td className={deficit ? "is-deficit" : ""}>{fmtRate(g.routine_use_per_day)}</td>
                  <td>{g.runs_dry_after_days === null ? "holds" : `in ${fmtDays(g.runs_dry_after_days)} days`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="sim-scope">Sickle cell crises only. Assumes nothing else happens.</p>
    </div>
  );
}

/* ───────────── donor appeal: Gemini (or a template) writes it, the charity sends it ───────────── */

type Channel = "whatsapp" | "sms" | "email";

function AppealPanel({
  res,
  plan,
  byWhen,
}: {
  res: CrisisResponse;
  plan: CrisisResponse["by_group"];
  byWhen: (day: number | null) => string;
}) {
  const [org, setOrg] = useState("");
  const [appeal, setAppeal] = useState<CrisisAppealResponse | null>(null);
  const [text, setText] = useState<Record<Channel, string>>({ whatsapp: "", sms: "", email: "" });
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // 0 = first draft; each Rewrite asks for a fresh version (variant 1, 2, ...).
  const [variant, setVariant] = useState(0);

  // A new simulation result means a new appeal.
  useEffect(() => {
    setAppeal(null);
    setError(null);
    setVariant(0);
  }, [res]);

  const draft = (v: number) => {
    setBusy(true);
    setError(null);
    draftCrisisAppeal({
      country: res.country,
      people: res.people,
      days: res.days,
      verdict: res.verdict,
      donors: Object.fromEntries(plan.map((g) => [groupLabel(g.blood_group), g.donors_to_cover])),
      deadlines: Object.fromEntries(plan.map((g) => [groupLabel(g.blood_group), byWhen(g.deadline_day)])),
      organisation: org.trim() || undefined,
      patients_by_age: res.example_counts,
      variant: v,
    })
      .then((a) => {
        setVariant(v);
        setAppeal(a);
        setText({ whatsapp: a.whatsapp, sms: a.sms, email: a.email_body });
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const current = text[channel];
  const enc = encodeURIComponent;
  const sendHref =
    channel === "whatsapp"
      ? `https://wa.me/?text=${enc(current)}`
      : channel === "sms"
        ? `sms:?&body=${enc(current)}`
        : `mailto:?subject=${enc(appeal?.email_subject ?? "")}&body=${enc(current)}`;
  const copy = () => {
    navigator.clipboard?.writeText(current).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="appeal">
      {!appeal ? (
        <div className="appeal-start">
          <input
            className="appeal-org"
            value={org}
            onChange={(e) => setOrg(e.target.value)}
            placeholder="Your charity's name (optional)"
            maxLength={80}
          />
          <button className="btn" onClick={() => draft(0)} disabled={busy}>
            {busy ? "Writing…" : "✉ Draft donor appeal"}
          </button>
        </div>
      ) : (
        <>
          <div className="appeal-tabs" role="tablist">
            {(["whatsapp", "sms", "email"] as Channel[]).map((c) => (
              <button
                key={c}
                role="tab"
                aria-selected={channel === c}
                className={channel === c ? "is-on" : ""}
                onClick={() => setChannel(c)}
              >
                {c === "whatsapp" ? "WhatsApp" : c === "sms" ? "SMS" : "Email"}
              </button>
            ))}
            <span className={`appeal-src ${appeal.source}`}>
              {appeal.source === "gemini" ? "Written by Gemini" : "Template"}
            </span>
          </div>
          {channel === "email" && <p className="appeal-subject">Subject: {appeal.email_subject}</p>}
          <textarea
            className="appeal-text"
            value={current}
            onChange={(e) => setText({ ...text, [channel]: e.target.value })}
            rows={channel === "sms" ? 3 : 9}
          />
          <div className="appeal-actions">
            <a className="btn" href={sendHref} target="_blank" rel="noreferrer">
              Send via {channel === "whatsapp" ? "WhatsApp" : channel === "sms" ? "SMS" : "email"} →
            </a>
            <button className="btn btn-ghost" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button className="btn btn-ghost" onClick={() => draft(variant + 1)} disabled={busy}>
              {busy ? "Writing…" : "Rewrite"}
            </button>
            {channel === "sms" && <small className="appeal-count">{current.length} characters</small>}
          </div>
        </>
      )}
      {error && <div className="alert">Couldn't draft the appeal: {error}</div>}
    </div>
  );
}

/* ───────────────────────── drive plan ───────────────────────── */

const PLAN_DEFAULTS = {
  people: 25,
  days: 30,
  deferral: 0.2,
  donationsPerDonor: 2,
  coverage: 0.1,
  oNegFallback: false,
  crisisFirst: false,
};

/** Plan settings live in the URL, so a copied link rebuilds the same plan. */
function planQueryString(i: PlanInputs): string {
  return new URLSearchParams({
    c: i.country,
    p: String(i.people),
    d: String(i.days),
    df: String(i.deferral),
    dpd: String(i.donationsPerDonor),
    cov: String(i.coverage),
    on: i.oNegFallback ? "1" : "0",
    cf: i.crisisFirst ? "1" : "0",
  }).toString();
}

function readPlanQuery(): URLSearchParams {
  const h = window.location.hash;
  const i = h.indexOf("?");
  return new URLSearchParams(i >= 0 ? h.slice(i + 1) : "");
}

function numParam(q: URLSearchParams, k: string, d: number, lo: number, hi: number) {
  const v = parseFloat(q.get(k) ?? "");
  return Number.isFinite(v) ? clamp(v, lo, hi) : d;
}

const rangeText = (p: Percentiles) => `${fmt(p.p10)}–${fmt(p.p90)}`;

function planVerdictText(plan: PlanResponse): string {
  return plan.verdict === "enough"
    ? `${plan.country} has enough blood`
    : plan.verdict === "at_risk"
      ? `${plan.country} might not have enough blood`
      : `${plan.country} does not have enough blood`;
}

function planSummaryText(plan: PlanResponse, link: string): string {
  const p = plan.params;
  const lines = [
    `SickleSignal drive plan: ${plan.country}`,
    `Scenario: ${p.people} people with sickle cell disease in crisis over ${fmtWindow(p.days).replace(/ \(.*\)$/, "")}; the drive aims to supply ${pct(p.coverage)} of their regular blood need.`,
    `Crisis test: ${planVerdictText(plan)}. Everyone got blood in ${pct(plan.p_all_served)} of simulations.`,
    plan.push.length
      ? `Push for: ${plan.push.map(groupLabel).join(", ")}.${plan.watch.length ? ` Watch: ${plan.watch.map(groupLabel).join(", ")}.` : ""}`
      : `No blood group needs pushing in this scenario.${plan.watch.length ? ` Watch: ${plan.watch.map(groupLabel).join(", ")}.` : ""}`,
    `Regular donors needed: about ${fmt(plan.totals.donors_ongoing.p50)} (likely ${rangeText(plan.totals.donors_ongoing)}).`,
    `One-off donors for the crisis window: about ${fmt(plan.totals.donors_surge.p50)} (likely ${rangeText(plan.totals.donors_surge)}).`,
    "",
    "By blood group (regular donors / one-off donors):",
    ...plan.groups
      .filter((g) => g.action !== "ok")
      .map(
        (g) =>
          `  ${groupLabel(g.blood_group)} (${g.action}): ${fmt(g.donors_ongoing.p50)} regular (${rangeText(g.donors_ongoing)}), ${fmt(g.donors_surge.p50)} one-off (${rangeText(g.donors_surge)}); short in ${pct(g.p_short)} of crisis simulations`,
      ),
    "",
    "Assumptions:",
    ...plan.assumptions.map(
      (a) => `  - ${a.label}${a.value !== null ? `: ${a.key === "deferral" || a.key === "coverage" || a.key === "share_in_care" ? pct(a.value) : fmtRate(a.value)}` : ""} (${a.is_assumption ? "assumption" : "sourced"}: ${a.source})`,
    ),
    "",
    plan.ask,
    "",
    plan.disclaimer,
    `Link: ${link}`,
  ];
  return lines.join("\n");
}

/* ───────────── appeal writer: Gemini writes from the plan's numbers ───────────── */

const APPEAL_CHANNELS: { id: AppealChannel; label: string }[] = [
  { id: "social", label: "Social post" },
  { id: "email", label: "Email to donors" },
  { id: "sms", label: "SMS" },
  { id: "poster", label: "Poster" },
];
const APPEAL_TONES: { id: AppealTone; label: string }[] = [
  { id: "warm", label: "Warm" },
  { id: "urgent", label: "Urgent" },
  { id: "formal", label: "Formal" },
];
const APPEAL_LANGUAGES: AppealLanguage[] = ["English", "French", "Portuguese", "Swahili", "Arabic", "Hausa"];

function AppealWriter({ inputs, ready }: { inputs: PlanInputs; ready: boolean }) {
  const [channel, setChannel] = useState<AppealChannel>("social");
  const [tone, setTone] = useState<AppealTone>("warm");
  const [language, setLanguage] = useState<AppealLanguage>("English");
  const [details, setDetails] = useState({ organisation: "", date: "", venue: "", contact: "" });
  const [res, setRes] = useState<AppealResponse | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const write = () => {
    setBusy(true);
    setError(null);
    writeAppeal({ ...inputs, channel, tone, language, details })
      .then((r) => {
        setRes(r);
        setText(r.text);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setBusy(false));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Couldn't copy: select the text and copy it by hand");
    }
  };

  const field = (k: keyof typeof details, label: string, ph: string) => (
    <label className="appeal-field">
      <span>{label}</span>
      <input
        type="text"
        value={details[k]}
        maxLength={k === "venue" || k === "contact" ? 120 : 80}
        placeholder={ph}
        onChange={(e) => setDetails((d) => ({ ...d, [k]: e.target.value }))}
      />
    </label>
  );

  return (
    <section className="panel plan-appeal no-print">
      <header className="panel-head">
        <span className="panel-key">5</span>
        <h2>Write an appeal</h2>
        <p>
          Words for registered donors or social media, written from this plan's numbers. Check it
          before you post: the app never sends anything.
        </p>
      </header>

      <div className="appeal-row" role="group" aria-label="Where it will be shared">
        {APPEAL_CHANNELS.map((c) => (
          <button
            key={c.id}
            className={`seg ${channel === c.id ? "is-on" : ""}`}
            onClick={() => setChannel(c.id)}
            aria-pressed={channel === c.id}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="appeal-grid">
        <label className="appeal-field">
          <span>Tone</span>
          <select value={tone} onChange={(e) => setTone(e.target.value as AppealTone)}>
            {APPEAL_TONES.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="appeal-field">
          <span>Language</span>
          <select value={language} onChange={(e) => setLanguage(e.target.value as AppealLanguage)}>
            {APPEAL_LANGUAGES.map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
        </label>
        {field("organisation", "Your organisation", "e.g. Sickle Cell Society")}
        {field("date", "Date", "e.g. Saturday 14 March, 9am–3pm")}
        {field("venue", "Venue", "e.g. Community Hall, Accra")}
        {field("contact", "How to reach you", "phone, email or page")}
      </div>
      <p className="plan-fine">
        Leave a detail blank and it stays in [square brackets] for you to fill in. Don't type
        patient names or donor lists here.
      </p>

      <div className="plan-actions">
        <button className="btn" onClick={write} disabled={busy || !ready}>
          {busy ? "Writing…" : res ? "Write it again" : "Write appeal"}
        </button>
        {res && (
          <button className="btn btn-ghost" onClick={copy}>
            {copied ? "Copied" : "Copy text"}
          </button>
        )}
      </div>

      {error && <div className="alert">Couldn't write the appeal: {error}</div>}

      {res && (
        <div className="appeal-result" aria-live="polite">
          <textarea
            className="appeal-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={channel === "email" ? 12 : channel === "sms" ? 4 : 8}
            aria-label="Appeal text, editable"
          />
          <p className="plan-fine">
            <span className={`src-tag ${res.source === "template" ? "is-assumed" : ""}`}>
              {res.source === "gemini" ? "Written by Gemini" : "Offline template"}
            </span>{" "}
            {res.source === "template" && res.fallback_reason === "no_api_key" &&
              "No Gemini key is set, so this is a fixed template. "}
            {res.source === "template" && res.fallback_reason === "gemini_unavailable" &&
              "Gemini didn't answer in time, so this is a fixed template. "}
            {res.source === "template" && res.fallback_reason === "failed_checks" &&
              "Gemini's wording broke a rule (it must say donation is voluntary and unpaid, and use only the plan's numbers), so this is a fixed template. "}
            {res.note && <>{res.note} </>}
            Written from this plan:{" "}
            {res.facts_used.groups.length ? res.facts_used.groups.map(groupLabel).join(", ") : "no urgent groups"}
            {res.facts_used.regular && channel !== "social" && channel !== "sms"
              ? `; about ${res.facts_used.regular} donors`
              : ""}
            .
          </p>
        </div>
      )}
    </section>
  );
}

/* ───────────── how far to trust this: back-test + sensitivity ───────────── */

function TrustPanel({ inputs }: { inputs: PlanInputs }) {
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
        <span className="panel-key">7</span>
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
            your settings. Changing one assumption at a time, across a plausible range, moves it
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
            The dark tick is your current setting. These are assumptions, not measurements: if one
            of them is the long bar, that is the number to confirm with the national blood service
            first.
          </p>
        </>
      )}
    </details>
  );
}

/* ───────────── saved plans: per account when signed in, per browser otherwise ───────────── */

function SavedPlans({
  country,
  query,
  onOpen,
}: {
  country: string;
  query: string;
  onOpen: (query: string) => void;
}) {
  const auth = useAuth();
  const [items, setItems] = useState<SavedPlanItem[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setItems(await listSavedPlans(await auth.getToken()));
      setError(null);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  useEffect(() => {
    if (auth.ready && (!auth.enabled || auth.signedIn)) void refresh();
    else setItems([]);
  }, [auth.ready, auth.signedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    const n = (name || `${country} drive`).trim().slice(0, 80);
    setBusy(true);
    setError(null);
    try {
      await savePlan(await auth.getToken(), n, country, query);
      setName("");
      setNote("Saved");
      window.setTimeout(() => setNote(null), 2000);
      await refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteSavedPlan(await auth.getToken(), id);
      await refresh();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    }
  };

  const needsSignIn = auth.enabled && !auth.signedIn;

  return (
    <section className="panel plan-saved no-print">
      <header className="panel-head">
        <span className="panel-key">★</span>
        <h2>Saved plans</h2>
        <p>
          {auth.enabled
            ? "Kept in your account. Only you can see them."
            : "Kept in this browser only. Sign-in isn't set up here, so they won't follow you to another device."}
        </p>
      </header>

      {needsSignIn ? (
        <div className="saved-signin">
          <p>Sign in to save plans and reopen them later.</p>
          <button className="btn" onClick={() => auth.login()} disabled={!auth.ready}>
            Sign in
          </button>
        </div>
      ) : (
        <>
          <div className="saved-add">
            <input
              type="text"
              value={name}
              maxLength={80}
              placeholder={`${country || "Country"} drive`}
              aria-label="Name for this plan"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && country && void save()}
            />
            <button className="btn" onClick={save} disabled={busy || !country}>
              {busy ? "Saving…" : "Save this plan"}
            </button>
            {note && <span className="plan-note">{note}</span>}
          </div>
          {error && <div className="alert">{error}</div>}
          {items.length === 0 ? (
            <p className="plan-fine">No saved plans yet.</p>
          ) : (
            <ul className="saved-list">
              {items.map((p) => (
                <li key={p.id}>
                  <button className="saved-open" onClick={() => onOpen(p.query)}>
                    <b>{p.name}</b>
                    <small>
                      {p.country} · {new Date(p.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </small>
                  </button>
                  <button className="saved-del" onClick={() => void remove(p.id)} aria-label={`Delete ${p.name}`}>
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function PlanPage({
  country,
  onCountry,
  onBack,
  onTravel,
  onOpenSaved,
}: {
  country: string;
  onCountry: (c: string) => void;
  onBack: () => void;
  onTravel: (c: string) => void;
  onOpenSaved: (query: string) => void;
}) {
  const q0 = useMemo(readPlanQuery, []);
  const c = q0.get("c") || country;
  const [people, setPeople] = useState(Math.round(numParam(q0, "p", PLAN_DEFAULTS.people, 1, 50)));
  const [windowPos, setWindowPos] = useState(
    daysToPos(Math.round(numParam(q0, "d", PLAN_DEFAULTS.days, 1, 365))),
  );
  const [deferral, setDeferral] = useState(numParam(q0, "df", PLAN_DEFAULTS.deferral, 0.05, 0.5));
  const [donationsPerDonor, setDpd] = useState(numParam(q0, "dpd", PLAN_DEFAULTS.donationsPerDonor, 1, 4));
  const [coverage, setCoverage] = useState(numParam(q0, "cov", PLAN_DEFAULTS.coverage, 0.05, 1));
  const [oNegFallback, setONeg] = useState(q0.get("on") === "1");
  const [crisisFirst, setCrisisFirst] = useState(q0.get("cf") === "1");
  const days = posToDays(windowPos);

  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (c) onCountry(c);
  }, [c]); // eslint-disable-line react-hooks/exhaustive-deps

  const inputs: PlanInputs = {
    country: c,
    people,
    days,
    deferral,
    donationsPerDonor,
    coverage,
    oNegFallback,
    crisisFirst,
  };
  const qs = planQueryString(inputs);

  // Keep the address bar in step with the settings, so the link can be shared.
  useEffect(() => {
    if (c) window.history.replaceState(null, "", `#/plan?${qs}`);
  }, [qs, c]);

  useEffect(() => {
    if (!c) return;
    let live = true;
    setLoading(true);
    const t = window.setTimeout(() => {
      getPlan(inputs)
        .then((d) => {
          if (!live) return;
          setPlan(d);
          setError(null);
        })
        .catch((e) => live && setError(String(e)))
        .finally(() => live && setLoading(false));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [qs]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const shown = plan && plan.country === c ? plan : null;

  return (
    <>
      <section className="hero plan-hero no-print">
        <p className="eyebrow">
          Drive plan <span className="dot-sep">·</span>
          <span className={`live ${loading ? "is-busy" : ""}`}>
            {loading ? "recalculating" : "modelled, not live stock"}
          </span>
        </p>
        <div className="hero-place">
          Plan a blood drive in
          <em className="hero-country">{c || "…"}</em>
        </div>
        <p className="hero-sub">
          Which blood groups to push for, and about how many donors to recruit, from the
          reservoir and crisis models. Change a setting and the plan updates.
        </p>
      </section>

      <div className="print-only plan-print-head">
        <b>SickleSignal · Drive plan · {c}</b>
        <span>{today} · modelled estimates, not live stock</span>
      </div>

      <section className="panel plan-controls no-print">
        <header className="panel-head">
          <span className="panel-key">1</span>
          <h2>Set the scenario</h2>
          <p>The crisis to prepare for, and what a drive can realistically do.</p>
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
          <Dial
            label="Share of the sickle cell blood need your drive aims to supply"
            value={coverage}
            min={0.05}
            max={1}
            step={0.05}
            format={pct}
            hint="One drive supplies a share of the need, not all of it."
            onChange={setCoverage}
          />
          <Dial
            label="Volunteers turned away at screening"
            value={deferral}
            min={0.05}
            max={0.5}
            step={0.01}
            format={pct}
            hint="Assumption: low haemoglobin, infection risk, medication."
            onChange={setDeferral}
          />
          <Dial
            label="Donations per regular donor per year"
            value={donationsPerDonor}
            min={1}
            max={4}
            step={0.5}
            format={(v) => `${v} a year`}
            hint="Assumption: many repeat donors give 1–2."
            onChange={setDpd}
          />
        </div>
        <div className="sim-options">
          <Toggle
            label="Use O− when a group runs out"
            hint="O− is the universal red-cell donor"
            checked={oNegFallback}
            onChange={setONeg}
          />
          <Toggle
            label="Crisis patients first"
            hint="Hospitals hold back blood from other patients"
            checked={crisisFirst}
            onChange={setCrisisFirst}
          />
        </div>
      </section>

      {error && <div className="alert">Couldn't build the plan: {error}</div>}
      {!shown && !error && <p className="fine plan-wait">Building the plan…</p>}

      {shown && (
        <div className={`plan-result ${loading ? "is-stale" : ""}`} aria-live="polite">
          <section className={`panel plan-verdict verdict-${shown.verdict}`}>
            <header className="panel-head">
              <span className="panel-key">2</span>
              <h2>What the crisis test says</h2>
            </header>
            <p className="plan-verdict-line">
              For <b>{shown.params.people} {shown.params.people === 1 ? "person" : "people"}</b> in
              crisis over <b>{fmtWindow(shown.params.days).replace(/ \(.*\)$/, "")}</b>,{" "}
              <b className="sim-verdict-word">{planVerdictText(shown)}</b>
              {shown.push.length > 0 && (
                <>
                  . Push for{" "}
                  {shown.push.map((g) => (
                    <span key={g} className="chip chip-critical sim-chip">
                      {groupLabel(g)}
                    </span>
                  ))}
                </>
              )}
              {shown.watch.length > 0 && (
                <>
                  {shown.push.length ? "; watch " : ". Watch "}
                  {shown.watch.map((g) => (
                    <span key={g} className="chip chip-low sim-chip">
                      {groupLabel(g)}
                    </span>
                  ))}
                </>
              )}
              .
            </p>
            <p className="plan-sub">
              Everyone got blood in <b>{pct(shown.p_all_served)}</b> of 5,000 simulations.
            </p>
          </section>

          <section className="panel plan-donors">
            <header className="panel-head">
              <span className="panel-key">3</span>
              <h2>Donors to recruit</h2>
              <p>
                To supply {pct(shown.params.coverage)} of the regular blood need of people living
                with sickle cell disease, and to cover a crisis.
              </p>
            </header>
            <div className="plan-totals">
              <div>
                <span className="plan-total-label">Regular donors</span>
                <b className="plan-total-num">{fmt(shown.totals.donors_ongoing.p50)}</b>
                <small>likely {rangeText(shown.totals.donors_ongoing)}</small>
              </div>
              <div>
                <span className="plan-total-label">One-off donors for the crisis</span>
                <b className="plan-total-num">{fmt(shown.totals.donors_surge.p50)}</b>
                <small>likely {rangeText(shown.totals.donors_surge)}</small>
              </div>
            </div>
            <p className="plan-fine">
              Totals add up the groups marked push or watch; the range assumes they all move
              together, so it is on the wide side.
            </p>

            <div className="plan-table-wrap">
              <table className="plan-table">
                <thead>
                  <tr>
                    <th>Blood group</th>
                    <th>Action</th>
                    <th title="Median days of stock against the national target">Stock</th>
                    <th title="Share of crisis simulations where this group ran short">Short in crisis</th>
                    <th>Regular donors</th>
                    <th>One-off donors</th>
                    <th title="The whole country's everyday shortfall: context, not your target">
                      Country-wide gap / yr
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.groups.map((g) => (
                    <tr key={g.blood_group} className={`is-${g.action}`}>
                      <th scope="row">{groupLabel(g.blood_group)}</th>
                      <td>
                        <span
                          className={`chip ${g.action === "push" ? "chip-critical" : g.action === "watch" ? "chip-low" : "chip-ok"}`}
                        >
                          {g.action === "ok" ? "no action" : g.action}
                        </span>
                      </td>
                      <td>
                        {fmtDays(g.days.p50)} of {fmtDays(shown.target_days)} days
                      </td>
                      <td>{pct(g.p_short)}</td>
                      <td>
                        {g.action === "ok" ? (
                          "–"
                        ) : (
                          <>
                            <b>{fmt(g.donors_ongoing.p50)}</b>
                            <small>{rangeText(g.donors_ongoing)}</small>
                          </>
                        )}
                      </td>
                      <td>
                        {g.action === "ok" ? (
                          "–"
                        ) : (
                          <>
                            <b>{fmt(g.donors_surge.p50)}</b>
                            <small>{rangeText(g.donors_surge)}</small>
                          </>
                        )}
                      </td>
                      <td className="plan-muted">
                        {g.extra_donations_per_year.p50 >= 1 ? fmtBig(g.extra_donations_per_year.p50) : "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="plan-fine">
              Regular donors give blood several times a year. One-off donors give once, for the crisis
              window. A drive supplies a share of the need; closing a whole country's gap takes the
              national blood service.
            </p>
          </section>

          <section className="panel plan-ask">
            <header className="panel-head">
              <span className="panel-key">4</span>
              <h2>Your ask to the blood service</h2>
              <p>Plain words for an email or a first meeting. Edit before sending.</p>
            </header>
            <p className="plan-ask-text">{shown.ask}</p>
          </section>

          <AppealWriter inputs={inputs} ready={!loading} />

          <section className="panel plan-assume">
            <header className="panel-head">
              <span className="panel-key">6</span>
              <h2>What this rests on</h2>
            </header>
            <ul className="plan-assume-list">
              {shown.assumptions.map((a) => (
                <li key={a.key}>
                  <span>
                    {a.label}
                    {a.value !== null && (
                      <b>
                        {" "}
                        {a.key === "deferral" || a.key === "coverage" || a.key === "share_in_care"
                          ? pct(a.value)
                          : fmtRate(a.value)}
                      </b>
                    )}
                  </span>
                  <SourceTag assumed={a.is_assumption} title={a.source} />
                  <small>{a.source}</small>
                </li>
              ))}
            </ul>
            <p className="plan-fine">{shown.disclaimer}</p>
          </section>

          <TrustPanel inputs={inputs} />
        </div>
      )}

      <SavedPlans country={c} query={qs} onOpen={onOpenSaved} />

      <div className="hero-actions plan-actions no-print">
        <button className="btn" onClick={() => window.print()} disabled={!shown}>
          Print / save as PDF
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => shown && copy(planSummaryText(shown, window.location.href), "Summary")}
          disabled={!shown}
        >
          Copy summary
        </button>
        <button className="btn btn-ghost" onClick={() => copy(window.location.href, "Link")}>
          Copy link
        </button>
        <button className="btn btn-ghost" onClick={() => onTravel(c)} disabled={!c}>
          Before you travel →
        </button>
        <button className="btn btn-ghost" onClick={onBack}>
          ← Back to the reservoir
        </button>
        {note && <span className="plan-note">{note}</span>}
      </div>
    </>
  );
}

/* ───────────────────────── before you travel: the trip brief ───────────────────────── */

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

function TravelBriefPage({
  country,
  onCountry,
  onBack,
}: {
  country: string;
  onCountry: (c: string) => void;
  onBack: () => void;
}) {
  const q0 = useMemo(readPlanQuery, []);
  const c = q0.get("c") || country;
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

  const shown = brief && brief.country === c ? brief : null;

  return (
    <>
      <section className="hero plan-hero">
        <p className="eyebrow">
          Before you travel <span className="dot-sep">·</span>
          <span className="live">
            {shown?.fallback_used ? "fixed checklist" : "written by Gemini"}, verify with
            government's official advice
          </span>
        </p>
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
            {shown.fallback_used
              ? "This is a fixed starter list (no Gemini answer was available). "
              : "Written by Gemini for this country, so it can be wrong or out of date. "}
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
