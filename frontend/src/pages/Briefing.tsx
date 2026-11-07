import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Briefing, Meta, MONTHS, api } from "../api";
import { Badge, Card, ErrorBox } from "../components/ui";

const SECTION_TITLES: Record<string, string> = {
  community_engagement: "Community engagement & cultural considerations",
  logistics: "Logistics",
  health_and_safety: "Health & safety",
  travel_and_security: "Travel & security",
  regulation_and_partnerships: "Regulation & partnerships",
  seasonal_factors: "Seasonal factors",
  questions_for_local_partners: "Questions to ask local partners",
};
const CONF: Record<string, string> = { high: "bg-emerald-100 text-emerald-800", medium: "bg-sky-100 text-sky-800", low: "bg-stone-200 text-stone-700" };

export default function BriefingPage({ meta }: { meta: Meta }) {
  const countries = meta.countries ?? [];
  const [iso3, setIso3] = useState(countries[0]?.iso3 ?? "");
  const [admin1, setAdmin1] = useState("");
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [ctx, setCtx] = useState("");
  const m = useMutation({ mutationFn: () => api.briefing({ iso3, admin1: admin1 || null, month, charity_context: ctx }) });
  const regions = countries.find((c) => c.iso3 === iso3)?.admin1 ?? [];

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Field briefing (Gemini)">
        <form className="grid gap-3 text-sm" onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
          <label>Country
            <select className="mt-1 w-full rounded border px-2 py-1" value={iso3} onChange={(e) => { setIso3(e.target.value); setAdmin1(""); }}>
              {countries.map((c) => <option key={c.iso3} value={c.iso3}>{c.name}</option>)}
            </select>
          </label>
          <label>Region (optional)
            <select className="mt-1 w-full rounded border px-2 py-1" value={admin1} onChange={(e) => setAdmin1(e.target.value)} disabled={!regions.length}>
              <option value="">Whole country</option>
              {regions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>
          <label>Month of the drive
            <select className="mt-1 w-full rounded border px-2 py-1" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((n, i) => <option key={n} value={i + 1}>{n}</option>)}
            </select>
          </label>
          <label>About your charity (optional, no personal data)
            <textarea maxLength={1500} rows={4} className="mt-1 w-full rounded border px-2 py-1" value={ctx} onChange={(e) => setCtx(e.target.value)}
              placeholder="e.g. small UK charity, first drive in this country, working with a local SCD parents' group" />
          </label>
          <button disabled={!iso3 || m.isPending} className="rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-40">
            {m.isPending ? "Writing briefing…" : "Generate briefing"}
          </button>
          {m.error && <ErrorBox error={m.error} />}
        </form>
      </Card>
      <div className="lg:col-span-2">{m.data ? <BriefingView b={m.data} /> :
        <Card><p className="text-sm text-stone-500">An AI-written checklist of what to look out for. Every item says how confident it is and who to verify it with.</p></Card>}</div>
    </div>
  );
}

function BriefingView({ b }: { b: Briefing }) {
  return (
    <div className="grid gap-3">
      <Card title={<span className="flex items-center gap-2">{b.country}{b.admin1 ? ` · ${b.admin1}` : ""} · {MONTHS[b.month - 1]} <Badge kind={b.status} /></span>}
        right={<span className="text-[11px] text-stone-500">{b.model ?? "no model"} · {b.generated_at}{b.cached ? " · cached" : ""}</span>}>
        <p className={`rounded p-2 text-xs ${b.status === "GROUNDED" ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900"}`}>{b.status_note}</p>
        <p className="mt-2 text-xs text-stone-600">{b.disclaimer}</p>
      </Card>
      {Object.entries(b.sections).map(([k, items]) => (
        <Card key={k} title={SECTION_TITLES[k] ?? k}>
          <ul className="grid gap-2">
            {items.map((it, i) => (
              <li key={i} className="text-sm">
                <span className={`mr-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase ${CONF[it.confidence]}`}>{it.confidence}</span>
                {it.text}
                <div className="text-[11px] text-stone-500">Verify with: {it.verify_with}</div>
              </li>
            ))}
          </ul>
        </Card>
      ))}
      {b.sources.length > 0 && (
        <Card title="Sources (Google Search grounding)">
          <ul className="list-disc pl-5 text-xs">
            {b.sources.map((s) => <li key={s.url}><a className="text-brand-700 underline" href={s.url} target="_blank" rel="noreferrer">{s.title ?? s.url}</a></li>)}
          </ul>
        </Card>
      )}
    </div>
  );
}
