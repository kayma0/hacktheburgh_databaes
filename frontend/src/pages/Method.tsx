import { useQuery } from "@tanstack/react-query";
import { Meta, api, fmt, pct } from "../api";
import { Badge, Card, ErrorBox, Loading } from "../components/ui";
import { useModel } from "../model";

export default function MethodPage({ meta }: { meta: Meta }) {
  const q = useQuery({ queryKey: ["method"], queryFn: api.method, enabled: !meta.error });
  const { draft, setOverride } = useModel();
  return (
    <div className="grid gap-4">
      <Card title="Data files">
        <table className="w-full text-xs">
          <thead className="text-left text-stone-500"><tr><th>File</th><th>Status</th><th>Used for</th><th>How to get it</th></tr></thead>
          <tbody>{meta.files.map((f) => (
            <tr key={f.key} className="border-t align-top">
              <td className="py-1 font-mono">{f.file}</td>
              <td>{f.present ? (f.is_sample ? <Badge kind="SAMPLE" /> : <span className="text-emerald-700">loaded</span>) : <span className="text-red-700">missing</span>}</td>
              <td>{f.required_for}</td><td className="text-stone-600">{f.how_to_get}</td>
            </tr>
          ))}</tbody>
        </table>
        {meta.warnings?.map((w) => <p key={w} className="mt-2 text-xs text-amber-800">⚠ {w}</p>)}
        {meta.excluded && Object.keys(meta.excluded).length > 0 &&
          <p className="mt-2 text-xs text-stone-600">Excluded: {Object.entries(meta.excluded).map(([k, v]) => `${k} (${v})`).join(", ")}</p>}
      </Card>
      {meta.error && <ErrorBox error={new Error(meta.error)} />}
      {q.isLoading && <Loading what="Loading method" />}
      {q.error && <ErrorBox error={q.error} />}
      {q.data && (
        <>
          <Card title="Formulas (every output is MODELLED)">
            <ol className="list-decimal space-y-1 pl-5 font-mono text-xs">{q.data.formulas.map((f) => <li key={f}>{f}</li>)}</ol>
            <p className="mt-2 text-xs text-stone-600">Monte Carlo: {q.data.mc_draws.toLocaleString()} vectorised draws, seed {q.data.mc_seed}. Reported as P10 / P50 / P90.</p>
          </Card>
          <Card title="Parameters and assumptions (editable)">
            <table className="w-full text-xs">
              <thead className="text-left text-stone-500"><tr><th>Parameter</th><th>Kind</th><th>Central</th><th>P10–P90</th><th>Source / TODO</th></tr></thead>
              <tbody>{q.data.parameters.map((p) => {
                const field = p.dist === "triangular" ? "mode" : p.dist === "beta_mean" ? "mean" : "value";
                const editable = p.kind === "ASSUMPTION";
                return (
                  <tr key={p.name} className="border-t align-top">
                    <td className="py-1">{p.label}<div className="text-stone-400">{p.name}</div></td>
                    <td><Badge kind={p.kind} /></td>
                    <td>{editable ? (
                      <input type="number" step="any" className="w-20 rounded border px-1" value={draft[p.name]?.[field] ?? p.central}
                        onChange={(e) => e.target.value !== "" && setOverride(p.name, field, Number(e.target.value))} />
                    ) : fmt(p.central, 3)}</td>
                    <td className="font-mono">{fmt(p.p10, 3)} – {fmt(p.p90, 3)}</td>
                    <td className="text-stone-600">{p.source ?? p.todo}{p.caveat && <div className="text-amber-800">{p.caveat}</div>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </Card>
          <Card title={<span className="flex items-center gap-2">ML imputation: leave-one-country-out cross-validation <Badge kind="ML-IMPUTED" /></span>}>
            <p className="mb-2 text-xs text-stone-600">
              Gradient boosting with quantile loss (P10/P50/P90) on sub-region, income group, log population and VNRD share,
              then conformalised so the 80% interval is calibrated. Imputed values are always badged and never mixed silently with observed ones.
            </p>
            <table className="w-full text-xs">
              <thead className="text-left text-stone-500"><tr><th>Target</th><th>Train countries</th><th>Imputed</th><th>LOCO MAE</th><th>Baseline MAE (median)</th><th>Raw 80% coverage</th><th>Conformal 80% coverage</th></tr></thead>
              <tbody>{Object.values(q.data.imputation).map((r) => (
                <tr key={r.target} className="border-t">
                  <td className="py-1 font-mono">{r.target}</td><td>{r.n_train}</td><td>{r.n_imputed}</td>
                  <td>{fmt(r.loco_mae, 3)}</td>
                  <td className={r.loco_mae !== null && r.baseline_mae_training_median !== null && r.loco_mae > r.baseline_mae_training_median ? "text-red-700" : ""}>{fmt(r.baseline_mae_training_median, 3)}</td>
                  <td>{pct(r.raw_interval_coverage_80, 0)}</td><td>{pct(r.conformal_interval_coverage_80, 0)}</td>
                </tr>
              ))}</tbody>
            </table>
            <p className="mt-2 text-[11px] text-stone-500">
              Red baseline = the model does not beat simply using the median of other countries for this target; treat those imputations with extra caution.
              {" "}{Object.values(q.data.imputation)[0]?.note}
            </p>
          </Card>
          <Card title="Limitations">
            <ul className="list-disc space-y-1 pl-5 text-sm">{q.data.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
          </Card>
        </>
      )}
    </div>
  );
}
