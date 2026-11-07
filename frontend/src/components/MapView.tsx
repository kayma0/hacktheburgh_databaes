import { useMemo } from "react";
import { CircleMarker, GeoJSON, MapContainer, TileLayer, Tooltip } from "react-leaflet";
import type { Layer, PathOptions } from "leaflet";
import { CountryRow, Facility, fmt, fmtQ } from "../api";

const RAMP = ["#fde7ec", "#f8c3cf", "#ef8fa6", "#dc5a7f", "#b4234a", "#7d1733"];
const UNC_RAMP = ["#f1f5f9", "#cbd5e1", "#94a3b8", "#64748b", "#475569", "#1e293b"];

function quantileBins(values: number[], n: number): number[] {
  const v = [...values].filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return [];
  return Array.from({ length: n - 1 }, (_, i) => v[Math.floor(((i + 1) / n) * (v.length - 1))]);
}

export function MapView({ geo, rows, metric, showUncertainty, selected, onSelect, facilities }: {
  geo: GeoJSON.FeatureCollection | undefined;
  rows: CountryRow[];
  metric: "gap_units" | "children" | "pct_of_collections";
  showUncertainty: boolean;
  selected: string | null;
  onSelect: (iso3: string) => void;
  facilities?: Facility[];
}) {
  const byIso = useMemo(() => Object.fromEntries(rows.map((r) => [r.iso3, r])), [rows]);
  const value = (r: CountryRow) => {
    const q = r[metric];
    return showUncertainty ? (q.p90 - q.p10) / Math.max(q.p50, 1e-9) : q.p50;
  };
  const bins = useMemo(() => quantileBins(rows.map(value), RAMP.length), [rows, metric, showUncertainty]);
  const ramp = showUncertainty ? UNC_RAMP : RAMP;
  const color = (v: number) => ramp[bins.filter((b) => v > b).length];

  const style = (f?: GeoJSON.Feature): PathOptions => {
    const iso = f?.properties?.iso3 as string;
    const r = byIso[iso];
    return {
      fillColor: r ? color(value(r)) : "#e7e5e4",
      fillOpacity: r ? 0.85 : 0.4,
      color: iso === selected ? "#111827" : "#ffffff",
      weight: iso === selected ? 2.5 : 0.8,
    };
  };

  const onEach = (f: GeoJSON.Feature, layer: Layer) => {
    const iso = f.properties?.iso3 as string;
    const r = byIso[iso];
    const label = r
      ? `<b>${r.name}</b><br/>${metricLabel(metric)}: ${fmtQ(r[metric], metric === "pct_of_collections" ? (x) => (x * 100).toFixed(1) + "%" : undefined)}<br/><i>MODELLED, P50 (P10–P90)</i>`
      : `${f.properties?.name ?? iso}: no complete inputs`;
    layer.bindTooltip(label, { sticky: true });
    layer.on("click", () => r && onSelect(iso));
  };

  const pts = (facilities ?? []).filter((f) => f.lat !== null && f.lon !== null);
  return (
    <div className="relative h-[460px]">
      <MapContainer center={[2, 20]} zoom={3} scrollWheelZoom={false}>
        <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {geo && <GeoJSON key={`${metric}-${showUncertainty}-${selected}-${rows.length}`} data={geo} style={style} onEachFeature={onEach} />}
        {pts.map((f) => (
          <CircleMarker key={f.facility_id} center={[f.lat as number, f.lon as number]} radius={3}
            pathOptions={{ color: "#0f766e", weight: 1, fillOpacity: 0.7 }}>
            <Tooltip>{f.name} ({f.admin1})<br />Modelled share: {fmt(f.modelled_gap_units.p50)} units/yr<br /><i>equal-weight ASSUMPTION</i></Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
      {!geo && (
        <div className="absolute inset-x-4 top-4 z-[500] rounded-lg bg-white/90 p-3 text-xs text-stone-700 shadow">
          No country boundaries loaded. Add <code>data/raw/africa_admin0.geojson</code> (Natural Earth or geoBoundaries) to see the choropleth.
          The ranked table below works without it.
        </div>
      )}
      <div className="absolute bottom-3 right-3 z-[500] rounded bg-white/90 p-2 text-[11px] shadow">
        <div className="mb-1 font-semibold">{showUncertainty ? "Relative uncertainty (P90−P10)/P50" : `${metricLabel(metric)} (P50)`}</div>
        <div className="flex">{ramp.map((c) => <span key={c} className="h-3 w-6" style={{ background: c }} />)}</div>
        <div className="flex justify-between"><span>low</span><span>high</span></div>
      </div>
    </div>
  );
}

export function metricLabel(m: string) {
  return m === "gap_units" ? "Units to raise / yr" : m === "children" ? "Children living with SCD" : "Demand as % of collections";
}
