export interface Percentiles {
  p10: number;
  p50: number;
  p90: number;
}

export interface ScenarioResult {
  demand_units: Percentiles;
  donors_needed: Percentiles;
  demand_pct_of_collections: Percentiles;
}

export type StockStatus = "ok" | "low" | "critical";

export interface BloodTypeStock {
  blood_type: string;
  supply_share: number;
  demand_share: number;
  units_on_hand: number;
  target_units: number;
  units_after_crisis: Percentiles;
  days_of_cover: Percentiles;
  crisis_units: Percentiles;
  shortfall_units: Percentiles;
  donors_to_target: Percentiles;
  status: StockStatus;
}

export interface SimulateResponse {
  country: string;
  is_sample_data: boolean;
  affected_children: Percentiles;
  collections_per_day: number;
  target_stock_days: number;
  stock: BloodTypeStock[];
  crisis_units_total: Percentiles;
  crisis_units_by_age: Record<string, Percentiles>;
  baseline: ScenarioResult;
  universal_diagnosis_hydroxyurea: ScenarioResult;
  units_avoided: Percentiles;
}

export interface SimulateRequest {
  country: string;
  units_per_event: number;
  donor_deferral_rate: number;
  share_diagnosed: number;
  share_on_hydroxyurea: number;
  target_coverage: number;
  crisis_patients?: number;
  stock_days_on_hand: number;
  /** Keys: under_5, age_5_14, age_15_24, age_25_plus */
  crisis_by_age?: Record<string, number>;
}

export interface HeatBucket {
  label: string;
  max_cases: number | null;
}

export interface HotspotItem {
  country: string;
  iso3: string;
  /** Estimated people living with SCD in `year`. */
  cases: number;
  cases_low: number;
  cases_high: number;
  growth_pct_per_year: number;
  /** 0-1, log-scaled cases. */
  intensity: number;
  /** "very low" | "low" | "moderate" | "high" | "very high" */
  bucket: string;
}

export interface HotspotsResponse {
  year: number;
  data_year: number;
  source: string;
  method: string;
  buckets: HeatBucket[];
  items: HotspotItem[];
}

export interface ReservoirType {
  blood_type: string;
  /** Share of donors with this type (0-1). */
  donor_share: number;
  /** Whole-blood donations of this type collected per day. */
  donated_per_day: Percentiles;
  /** Donations left after discards (expiry, infection screening, ...). */
  usable_per_day: Percentiles;
  /** Units of this type used per day (all-cause need + SCD). */
  demand_per_day: Percentiles;
  scd_demand_per_day: Percentiles;
  supply_ratio: Percentiles;
  /** Days of stock this type could sustain, capped at the national target. */
  days: Percentiles;
  /** 0-1: P50 days as a share of the target. */
  fill: number;
  status: StockStatus;
  /** Extra donations per day needed to cover demand. */
  extra_donations_per_day: Percentiles;
}

export interface ReservoirResponse {
  country: string;
  data_year: number;
  scd_data_year: number;
  target_days: number;
  target_source: string;
  target_is_assumption: boolean;
  blood_type_source: string;
  blood_type_is_assumption: boolean;
  donations_source: string;
  donations_is_assumption: boolean;
  donations_note: string;
  population: number;
  donations_per_year: number;
  donations_per_1000: number;
  share_in_care: number;
  /** General (non-SCD) need per 1000 people a year, calibrated. */
  need_per_1000: NeedRange;
  scd_patients: number;
  scd_by_age: Record<string, { patients: number; units_per_day: Percentiles }>;
  donated_per_day: number;
  usable_per_day: Percentiles;
  demand_per_day: Percentiles;
  scd_demand_per_day: Percentiles;
  scd_share_of_demand: Percentiles;
  types: ReservoirType[];
}

export interface NeedRange {
  min: number;
  mode: number;
  max: number;
}

export interface CalibrationRow {
  country: string;
  year: number;
  /** Published national requirement, units a year. */
  requirement_units: number;
  population: number;
  scd_units: number;
  implied_need_per_1000: number;
  /** What the calibrated model gives for that country and year. */
  modelled_units: Percentiles;
  source: string;
  url: string;
  note: string;
}

export interface CalibrationResponse {
  need_per_1000: NeedRange;
  rows: CalibrationRow[];
}

export async function getCalibration(): Promise<CalibrationResponse> {
  const res = await fetch("/api/calibration");
  if (!res.ok) throw new Error(`/api/calibration failed: ${res.status}`);
  return res.json();
}

export async function getReservoir(
  country: string,
  shareInCare: number,
): Promise<ReservoirResponse> {
  const q = new URLSearchParams({
    country,
    share_in_care: String(shareInCare),
  });
  const res = await fetch(`/api/reservoir?${q}`);
  if (!res.ok) throw new Error(`/api/reservoir failed: ${res.status}`);
  return res.json();
}

export interface BriefingItem {
  text: string;
  confidence: string;
  verify_with: string;
}

export interface BriefingSection {
  title: string;
  items: BriefingItem[];
}

export interface BriefingResponse {
  country: string;
  month: string;
  grounded: boolean;
  sources: string[];
  sections: BriefingSection[];
  fallback_used: boolean;
}

export interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  sources?: string[];
  offline?: boolean;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

export async function getHealth(): Promise<{ is_sample_data: boolean }> {
  const res = await fetch("/api/health");
  return res.json();
}

export async function getCountries(): Promise<string[]> {
  const res = await fetch("/api/countries");
  const data = await res.json();
  return data.countries;
}

export function simulate(req: SimulateRequest): Promise<SimulateResponse> {
  return postJson("/api/simulate", req);
}

export async function getHotspots(): Promise<HotspotsResponse> {
  const res = await fetch("/api/hotspots");
  if (!res.ok) throw new Error(`/api/hotspots failed: ${res.status}`);
  return res.json();
}

export function getBriefing(
  country: string,
  month: string,
): Promise<BriefingResponse> {
  return postJson("/api/briefing", { country, month });
}

/**
 * Field-briefing assistant. BACKEND TODO (teammate): implement
 * POST /api/assistant  { country, month, question, history: ChatMessage[] }
 *   -> { answer: string, sources?: string[] }
 * Until it exists, the UI shows an "assistant offline" reply.
 */
export function askAssistant(
  country: string,
  month: string,
  question: string,
  history: ChatMessage[],
): Promise<{ answer: string; sources?: string[] }> {
  return postJson("/api/assistant", {
    country,
    month,
    question,
    history: history.map(({ role, text }) => ({ role, text })),
  });
}
