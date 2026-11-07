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

export interface SimulateResponse {
  country: string;
  is_sample_data: boolean;
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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
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

export function getBriefing(country: string, month: string): Promise<BriefingResponse> {
  return postJson("/api/briefing", { country, month });
}
