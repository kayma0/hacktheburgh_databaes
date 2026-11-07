import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Meta, Plan, PlanRequest, api, fmt, fmtQ, pct } from "../api";
import { Badge, Card, ErrorBox, Stat } from "../components/ui";
import { TimelineFan } from "../components/charts";
import { useModel } from "../model";

export default function Planner({ meta }: { meta: Meta }) {
  const { source, overrides } = useModel();
  const countries = meta.countries ?? [];
  const [iso3, setIso3] = useState(countries[0]?.iso3 ?? "");
  const [admin1, setAdmin1] = useState<string>("");
  const [drives, setDrives] = useState(4);
  const [dpd, setDpd] = useState<string>("");
  const [horizon, setHorizon] = useState(12);
  const [partner, setPartner] = useState("");
  const [licensed, setLicensed] = useState(false);
  const [csvErr, setCsvErr] = useState<unknown>(null);

  const body = (): PlanRequest => ({
    source, overrides, iso3, admin1: admin1 || null, drives_per_month: drives,
    donors_per_drive: dpd ? Number(dpd) : null, horizon_months: horizon,
    partner_service: partner, partner_confirmed_licensed: licensed,
  });
  const plan = useMutation({ mutationFn: (b: PlanRequest) => api.plan(b) });
  const regions = countries.find((c) => c.iso3 === iso3)?.admin1 ?? [];
  const ready = iso3 && partner.trim().length >= 3 && licensed && drives > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Donor Drive Planner" className="no-print">
        <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); if (ready) plan.mutate(body()); }}>
          <label>Country
            <select className="mt-1 w-full rounded border px-2 py-1" value={iso3} onChange={(e) => { setIso3(e.target.value); setAdmin1(""); }}>
              {countries.map((c) => <option key={c.iso3} value={c.iso3}>{c.name}</option>)}
            </select>
          </label>
          <label>Region (admin1, optional)
            <select className="mt-1 w-full rounded border px-2 py-1" value={admin1} onChange={(e) => setAdmin1(e.target.value)} disabled={!regions.length}>
              <option value="">Whole country</option>
              {regions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label>Drives per month
              <input type="number" min={0.25} step={0.25} className="mt-1 w-full rounded border px-2 py-1" value={drives} onChange={(e) => setDrives(Number(e.target.value))} />
            </label>
            <label>Plan horizon (months)
              <input type="number" min={1} max={60} className="mt-1 w-full rounded border px-2 py-1" value={horizon} onChange={(e) => setHorizon(Number(e.target.value))} />
            </label>
          </div>
          <label>Donors per drive (your own history)
            <input type="number" min={1} placeholder="leave blank to use the ASSUMPTION range" className="mt-1 w-full rounded border px-2 py-1" value={dpd} onChange={(e) => setDpd(e.target.value)} />
          </label>
          <label>Licensed partner service <span className="text-red-700">*</span>
            <input required minLength={3} className="mt-1 w-full rounded border px-2 py-1" placeholder="e.g. National Blood Transfusion Service of …"
              value={partner} onChange={(e) => setPartner(e.target.value)} />
          </label>
          <label className="flex items-start gap-2 text-xs">
            <input type="checkbox" checked={licensed} onChange={(e) => setLicensed(e.target.checked)} className="mt-0.5" />
            <span>I confirm this partner is the national blood transfusion service or a licensed blood bank, and donors will be voluntary and unpaid.</span>
          </label>
          <button disabled={!ready || plan.isPending} className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-40">
            {plan.isPending ? "Modelling…" : "Build plan"}
          </button>
          {plan.error && <ErrorBox error={plan.error} />}
        </form>
      </Card>

      <div className="grid gap-4 lg:col-span-2">
        {!plan.data && <Card><p className="text-sm text-stone-500">Fill in the form to model how many donors and drives are needed.</p></Card>}
        {plan.data && <PlanView p={plan.data} onCsv={async () => {
          setCsvErr(null);
          try { await api.planCsv(body()); } catch (e) { setCsvErr(e); }
        }} />}
        {csvErr ? <ErrorBox error={csvErr} /> : null}
      </div>
    </div>
  );
}

function PlanView({ p, onCsv }: { p: Plan; onCsv: () => void }) {
  return (
    <div className="grid gap-4" id="printable-brief">
      <Card title={<span className="flex items-center gap-2">{p.country}{p.admin1 ? ` · ${p.admin1}` : ""}: drive plan <Badge kind="MODELLED" />{p.sample_data && <Badge kind="SAMPLE" />}</span>}
        right={<div className="no-print flex gap-2">
          <button onClick={onCsv} className="rounded border px-3 py-1 text-sm">Export CSV</button>
          <button onClick={() => window.print()} className="rounded border px-3 py-1 text-sm">Print one-page brief</button>
        </div>}>
        <div className="print-only mb-2 text-xs font-bold">SickleSupply · MODELLED ESTIMATE{p.sample_data ? " · SAMPLE DATA, NOT REAL" : ""}</div>
        <p className="mb-3 rounded bg-emerald-50 p-2 text-xs text-emerald-900">
          Partner service: <b>{p.partner_service}</b>. {p.safety_notice}
        </p>
        <div className="grid gap-3 md:grid-cols-3">
          <Stat label="Units to raise / yr" q={p.gap_units_per_year} />
          <Stat label={`Donors (attendees) needed in ${p.horizon_months} mo`} q={p.donors_needed_in_horizon} />
          <Stat label={`Drives needed in ${p.horizon_months} mo`} q={p.drives_needed_in_horizon} />
          <Stat label="Months of drives to cover one year's need" q={p.months_of_drives_to_cover_one_year} f={(x) => x.toFixed(1)} />
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
            <div className="text-xs text-stone-500">Probability of reaching the target <Badge kind="MODELLED" /></div>
            <div className="mt-1 text-3xl font-bold text-brand-700">{pct(p.probability_reaching_target, 0)}</div>
            <div className="text-xs text-stone-600">share of Monte Carlo draws where {p.drives_per_month} drives/month is enough</div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-xs text-stone-600">
            Donors per drive: {p.donors_per_drive_basis}<br />
            {p.admin1_note && <><Badge kind="ASSUMPTION" /> {p.admin1_note}</>}
          </div>
        </div>
      </Card>
      <Card title="Cumulative units collected vs needed (fan = P10–P90)">
        <TimelineFan timeline={p.timeline} />
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          {p.timeline.map((t) => (
            <span key={t.month} className="rounded bg-stone-100 px-2 py-0.5">m{t.month}: {pct(t.p_on_track, 0)} on track</span>
          ))}
        </div>
      </Card>
      <Card title="Assumptions used in this plan">
        <table className="w-full text-xs">
          <tbody>{p.assumptions.map((a) => (
            <tr key={a.name} className="border-t"><td className="py-1"><Badge kind="ASSUMPTION" /> {a.label}</td>
              <td className="font-mono">{fmt(a.central)} (P10 {fmt(a.p10)} – P90 {fmt(a.p90)})</td></tr>
          ))}</tbody>
        </table>
        <p className="mt-2 text-[11px] text-stone-500">Modelled from {p.source} burden estimates. Figures: {fmtQ(p.gap_units_per_year)} units/yr. Not clinical advice.</p>
      </Card>
    </div>
  );
}
