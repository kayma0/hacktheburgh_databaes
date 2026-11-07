// Typed client for the SickleSupply API.

export type Q = { p10: number; p50: number; p90: number };
export type Overrides = Record<string, Record<string, number>>;
export type Status = "observed" | "ml_imputed" | "missing";

export interface Labels { modelled: boolean; sample_data: boolean; banner: string | null }

export interface Param {
  name: string; label: string; kind: "SOURCED" | "ASSUMPTION"; dist: string;
  central: number; p10: number; p90: number; min: number | null; max: number | null;
  unit: string | null; source: string | null; todo: string | null; caveat: string | null; overridden: boolean;
}

export interface CountryRow {
  iso3: string; name: string; subregion: string; population: number; rank: number;
  children_status: Status; donations_status: Status; who_year: number | null;
  p_top_k: number; top_k: number;
  children: Q; diagnosed: Q; demand_units: Q; gap_units: Q; donors_needed: Q; collections: Q;
  pct_of_collections: Q; universal_demand_units: Q; universal_no_hu_demand_units: Q; units_avoided_by_hu: Q;
  [k: string]: unknown;
}

export interface SimResponse extends Labels {
  source: string; rank_by: string; countries: CountryRow[]; totals: Record<string, Q>;
  parameters: Param[]; n_draws: number; seed: number;
}

export interface Meta extends Labels {
  files: { key: string; file: string; present: boolean; required_for: string; how_to_get: string; is_sample: boolean }[];
  error: string | null; sources?: string[]; warnings?: string[]; excluded?: Record<string, string>;
  facilities_error?: string | null; admin1_basis?: string | null;
  countries?: { iso3: string; name: string; admin1: string[] }[];
  status_counts?: Record<string, Record<string, number>>; mc_draws?: number; mc_seed?: number;
}

export interface Admin1Row { admin1: string; share: number; n_facilities: number; rank: number;
  children: Q; demand_units: Q; gap_units: Q; donors_needed: Q }
export interface Admin1Response extends Labels { iso3: string; basis: string; regions: Admin1Row[]; note: string }

export interface Facility { facility_id: number; name: string; admin1: string; facility_type: string | null;
  lat: number | null; lon: number | null; modelled_gap_units: Q }
export interface FacilityResponse extends Labels { iso3: string; admin1: string | null; facilities: Facility[];
  total_in_selection: number; note: string }

export interface TornadoBar { input: string; label: string; kind: string; output_at_p10_input: number;
  output_at_p90_input: number; swing: number }
export interface Sensitivity extends Labels { output: string; baseline: number; bars: TornadoBar[]; note: string }

export interface PlanRequest {
  source: string; overrides: Overrides; iso3: string; admin1: string | null; drives_per_month: number;
  donors_per_drive: number | null; horizon_months: number; partner_service: string; partner_confirmed_licensed: boolean;
}
export interface Plan extends Labels {
  plan_id?: number; iso3: string; country: string; admin1: string | null; partner_service: string; horizon_months: number;
  drives_per_month: number; donors_per_drive_basis: string; gap_units_per_year: Q; donors_needed_in_horizon: Q;
  drives_needed_in_horizon: Q; months_of_drives_to_cover_one_year: Q; probability_reaching_target: number;
  timeline: { month: number; cumulative_attendees: Q; cumulative_units_collected: Q; cumulative_units_needed: Q; p_on_track: number }[];
  label: string; safety_notice: string; admin1_note: string | null; assumptions: Param[]; source: string;
}

export interface BriefingItem { text: string; confidence: "low" | "medium" | "high"; verify_with: string }
export interface Briefing {
  iso3: string; country: string; admin1: string | null; month: number;
  status: "GROUNDED" | "UNGROUNDED" | "FALLBACK"; status_note: string;
  sections: Record<string, BriefingItem[]>; sources: { title: string | null; url: string }[];
  model: string | null; generated_at: string; cached: boolean; disclaimer: string;
}

export interface ImputationReport {
  target: string; n_train: number; loco_mae: number | null; baseline_mae_training_median: number | null;
  raw_interval_coverage_80: number | null; conformal_log_correction: number | null;
  conformal_interval_coverage_80: number | null; n_imputed: number; note: string;
}
export interface Method extends Labels {
  formulas: string[]; limitations: string[]; parameters: Param[]; imputation: Record<string, ImputationReport>;
  sources_loaded: string[]; warnings: string[]; admin1_basis: string | null; mc_draws: number; mc_seed: number;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function req<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) {
    let msg = r.statusText;
    try {
      const j = await r.json();
      msg = typeof j.detail === "string" ? j.detail : JSON.stringify(j.detail);
    } catch { /* ignore */ }
    throw new ApiError(r.status, msg);
  }
  return r.json() as Promise<T>;
}

export const api = {
  meta: () => req<Meta>("/api/meta"),
  simulate: (b: { source: string; overrides: Overrides; rank_by?: string; top_k?: number }) => req<SimResponse>("/api/simulate", b),
  admin1: (b: { source: string; overrides: Overrides; iso3: string }) => req<Admin1Response>("/api/admin1", b),
  facilities: (b: { source: string; overrides: Overrides; iso3: string; admin1: string | null }) => req<FacilityResponse>("/api/facilities", b),
  sensitivity: (b: { source: string; overrides: Overrides; iso3?: string[] | null }) => req<Sensitivity>("/api/sensitivity", b),
  plan: (b: PlanRequest) => req<Plan>("/api/plan", b),
  briefing: (b: { iso3: string; admin1: string | null; month: number; charity_context: string }) => req<Briefing>("/api/briefing", b),
  method: () => req<Method>("/api/method"),
  geo: () => req<GeoJSON.FeatureCollection>("/api/geo/admin0"),
  async planCsv(b: PlanRequest): Promise<void> {
    const r = await fetch("/api/plan.csv", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    if (!r.ok) throw new ApiError(r.status, (await r.json()).detail ?? r.statusText);
    const blob = await r.blob();
    const name = r.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "plan_MODELLED.csv";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  },
};

// ---------------------------------------------------------------- formatting

export function fmt(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "–";
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toPrecision(digits + 1) + "B";
  if (a >= 1e6) return (n / 1e6).toPrecision(digits + 1) + "M";
  if (a >= 1e3) return (n / 1e3).toPrecision(digits + 1) + "k";
  if (a >= 10) return n.toFixed(0);
  return n.toPrecision(digits);
}

export const pct = (x: number | null | undefined, d = 1) =>
  x === null || x === undefined ? "–" : (x * 100).toFixed(d) + "%";

export const fmtQ = (q: Q | undefined, f: (n: number) => string = fmt) =>
  q ? `${f(q.p50)} (${f(q.p10)}–${f(q.p90)})` : "–";

export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
  "October", "November", "December"];
