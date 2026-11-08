/* Number, date and label formatting shared by every page. */

export const BLOOD_GROUPS = ["O+", "A+", "B+", "AB+", "O-", "A-", "B-", "AB-"];

/** Blood group for people to read: a true minus sign, e.g. O−. The API uses "O-". */
export const groupLabel = (g: string) => g.replace("-", "−");

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 12,345 */
export const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");

/** 0.42 -> "42%" */
export const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Days of stock: one decimal under a day, "99+" past three months. */
export const fmtDays = (d: number) => (d >= 99 ? "99+" : d < 1 ? d.toFixed(1) : String(Math.round(d)));

/** A rate per day with sensible precision: 1234, 56, 7.8, 0.12. */
export const fmtRate = (v: number) =>
  v >= 100 ? fmt(v) : v >= 10 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2);

/** Large counts: 2.9M, 45k, 3.2k, 980. */
export const fmtBig = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e6) return `${(n / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e4) return `${Math.round(n / 1e3)}k`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
};

/** "30 days (about 4 weeks)" */
export const fmtWindow = (d: number) => {
  const base = `${d} day${d === 1 ? "" : "s"}`;
  if (d >= 360) return `${base} (about a year)`;
  if (d >= 56) return `${base} (about ${Math.round(d / 30.4)} months)`;
  if (d >= 14) return `${base} (about ${Math.round(d / 7)} weeks)`;
  return base;
};

/** Day N from today as a date, e.g. "Mon 10 Nov". */
export const dayToDate = (day: number) => {
  const d = new Date();
  d.setDate(d.getDate() + Math.max(0, Math.floor(day)));
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
};

/** An ISO date ("2026-03-14") as "14 Mar 2026". */
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
