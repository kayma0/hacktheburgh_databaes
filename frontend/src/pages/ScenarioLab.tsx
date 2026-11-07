import { useQuery } from "@tanstack/react-query";
import { Param, api, fmt, pct } from "../api";
import { Badge, Card, ErrorBox, Loading, Slider, Stat } from "../components/ui";
import { IntervalChart, Tornado } from "../components/charts";
import { useModel } from "../model";

const SLIDERS: { name: string; field: string; label: string; min: number; max: number; step: number; asPct: boolean }[] = [
  { name: "share_diagnosed", field: "mean", label: "Share of affected children diagnosed", min: 0.01, max: 0.95, step: 0.01, asPct: true },
  { name: "share_on_hydroxyurea", field: "mean", label: "Hydroxyurea coverage (diagnosed)", min: 0, max: 0.9, step: 0.01, asPct: true },
  { name: "units_per_event", field: "mode", label: "Units per transfusion event", min: 0.5, max: 2, step: 0.05, asPct: false },
  { name: "donor_deferral_rate", field: "mode", label: "Donor deferral rate", min: 0.05, max: 0.5, step: 0.01, asPct: true },
  { name: "target_coverage", field: "value", label: "Target coverage of demand", min: 0.05, max: 1, step: 0.05, asPct: true },
  { name: "universal_hydroxyurea_coverage", field: "value", label: "HU coverage in 'universal' scenario", min: 0, max: 1, step: 0.05, asPct: true },
];

export default function ScenarioLab() {
  const { source, overrides, draft, setOverride, reset } = useModel();
  const sim = useQuery({ queryKey: ["sim", source, overrides, "gap_units"], queryFn: () => api.simulate({ source, overrides }),
    placeholderData: (prev) => prev });
  const sens = useQuery({ queryKey: ["sens", source, overrides], queryFn: () => api.sensitivity({ source, overrides }),
    placeholderData: (prev) => prev });

  const params: Record<string, Param> = Object.fromEntries((sim.data?.parameters ?? []).map((p) => [p.name, p]));
  const t = sim.data?.totals;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Assumptions" right={<button className="text-xs text-brand-600 underline" onClick={reset}>reset</button>}>
        <div className="grid gap-4">
          {SLIDERS.map((s) => {
            const p = params[s.name];
            const v = draft[s.name]?.[s.field] ?? p?.central ?? s.min;
            return (
              <Slider key={s.name} label={s.label} min={s.min} max={s.max} step={s.step} value={v}
                onChange={(x) => setOverride(s.name, s.field, x)} format={(x) => (s.asPct ? pct(x, 0) : x.toFixed(2))}
                assumption={p?.kind === "ASSUMPTION"} hint={p?.todo ?? undefined} />
            );
          })}
          <p className="text-xs text-stone-500">
            Sliders set the central value; each assumption keeps its uncertainty range in the Monte Carlo.
            Transfusion rates are <Badge kind="SOURCED" /> from the REACH trial (clinic-based children, not generalisable).
          </p>
        </div>
      </Card>

      <div className="grid gap-4 lg:col-span-2">
        {sim.error && <ErrorBox error={sim.error} />}
        {!t ? <Loading /> : (
          <Card title={<span className="flex items-center gap-2">Baseline vs universal diagnosis + hydroxyurea <Badge kind="MODELLED" /></span>}
            right={sim.isFetching ? <span className="text-xs text-stone-400">updating…</span> : null}>
            <div className="grid gap-3 md:grid-cols-3">
              <Stat label="Baseline demand, units/yr" q={t.demand_units} note="Diagnosed children at current HU coverage" />
              <Stat label="Universal diagnosis + HU, units/yr" q={t.universal_demand_units} note="Every affected child diagnosed" />
              <Stat label="Units avoided by HU / yr" q={t.units_avoided_by_hu}
                note="Universal diagnosis: no HU minus HU at the scenario coverage" />
              <Stat label="Donors needed / yr" q={t.donors_needed} note="Attendees, after deferrals" />
              <Stat label="Baseline demand as % of collections" q={t.pct_of_collections} f={(x) => pct(x, 2)} />
              <Stat label="Children diagnosed" q={t.diagnosed} />
            </div>
            <p className="mt-3 text-xs text-stone-600">
              Universal diagnosis raises the number of children known to need care, so demand can go <i>up</i> even as hydroxyurea
              cuts each child's transfusion rate. Both effects are shown, never netted silently.
            </p>
          </Card>
        )}

        {sim.data && (
          <Card title="Units to raise per year, top 15 countries (P50 bar, P10–P90 whiskers)"
            right={<span className="text-xs text-stone-500">* = an input is ML-imputed</span>}>
            <IntervalChart rows={sim.data.countries.slice(0, 15).map((c) => ({
              name: c.name, q: c.gap_units, flag: c.children_status === "ml_imputed" || c.donations_status === "ml_imputed",
            }))} />
          </Card>
        )}

        <Card title="Which assumption drives the answer most? (donors needed per year, all countries)">
          {sens.error && <ErrorBox error={sens.error} />}
          {sens.data && (
            <>
              <Tornado bars={sens.data.bars} baseline={sens.data.baseline} />
              <p className="text-xs text-stone-500">Baseline: {fmt(sens.data.baseline)} donors/yr. ⚑ = ASSUMPTION. {sens.data.note}</p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
