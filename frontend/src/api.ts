/* Typed client for the FastAPI backend (backend/app/main.py). Types mirror
   backend/app/schemas.py. */

/* The signed-in charity's Auth0 access token goes on every request; the server reads the
   charity from it. Without Auth0 (local mode) there is no token and none is sent. */
let tokenSource: () => Promise<string | null> = async () => null;

export function setTokenSource(source: () => Promise<string | null>) {
  tokenSource = source;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await tokenSource();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) {
    // FastAPI puts the reason in `detail` (a string, or a list of validation errors).
    const detail = await res.json().then((b) => b.detail, () => null);
    const reason = typeof detail === "string" ? detail : Array.isArray(detail) ? detail[0]?.msg : null;
    throw new Error(reason ?? `${path} failed: ${res.status}`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

const getJson = <T>(path: string) => request<T>(path);
const sendJson = <T>(method: "POST" | "PUT", path: string, body: unknown) =>
  request<T>(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
const postJson = <T>(path: string, body: unknown) => sendJson<T>("POST", path, body);

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
  /** General (non-SCD) need per 1000 people a year: min, mode, max. */
  need_per_1000: { min: number; mode: number; max: number };
  scd_patients: number;
  scd_by_age: Record<string, { patients: number; units_per_day: Percentiles }>;
  donated_per_day: number;
  usable_per_day: Percentiles;
  demand_per_day: Percentiles;
  scd_demand_per_day: Percentiles;
  scd_share_of_demand: Percentiles;
  types: ReservoirType[];
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
  /** O− units given to patients of other groups (O− fallback on). */
  o_neg_given_units: Percentiles;
  o_neg_patients_helped: number;
  /** Median day the first patient goes without blood, in runs where anyone does. */
  first_short_day: number | null;
  share_runs_with_shortage: number;
  donors_to_cover_total: number;
  cover_share: number;
}

export interface CrisisOptions {
  /** Give O− when a patient's own group runs out. */
  oNegFallback: boolean;
  /** Repeat an earlier run exactly; a new random run if left out. */
  seed?: number;
}

export function getCrisis(
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
  });
  if (opts.seed !== undefined) q.set("seed", String(opts.seed));
  return getJson(`/api/crisis?${q}`);
}

/* ───────────── drive plan (backend/app/plan.py) ───────────── */

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

export interface PlanResponse {
  country: string;
  projection_year: number;
  params: {
    share_in_care: number;
    people: number;
    days: number;
    seed: number;
    deferral: number;
    donations_per_donor: number;
    coverage: number;
    o_neg_fallback: boolean;
  };
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
  disclaimer: string;
}

/** The crisis the plan is built on (page 2's simulation) and the drive assumptions. */
export interface PlanInputs {
  country: string;
  people: number;
  days: number;
  oNegFallback: boolean;
  /** The crisis run's seed, so the plan describes that exact simulation. */
  seed: number;
  deferral: number;
  donationsPerDonor: number;
  coverage: number;
}

const planParams = (i: PlanInputs) =>
  new URLSearchParams({
    country: i.country,
    people: String(i.people),
    days: String(i.days),
    deferral: String(i.deferral),
    donations_per_donor: String(i.donationsPerDonor),
    coverage: String(i.coverage),
  });

export function getPlan(i: PlanInputs): Promise<PlanResponse> {
  const q = planParams(i);
  q.set("seed", String(i.seed));
  q.set("o_neg_fallback", String(i.oNegFallback));
  return getJson(`/api/plan?${q}`);
}

/* ───────────── how far to trust this (backend/app/backtest.py, plan.sensitivity) ───────────── */

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

export function getBacktest(): Promise<BacktestResponse> {
  return getJson("/api/backtest");
}

export function getSensitivity(i: PlanInputs): Promise<SensitivityResponse> {
  return getJson(`/api/sensitivity?${planParams(i)}`);
}

/* ───────────── before you travel (backend/app/briefing.py) ───────────── */

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

export function getBriefing(country: string): Promise<BriefingResponse> {
  return postJson("/api/briefing", { country });
}

export function getReservoir(country: string): Promise<ReservoirResponse> {
  return getJson(`/api/reservoir?${new URLSearchParams({ country })}`);
}

export function getHotspots(): Promise<HotspotsResponse> {
  return getJson("/api/hotspots");
}

export async function getCountries(): Promise<string[]> {
  return (await getJson<{ countries: string[] }>("/api/countries")).countries;
}

export interface AppealRequest {
  country: string;
  people: number;
  days: number;
  verdict: string;
  /** Blood group ("O-", not "O−") -> donors to recruit, most urgent first. */
  donors: Record<string, number>;
  /** Blood group -> e.g. "by Mon 10 Nov". */
  deadlines: Record<string, string>;
  organisation?: string;
  /** under_5 | children | teens | adults -> count, from the typical run. */
  patients_by_age?: Record<string, number>;
  /** 0 = first draft; 1, 2, ... = rewrites with fresh wording. */
  variant?: number;
}

export interface AppealResponse {
  whatsapp: string;
  sms: string;
  email_subject: string;
  email_body: string;
  /** "gemini" when written by Gemini, "template" otherwise. */
  source: "gemini" | "template";
}

export function draftAppeal(req: AppealRequest): Promise<AppealResponse> {
  return postJson("/api/appeal", req);
}

/* ───────────── donor registry (Postgres) ───────────── */

export type OutreachStatus = "contacted" | "pledged" | "declined";
export type Channel = "whatsapp" | "sms" | "email";

export interface Donor {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  blood_group: string;
  country: string;
  city: string | null;
  last_donated: string | null;
}

export interface MatchedDonor extends Donor {
  /** Enough time has passed since they last gave blood. */
  can_donate: boolean;
  /** When they can next give (ISO date), if they have given before. */
  can_donate_from: string | null;
  /** Latest reply in this appeal; null if not contacted yet. */
  status: OutreachStatus | null;
  status_at: string | null;
}

export interface DonorGroupMatch {
  blood_group: string;
  needed: number;
  deadline: string;
  /** Consenting donors of this group in the country. */
  on_file: number;
  /** Of those, how many can give now. */
  eligible: number;
  pledged: number;
  donors: MatchedDonor[];
}

export interface DonorMatchResponse {
  /** False when the backend has no DATABASE_URL. */
  connected: boolean;
  registered: number;
  groups: DonorGroupMatch[];
}

export interface DonorIn {
  name: string;
  phone?: string;
  email?: string;
  blood_group: string;
  country: string;
  city?: string;
  last_donated?: string;
  consent: true;
}

export function matchDonors(req: {
  country: string;
  donors: Record<string, number>;
  deadlines: Record<string, string>;
}): Promise<DonorMatchResponse> {
  return postJson("/api/donors/match", req);
}

export function registerDonor(donor: DonorIn): Promise<Donor> {
  return postJson("/api/donors", donor);
}

/** Log a contact (one donor, or a whole group at once) or a reply. */
export function logOutreach(donorIds: number[], status: OutreachStatus, channel?: Channel): Promise<{ logged: number }> {
  return postJson("/api/outreach", { donor_ids: donorIds, status, channel });
}

/** This charity's contacts and replies in a country over recent days. */
export interface Activity {
  connected: boolean;
  days: number;
  contacted: number;
  pledged: number;
  declined: number;
  by_day: { day: string; contacted: number; pledged: number; declined: number }[];
}

export function getActivity(country: string, days = 7): Promise<Activity> {
  return getJson(`/api/outreach/activity?${new URLSearchParams({ country, days: String(days) })}`);
}

/* ───────────── charity account (Auth0 sign-in, stored in the database) ───────────── */

/** Record the signed-in charity's name against its account. */
export function saveCharityName(name: string): Promise<{ id: string; name: string }> {
  return sendJson("PUT", "/api/me", { name });
}
