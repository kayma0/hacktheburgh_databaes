import { ReactNode } from "react";
import { ApiError, Q, fmt } from "../api";

type BadgeKind = "MODELLED" | "ASSUMPTION" | "SOURCED" | "ML-IMPUTED" | "OBSERVED" | "SAMPLE" | "GROUNDED" | "UNGROUNDED" | "FALLBACK";

const BADGE: Record<BadgeKind, string> = {
  MODELLED: "bg-indigo-100 text-indigo-800 border-indigo-200",
  ASSUMPTION: "bg-amber-100 text-amber-900 border-amber-300",
  SOURCED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  "ML-IMPUTED": "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-300",
  OBSERVED: "bg-stone-100 text-stone-700 border-stone-200",
  SAMPLE: "bg-red-600 text-white border-red-700",
  GROUNDED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  UNGROUNDED: "bg-amber-100 text-amber-900 border-amber-300",
  FALLBACK: "bg-stone-200 text-stone-800 border-stone-300",
};

export function Badge({ kind, title }: { kind: BadgeKind; title?: string }) {
  return (
    <span title={title} className={`inline-block rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${BADGE[kind]}`}>
      {kind}
    </span>
  );
}

export function StatusBadge({ status }: { status: string }) {
  if (status === "ml_imputed") return <Badge kind="ML-IMPUTED" title="Filled in by the ML model; see Method page" />;
  if (status === "observed") return <Badge kind="OBSERVED" title="From a cited source" />;
  return <span className="text-xs text-red-700">missing</span>;
}

export function Card({ title, right, children, className = "" }: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-stone-200 bg-white p-4 shadow-sm ${className}`}>
      {(title || right) && (
        <div className="mb-3 flex items-start justify-between gap-2">
          <h2 className="font-semibold text-stone-800">{title}</h2>
          {right}
        </div>
      )}
      {children}
    </section>
  );
}

/** A modelled number is never shown without its P10–P90 interval. */
export function Stat({ label, q, f, note }: { label: string; q: Q | undefined; f?: (n: number) => string; note?: ReactNode }) {
  const F = f ?? ((n: number) => fmt(n));
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3">
      <div className="flex items-center gap-1 text-xs text-stone-500">{label} <Badge kind="MODELLED" /></div>
      <div className="mt-1 text-xl font-semibold">{q ? F(q.p50) : "–"}</div>
      <div className="text-xs text-stone-600">P10–P90: {q ? `${F(q.p10)} – ${F(q.p90)}` : "–"}</div>
      {note && <div className="mt-1 text-xs text-stone-500">{note}</div>}
    </div>
  );
}

export function SampleBanner({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="sticky top-0 z-[1000] flex items-center justify-center gap-2 bg-red-600 px-4 py-2 text-sm font-semibold text-white">
      <Badge kind="SAMPLE" /> {text}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError ? error.message : String(error);
  const status = error instanceof ApiError ? error.status : undefined;
  return (
    <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
      <div className="font-semibold">{status === 503 ? "Data files missing or invalid" : "Something went wrong"}</div>
      <pre className="mt-1 whitespace-pre-wrap font-sans">{msg}</pre>
    </div>
  );
}

export function Loading({ what = "Running the model" }: { what?: string }) {
  return <div className="animate-pulse p-4 text-sm text-stone-500">{what}…</div>;
}

export function Slider({ label, value, min, max, step, onChange, format, assumption, hint }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void;
  format: (v: number) => string; assumption?: boolean; hint?: string;
}) {
  return (
    <label className="block">
      <div className="flex items-center justify-between text-sm">
        <span className="flex items-center gap-1">{label} {assumption && <Badge kind="ASSUMPTION" title={hint} />}</span>
        <span className="font-mono">{format(value)}</span>
      </div>
      <input type="range" className="w-full" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))} />
      {hint && <div className="text-[11px] text-stone-500">{hint}</div>}
    </label>
  );
}
