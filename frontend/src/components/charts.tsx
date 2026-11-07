import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, ErrorBar, Legend, Line, ReferenceLine, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import { Q, TornadoBar, fmt } from "../api";

/** Horizontal P50 bars with P10–P90 whiskers. */
export function IntervalChart({ rows, height }: { rows: { name: string; q: Q; flag?: boolean }[]; height?: number }) {
  const data = rows.map((r) => ({
    name: r.flag ? `${r.name} *` : r.name,
    p50: r.q.p50,
    err: [r.q.p50 - r.q.p10, r.q.p90 - r.q.p50],
    p10: r.q.p10,
    p90: r.q.p90,
  }));
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(200, 26 * data.length + 40)}>
      <BarChart data={data} layout="vertical" margin={{ left: 10, right: 30 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickFormatter={(v) => fmt(v)} />
        <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} />
        <Tooltip formatter={(_v, _n, item) => {
          const p = item.payload as { p10: number; p50: number; p90: number };
          return [`${fmt(p.p50)} (P10 ${fmt(p.p10)} – P90 ${fmt(p.p90)})`, "Modelled"];
        }} />
        <Bar dataKey="p50" fill="#b4234a" fillOpacity={0.75} isAnimationActive={false}>
          <ErrorBar dataKey="err" direction="x" width={6} stroke="#3f3f46" />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Fan chart of cumulative units collected vs needed over the plan horizon. */
export function TimelineFan({ timeline }: {
  timeline: { month: number; cumulative_units_collected: Q; cumulative_units_needed: Q }[];
}) {
  const data = timeline.map((t) => ({
    month: t.month,
    need_lo: t.cumulative_units_needed.p10,
    need_band: t.cumulative_units_needed.p90 - t.cumulative_units_needed.p10,
    need_mid: t.cumulative_units_needed.p50,
    col_lo: t.cumulative_units_collected.p10,
    col_band: t.cumulative_units_collected.p90 - t.cumulative_units_collected.p10,
    col_mid: t.cumulative_units_collected.p50,
  }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <ComposedChart data={data} margin={{ left: 10, right: 20 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" label={{ value: "month", position: "insideBottomRight", offset: -5 }} />
        <YAxis tickFormatter={(v) => fmt(v)} />
        <Tooltip formatter={(v, n) => [fmt(Number(v)), n]} />
        <Legend />
        <Area dataKey="need_lo" stackId="need" stroke="none" fill="transparent" legendType="none" name="need P10" isAnimationActive={false} />
        <Area dataKey="need_band" stackId="need" stroke="none" fill="#b4234a" fillOpacity={0.18} name="Units needed P10–P90" isAnimationActive={false} />
        <Line dataKey="need_mid" stroke="#b4234a" dot={false} strokeWidth={2} name="Units needed (P50)" isAnimationActive={false} />
        <Area dataKey="col_lo" stackId="col" stroke="none" fill="transparent" legendType="none" name="collected P10" isAnimationActive={false} />
        <Area dataKey="col_band" stackId="col" stroke="none" fill="#0f766e" fillOpacity={0.18} name="Units collected P10–P90" isAnimationActive={false} />
        <Line dataKey="col_mid" stroke="#0f766e" dot={false} strokeWidth={2} name="Units collected (P50)" isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** One-at-a-time sensitivity: bars show how far the output moves from the baseline. */
export function Tornado({ bars, baseline }: { bars: TornadoBar[]; baseline: number }) {
  const data = bars.map((b) => {
    const lo = Math.min(b.output_at_p10_input, b.output_at_p90_input) - baseline;
    const hi = Math.max(b.output_at_p10_input, b.output_at_p90_input) - baseline;
    return { label: `${b.label}${b.kind === "ASSUMPTION" ? " ⚑" : ""}`, down: Math.min(lo, 0), up: Math.max(hi, 0),
      lo: b.output_at_p10_input, hi: b.output_at_p90_input };
  });
  return (
    <ResponsiveContainer width="100%" height={60 + 38 * data.length}>
      <BarChart data={data} layout="vertical" stackOffset="sign" margin={{ left: 10, right: 30 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tickFormatter={(v) => fmt(v + baseline)} />
        <YAxis type="category" dataKey="label" width={260} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(_v, _n, item) => {
          const p = item.payload as { lo: number; hi: number };
          return [`input at P10 → ${fmt(p.lo)}, input at P90 → ${fmt(p.hi)}`, "Donors needed / year"];
        }} />
        <ReferenceLine x={0} stroke="#27272a" />
        <Bar dataKey="down" stackId="t" fill="#0f766e" isAnimationActive={false} />
        <Bar dataKey="up" stackId="t" fill="#b4234a" isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
