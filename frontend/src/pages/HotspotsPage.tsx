import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import africaGeo from "../africaGeo.json";
import { getHotspots } from "../api";
import type { HotspotsResponse } from "../api";
import { fmtBig } from "../format";
import { MAX_ZOOM, useMapZoom } from "./useMapZoom";

/* Page 1: Africa shaded by people living with sickle cell disease. Tap a country for its
   numbers and a link to its blood reservoir page. */

// Country outlines (Natural Earth 1:50m, pre-projected). Generated, not hand-drawn.
type GeoCountry = { name: string; data: boolean; d: string; cx: number; cy: number; area: number };
const GEO = africaGeo as unknown as { w: number; h: number; context: string; countries: GeoCountry[] };

// Five heat classes, darkest first, one per legend bucket in data/processed/heatmap.json.
const HEAT_CLASSES = [
  { label: "Highest", color: "#6E0A12", ink: "#fff" },
  { label: "High", color: "#A3161C", ink: "#fff" },
  { label: "Medium", color: "#CF3A2E", ink: "#fff" },
  { label: "Lower", color: "#EC8466", ink: "#3a0d08" },
  { label: "Lowest", color: "#F6C3B0", ink: "#3a0d08" },
];
const BUCKET_CLASS: Record<string, number> = { "very high": 0, high: 1, moderate: 2, low: 3, "very low": 4 };
const bucketClass = (b: string) => HEAT_CLASSES[BUCKET_CLASS[b] ?? 4];

export default function HotspotsPage({
  onSelect,
  onOpen,
}: {
  /** The selected country changed. */
  onSelect: (country: string) => void;
  /** Open that country's blood reservoir page. */
  onOpen: (country: string) => void;
}) {
  const [data, setData] = useState<HotspotsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  // Keep the app-wide country in step with the map, so the reservoir page opens on it.
  useEffect(() => {
    if (sel) onSelect(sel);
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

              <button className="btn" onClick={() => onOpen(selected.country)}>
                {selected.country}'s blood reservoir →
              </button>
            </article>
          )}
        </aside>
      </div>
    </>
  );
}
