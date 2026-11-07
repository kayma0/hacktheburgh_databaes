import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { Badge, ErrorBox, Loading, SampleBanner } from "./components/ui";
import { ModelProvider, useModel } from "./model";
import Overview from "./pages/Overview";
import ScenarioLab from "./pages/ScenarioLab";
import Planner from "./pages/Planner";
import BriefingPage from "./pages/Briefing";
import MethodPage from "./pages/Method";

const TABS = ["Overview", "Scenario Lab", "Drive Planner", "Field Briefing", "Method & Data"] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const meta = useQuery({ queryKey: ["meta"], queryFn: api.meta });
  if (meta.isLoading) return <Loading what="Loading data" />;
  if (meta.error) return <div className="p-6"><ErrorBox error={meta.error} /></div>;
  const m = meta.data!;
  return (
    <ModelProvider defaultSource={m.sources?.[0] ?? "lancet"}>
      <SampleBanner text={m.banner} />
      <Shell />
    </ModelProvider>
  );
}

function Shell() {
  const [tab, setTab] = useState<Tab>("Overview");
  const meta = useQuery({ queryKey: ["meta"], queryFn: api.meta });
  const { source, setSource } = useModel();
  const m = meta.data!;
  return (
    <div className="mx-auto max-w-7xl p-4">
      <header className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-700">SickleSupply</h1>
          <p className="text-sm text-stone-600">
            Where is the modelled blood shortfall for children with sickle cell disease largest, and how many voluntary donors would close it?{" "}
            <Badge kind="MODELLED" title="All estimates are modelled, not observed" />
          </p>
        </div>
        {m.sources && m.sources.length > 0 && (
          <label className="text-sm">
            Burden source{" "}
            <select className="rounded border px-2 py-1" value={source} onChange={(e) => setSource(e.target.value)}>
              {m.sources.map((s) => <option key={s} value={s}>{s === "gbd" ? "GBD 2021" : s === "lancet" ? "Lancet Child 2026" : s}</option>)}
            </select>
          </label>
        )}
      </header>
      {m.error && (
        <div className="mb-4"><ErrorBox error={new Error(m.error)} /></div>
      )}
      <nav className="no-print mb-4 flex flex-wrap gap-1 border-b border-stone-200">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-t-lg px-4 py-2 text-sm font-medium ${tab === t ? "bg-white border border-b-white border-stone-200 -mb-px text-brand-700" : "text-stone-600 hover:text-stone-900"}`}>
            {t}
          </button>
        ))}
      </nav>
      {!m.error && (
        <main>
          {tab === "Overview" && <Overview meta={m} />}
          {tab === "Scenario Lab" && <ScenarioLab />}
          {tab === "Drive Planner" && <Planner meta={m} />}
          {tab === "Field Briefing" && <BriefingPage meta={m} />}
          {tab === "Method & Data" && <MethodPage meta={m} />}
        </main>
      )}
      {m.error && tab === "Method & Data" && <MethodPage meta={m} />}
      <footer className="no-print mt-8 border-t pt-3 text-xs text-stone-500">
        Not a medical device and not clinical advice. Aggregate data only; no patient or donor personal data is stored.
        Donation must be voluntary, unpaid and run through the national blood transfusion service or a licensed blood bank.
      </footer>
    </div>
  );
}
