export interface Percentiles {
  p10: number;
  p50: number;
  p90: number;
}

export type StockStatus = "ok" | "low" | "critical";

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
  donation_history_years?: number[];
  donations_reported_year?: number | null;
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

export interface PoolPatient {
  id: number;
  sex: "male" | "female";
  /** GBD age band, e.g. "5-9 years". */
  age: string;
  age_group: "under_5" | "children" | "teens" | "adults";
  blood_group: string;
}

export interface CrisisPatient extends PoolPatient {
  /** Day of the window the crisis starts. */
  day: number;
  /** Red-cell units this crisis needs. */
  units: number;
  served: boolean;
}

export interface CrisisGroup {
  blood_group: string;
  patients_mean: number;
  share_of_sims_with_patients: number;
  units_needed: Percentiles;
  units_short: Percentiles;
  /** Share of simulations with a patient of this group left without blood. */
  p_short: number;
  collected_per_day: number;
  routine_use_per_day: number;
  stock_at_start: number;
  /** Days until normal use alone empties this group's stock; null if never. */
  runs_dry_after_days: number | null;
  /** Extra donors of this group to recruit before the window (covers 90% of runs). */
  donors_to_cover: number;
  /** Median day this group's first patient goes without, where one does. */
  deadline_day: number | null;
}

export interface CrisisResponse {
  country: string;
  people: number;
  days: number;
  seed: number;
  draws: number;
  projection_year: number;
  verdict: "enough" | "at_risk" | "not_enough";
  p_all_served: number;
  patients_unserved: Percentiles;
  units_needed: Percentiles;
  lacking: string[];
  at_risk: string[];
  by_group: CrisisGroup[];
  /** One typical simulation, in the order the crises happen. */
  example: CrisisPatient[];
  example_counts: Record<string, number>;
  age_group_labels: Record<string, string>;
  pool: PoolPatient[];
  trend: {
    scd_people_now: number;
    scd_people_data_year: number;
    scd_data_year: number;
    donation_years: number[];
    donations_per_1000_history: number[];
    donations_per_1000_now: Percentiles;
    donation_growth_pct_per_year: number;
    donation_fallback: boolean;
    population_now: number;
  };
  collected_per_day: Percentiles;
  routine_use_per_day: Percentiles;
  target_days: number;
  o_neg_fallback: boolean;
  crisis_first: boolean;
  /** O− units given to patients of other groups (O− fallback on). */
  o_neg_given_units: Percentiles;
  o_neg_patients_helped: number;
  /** Units crisis patients took from other hospital patients (crisis-first on). */
  routine_displaced_units: Percentiles;
  /** Median day the first patient goes without blood, in runs where anyone does. */
  first_short_day: number | null;
  share_runs_with_shortage: number;
  donors_to_cover_total: number;
  cover_share: number;
}

export interface CrisisOptions {
  /** Give O− when a patient's own group runs out. */
  oNegFallback: boolean;
  /** Serve crisis patients before normal hospital use. */
  crisisFirst: boolean;
}

/** A new random patient pool and simulation on every call. */
export async function getCrisis(
  country: string,
  people: number,
  days: number,
  opts: CrisisOptions,
): Promise<CrisisResponse> {
  const q = new URLSearchParams({
    country,
    people: String(people),
    days: String(days),
    o_neg_fallback: String(opts.oNegFallback),
    crisis_first: String(opts.crisisFirst),
  });
  const res = await fetch(`/api/crisis?${q}`);
  if (!res.ok) throw new Error(`/api/crisis failed: ${res.status}`);
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

/* ── drive plan ── */

export interface PlanGroup {
  blood_group: string;
  /** push = push for this group; watch = keep an eye on it; ok = no action. */
  action: "push" | "watch" | "ok";
  status: StockStatus;
  days: Percentiles;
  fill: number;
  /** Share of crisis simulations in which this group ran short. */
  p_short: number;
  runs_dry_after_days: number | null;
  units_short: Percentiles;
  scd_units_per_year: Percentiles;
  /** The whole country's everyday shortfall for this group (context, not the target). */
  extra_donations_per_year: Percentiles;
  /** Regular donors to supply the chosen share of the SCD patients' everyday need. */
  donors_ongoing: Percentiles;
  /** One-off donors for the crisis window. */
  donors_surge: Percentiles;
}

export interface PlanAssumption {
  key: string;
  label: string;
  value: number | null;
  is_assumption: boolean;
  source: string;
}

export interface PlanParams {
  share_in_care: number;
  people: number;
  days: number;
  seed: number;
  deferral: number;
  donations_per_donor: number;
  coverage: number;
  o_neg_fallback: boolean;
  crisis_first: boolean;
}

export interface PlanResponse {
  country: string;
  projection_year: number;
  params: PlanParams;
  verdict: "enough" | "at_risk" | "not_enough";
  p_all_served: number;
  patients_unserved: Percentiles;
  units_needed: Percentiles;
  target_days: number;
  scd_patients: number;
  push: string[];
  watch: string[];
  groups: PlanGroup[];
  totals: { donors_ongoing: Percentiles; donors_surge: Percentiles };
  assumptions: PlanAssumption[];
  ask: string;
  disclaimer: string;
}

export interface PlanInputs {
  country: string;
  people: number;
  days: number;
  deferral: number;
  donationsPerDonor: number;
  coverage: number;
  oNegFallback: boolean;
  crisisFirst: boolean;
}

export async function getPlan(i: PlanInputs): Promise<PlanResponse> {
  const q = new URLSearchParams({
    country: i.country,
    people: String(i.people),
    days: String(i.days),
    deferral: String(i.deferral),
    donations_per_donor: String(i.donationsPerDonor),
    coverage: String(i.coverage),
    o_neg_fallback: String(i.oNegFallback),
    crisis_first: String(i.crisisFirst),
  });
  const res = await fetch(`/api/plan?${q}`);
  if (!res.ok) throw new Error(`/api/plan failed: ${res.status}`);
  return res.json();
}

/* ── appeal writer ── */

export type AppealChannel = "social" | "email" | "sms" | "poster";
export type AppealTone = "warm" | "urgent" | "formal";
export type AppealLanguage = "English" | "French" | "Portuguese" | "Swahili" | "Arabic" | "Hausa";

export interface AppealResponse {
  text: string;
  channel: AppealChannel;
  tone: AppealTone;
  language: AppealLanguage;
  source: "gemini" | "template";
  /** Set when source is "template": no_api_key | gemini_unavailable | failed_checks. */
  fallback_reason: string | null;
  note: string | null;
  facts_used: { groups: string[]; regular: string | null; oneoff: string | null };
}

export interface AppealInputs extends PlanInputs {
  channel: AppealChannel;
  tone: AppealTone;
  language: AppealLanguage;
  details: { organisation: string; date: string; venue: string; contact: string };
}

export function writeAppeal(i: AppealInputs): Promise<AppealResponse> {
  return postJson("/api/appeal", {
    country: i.country,
    channel: i.channel,
    tone: i.tone,
    language: i.language,
    details: i.details,
    people: i.people,
    days: i.days,
    deferral: i.deferral,
    donations_per_donor: i.donationsPerDonor,
    coverage: i.coverage,
    o_neg_fallback: i.oNegFallback,
    crisis_first: i.crisisFirst,
  });
}

/* ── how far to trust this ── */

export interface BacktestResponse {
  train_end: number;
  fit_years: number;
  min_cases: number;
  by_horizon: {
    years_ahead: number;
    year: number;
    countries: number;
    median_error: number;
    p90_error: number;
    share_within_10pct: number;
  }[];
  worst_at_longest: { country: string; error: number }[];
}

export interface SensitivityResponse {
  country: string;
  base_donors: number;
  rows: {
    key: string;
    label: string;
    as_percent: boolean;
    low_value: number;
    high_value: number;
    low_donors: number;
    high_donors: number;
    swing: number;
  }[];
}

export async function getBacktest(): Promise<BacktestResponse> {
  const res = await fetch("/api/backtest");
  if (!res.ok) throw new Error(`/api/backtest failed: ${res.status}`);
  return res.json();
}

export async function getSensitivity(i: PlanInputs): Promise<SensitivityResponse> {
  const q = new URLSearchParams({
    country: i.country,
    people: String(i.people),
    days: String(i.days),
    deferral: String(i.deferral),
    donations_per_donor: String(i.donationsPerDonor),
    coverage: String(i.coverage),
  });
  const res = await fetch(`/api/sensitivity?${q}`);
  if (!res.ok) throw new Error(`/api/sensitivity failed: ${res.status}`);
  return res.json();
}

export interface BriefingItem {
  text: string;
}

export interface BriefingSection {
  title: string;
  items: BriefingItem[];
}

export interface BriefingResponse {
  country: string;
  /** True when UK government advice was loaded for this country. */
  grounded: boolean;
  sources: string[];
  /** Date gov.uk last updated its advice, YYYY-MM-DD. */
  updated: string | null;
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

export async function getHotspots(): Promise<HotspotsResponse> {
  const res = await fetch("/api/hotspots");
  if (!res.ok) throw new Error(`/api/hotspots failed: ${res.status}`);
  return res.json();
}

export function getBriefing(country: string): Promise<BriefingResponse> {
  return postJson("/api/briefing", { country });
}

export interface CrisisAppealRequest {
  country: string;
  people: number;
  days: number;
  verdict: string;
  /** Blood group -> donors to recruit, most urgent first. */
  donors: Record<string, number>;
  /** Blood group -> e.g. "by Mon 10 Nov". */
  deadlines: Record<string, string>;
  organisation?: string;
  /** under_5 | children | teens | adults -> count, from the typical run. */
  patients_by_age?: Record<string, number>;
  /** 0 = first draft; 1, 2, ... = rewrites with fresh wording. */
  variant?: number;
}

export interface CrisisAppealResponse {
  whatsapp: string;
  sms: string;
  email_subject: string;
  email_body: string;
  /** "gemini" when written by Gemini, "template" otherwise. */
  source: "gemini" | "template";
}

export function draftCrisisAppeal(req: CrisisAppealRequest): Promise<CrisisAppealResponse> {
  return postJson("/api/crisis-appeal", req);
}
