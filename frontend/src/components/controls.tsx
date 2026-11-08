import type { CSSProperties } from "react";

/** A labelled range slider showing its current value. */
export function Dial({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const fillPct = ((value - min) / (max - min || 1)) * 100;
  return (
    <label className="dial">
      <span className="dial-top">
        <span className="dial-label">{label}</span>
        <span className="dial-value">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--fill": `${fillPct}%` } as CSSProperties}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
    </label>
  );
}

/** An on/off switch with a one-line explanation. */
export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`toggle ${checked ? "is-on" : ""}`}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden>
        <span className="toggle-knob" />
      </span>
      <span className="toggle-text">
        <b>{label}</b>
        <small>{hint}</small>
      </span>
    </label>
  );
}
