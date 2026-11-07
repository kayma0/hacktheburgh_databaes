import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Meta, api, fmt, fmtQ, pct } from "../api";
import { Badge, Card, ErrorBox, Loading, Stat, StatusBadge } from "../components/ui";
import { MapView, metricLabel } from "../components/MapView";
import { useModel } from "../model";

type Metric = "gap_units" | "children" | "pct_of_collections";

export default function Overview({ meta }: { meta: Meta }) {
  const { source, overrides } = useModel();
  const [metric, setMetric] = useState<Metric>("gap_units");
  const [unc, setUnc] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const rankBy = metric;
  const sim = useQuery({ queryKey: ["sim", source, overrides, rankBy], queryFn: () => api.simulate({ source, overrides, rank_by: rankBy }) });
  const geo = useQuery({ queryKey: ["geo"], queryFn: api.geo, retry: false });
  const a1 = useQuery({
    queryKey: ["admin1", source, overrides, sel], enabled: !!sel && !meta.facilities_error,
    queryFn: () => api.admin1({ source, overrides, iso3: sel! }),
  });
  const fac = useQuery({
    queryKey: ["fac", source, overrides, sel], enabled: !!sel && !meta.facilities_error,
    queryFn: () => api.facilities({ source, overrides, iso3: sel!, admin1: null }),
  });

  if (sim.isLoading) return <Loading />;
  if (sim.error) return <ErrorBox error={sim.error} />;
  const s = sim.data!;
  const f = metric === "pct_of_collections" ? (x: number) => pct(x, 2) : (x: number) => fmt(x);
  const selRow = s.countries.find((c) => c.iso3 === sel);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Children living with SCD (region)" q={s.totals.children} />
        <Stat label="Paediatric SCD transfusion demand, units/yr" q={s.totals.demand_units}
          note="Diagnosed children only, current hydroxyurea coverage" />
        <Stat label="Units to raise / yr at target coverage" q={s.totals.gap_units} />
        <Stat label="Demand as % of national collections" q={s.totals.pct_of_collections} f={(x) => pct(x, 2)}
          note="Not an allocation share: total collections serve all patients" />
      </div>

      <Card title={<span className="flex items-center gap-2">Where is the modelled shortfall largest? <Badge kind="MODELLED" /></span>}
        right={
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <select className="rounded border px-2 py-1" value={metric} onChange={(e) => setMetric(e.target.value as Metric)}>
              <option value="gap_units">Units to raise / yr</option>
              <option value="children">Children living with SCD</option>
              <option value="pct_of_collections">Demand as % of collections</option>
            </select>
            <label className="flex items-center gap-1"><input type="checkbox" checked={unc} onChange={(e) => setUnc(e.target.checked)} /> Show uncertainty</label>
          </div>
        }>
        <MapView geo={geo.data} rows={s.countries} metric={metric} showUncertainty={unc} selected={sel} onSelect={setSel}
          facilities={fac.data?.facilities} />
      </Card>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3" title={`Ranked by ${metricLabel(metric).toLowerCase()} (expected value)`}
          right={<span className="text-xs text-stone-500">{s.n_draws.toLocaleString()} Monte Carlo draws</span>}>
          <div className="max-h-[520px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white text-left text-xs text-stone-500">
                <tr><th className="py-1">#</th><th>Country</th><th>{metricLabel(metric)}: P50 (P10–P90)</th>
                  <th title={`Share of Monte Carlo draws in which this country is in the top ${s.countries[0]?.top_k}`}>P(top {s.countries[0]?.top_k})</th><th>Inputs</th></tr>
              </thead>
              <tbody>
                {s.countries.map((r) => (
                  <tr key={r.iso3} onClick={() => setSel(r.iso3)}
                    className={`cursor-pointer border-t hover:bg-brand-50 ${sel === r.iso3 ? "bg-brand-50" : ""}`}>
                    <td className="py-1 pr-2 text-stone-500">{r.rank}</td>
                    <td className="font-medium">{r.name}</td>
                    <td className="font-mono text-xs">{fmtQ(r[metric], f)}</td>
                    <td><div className="flex items-center gap-1">
                      <div className="h-2 w-16 rounded bg-stone-200"><div className="h-2 rounded bg-brand-500" style={{ width: `${r.p_top_k * 100}%` }} /></div>
                      <span className="text-xs">{pct(r.p_top_k, 0)}</span></div></td>
                    <td className="space-x-1">
                      {r.children_status === "ml_imputed" && <StatusBadge status="ml_imputed" />}
                      {r.donations_status === "ml_imputed" && <Badge kind="ML-IMPUTED" title="Donations per 1,000 imputed" />}
                      {r.children_status === "observed" && r.donations_status === "observed" && <Badge kind="SOURCED" />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="lg:col-span-2" title={selRow ? `${selRow.name}: regions` : "Pick a country"}>
          {!selRow && <p className="text-sm text-stone-500">Click a country on the map or in the table to see its admin1 regions and facilities.</p>}
          {selRow && (
            <div className="grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <Stat label="Units to raise / yr" q={selRow.gap_units} />
                <Stat label="Donors needed / yr" q={selRow.donors_needed} />
              </div>
              <div className="text-xs text-stone-600">
                Children: {fmtQ(selRow.children)} <StatusBadge status={selRow.children_status} /> · Donations data
                {selRow.who_year ? ` (${selRow.who_year})` : ""}: <StatusBadge status={selRow.donations_status} />
              </div>
              {meta.facilities_error && <ErrorBox error={new Error(meta.facilities_error)} />}
              {a1.isLoading && <Loading what="Splitting by region" />}
              {a1.error && <ErrorBox error={a1.error} />}
              {a1.data && (
                <>
                  <p className="rounded bg-amber-50 p-2 text-xs text-amber-900"><Badge kind="ASSUMPTION" /> {a1.data.note}</p>
                  <div className="max-h-72 overflow-auto">
                    <table className="w-full text-xs">
                      <thead className="text-left text-stone-500"><tr><th>Region</th><th>Units / yr P50 (P10–P90)</th><th>Facilities</th></tr></thead>
                      <tbody>{a1.data.regions.map((r) => (
                        <tr key={r.admin1} className="border-t"><td className="py-1">{r.admin1}</td>
                          <td className="font-mono">{fmtQ(r.gap_units)}</td><td>{r.n_facilities}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                </>
              )}
              {fac.data && <p className="text-[11px] text-stone-500">{fac.data.note}</p>}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
