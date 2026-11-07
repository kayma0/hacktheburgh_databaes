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

export interface YearPoint {
  year: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface HotspotItem {
  country: string;
  heat: number;
  cases_now: Percentiles;
  cases_horizon: Percentiles;
  growth_pct_per_year: Percentiles;
  births_per_year_horizon: Percentiles;
  deaths_per_year_horizon: Percentiles;
  deaths_cumulative: Percentiles;
  /** Observed GBD series (p50 = estimate, p10/p90 = its 95% interval). */
  history: YearPoint[];
  /** Modelled projection from the last data year to the horizon. */
  path: YearPoint[];
}

export interface HotspotsResponse {
  data_year: number;
  horizon: number;
  u5_mortality_mode: number;
  items: HotspotItem[];
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

export async function getHotspots(
  horizon: number,
  u5Mortality: number,
): Promise<HotspotsResponse> {
  const q = new URLSearchParams({
    horizon: String(horizon),
    u5_mortality: String(u5Mortality),
  });
  const res = await fetch(`/api/hotspots?${q}`);
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
