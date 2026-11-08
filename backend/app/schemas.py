from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

BloodGroup = Literal["O+", "A+", "B+", "AB+", "O-", "A-", "B-", "AB-"]
Channel = Literal["whatsapp", "sms", "email"]


class Percentiles(BaseModel):
    p10: float
    p50: float
    p90: float


class HeatBucket(BaseModel):
    label: str
    max_cases: int | None = None


class HotspotItem(BaseModel):
    country: str
    iso3: str
    cases: int
    cases_low: int
    cases_high: int
    growth_pct_per_year: float
    intensity: float = Field(description="0-1, log-scaled cases")
    bucket: str


class HotspotsResponse(BaseModel):
    year: int
    data_year: int
    source: str
    method: str
    buckets: list[HeatBucket]
    items: list[HotspotItem]


class ReservoirType(BaseModel):
    blood_type: str
    donor_share: float
    donated_per_day: Percentiles
    usable_per_day: Percentiles
    demand_per_day: Percentiles
    scd_demand_per_day: Percentiles
    supply_ratio: Percentiles
    days: Percentiles = Field(description="Days of stock this type could sustain")
    fill: float = Field(description="0-1: P50 days as a share of the national target")
    status: str = Field(description="ok | low | critical")
    extra_donations_per_day: Percentiles


class ScdBand(BaseModel):
    patients: float
    units_per_day: Percentiles


class NeedRange(BaseModel):
    min: float
    mode: float
    max: float


class CalibrationRow(BaseModel):
    country: str
    year: int
    requirement_units: float
    population: float
    scd_units: float
    implied_need_per_1000: float
    modelled_units: Percentiles
    source: str
    url: str
    note: str


class CalibrationResponse(BaseModel):
    need_per_1000: NeedRange = Field(
        description="General (non-SCD) whole-blood need per 1000 people a year, fitted")
    rows: list[CalibrationRow]


class ReservoirResponse(BaseModel):
    country: str
    data_year: int
    scd_data_year: int
    target_days: float
    target_source: str
    target_is_assumption: bool
    blood_type_source: str
    blood_type_is_assumption: bool
    donations_source: str
    donations_is_assumption: bool
    donations_note: str
    population: float
    donations_per_year: float
    donations_per_1000: float
    donation_history_years: list[int] = []
    donations_reported_year: int | None = None
    share_in_care: float
    need_per_1000: NeedRange
    scd_patients: float
    scd_by_age: dict[str, ScdBand]
    donated_per_day: float
    usable_per_day: Percentiles
    demand_per_day: Percentiles
    scd_demand_per_day: Percentiles
    scd_share_of_demand: Percentiles
    types: list[ReservoirType]


class PoolPatient(BaseModel):
    id: int
    sex: str
    age: str = Field(description="GBD age band, e.g. '5-9 years'")
    age_group: str = Field(description="under_5 | children | teens | adults")
    blood_group: str


class CrisisPatient(PoolPatient):
    day: float = Field(description="Day of the window the crisis starts")
    units: float = Field(description="Red-cell units this crisis needs")
    served: bool


class CrisisGroup(BaseModel):
    blood_group: str
    patients_mean: float
    share_of_sims_with_patients: float
    units_needed: Percentiles
    units_short: Percentiles
    p_short: float = Field(description="Share of simulations with a patient of this group left unserved")
    collected_per_day: float
    routine_use_per_day: float
    stock_at_start: float
    runs_dry_after_days: float | None = Field(
        description="Days until normal use alone empties this group's stock; null if never")
    donors_to_cover: int = Field(
        description="Extra donors of this group to recruit before the window (covers 90% of runs)")
    deadline_day: float | None = Field(
        description="Median day this group's first patient goes without, where one does")


class CrisisTrend(BaseModel):
    scd_people_now: float
    scd_people_data_year: float
    scd_data_year: int
    donation_years: list[int]
    donations_per_1000_history: list[float]
    donations_per_1000_now: Percentiles
    donation_growth_pct_per_year: float
    donation_fallback: bool
    population_now: float


class CrisisResponse(BaseModel):
    country: str
    people: int
    days: int
    seed: int
    draws: int
    projection_year: int
    verdict: str = Field(description="enough | at_risk | not_enough")
    p_all_served: float
    patients_unserved: Percentiles
    units_needed: Percentiles
    lacking: list[str]
    at_risk: list[str]
    by_group: list[CrisisGroup]
    example: list[CrisisPatient]
    example_counts: dict[str, int]
    age_group_labels: dict[str, str]
    pool: list[PoolPatient]
    trend: CrisisTrend
    collected_per_day: Percentiles
    routine_use_per_day: Percentiles
    target_days: float
    o_neg_fallback: bool = False
    o_neg_given_units: Percentiles = Field(
        description="O- units given to patients of other groups (O- fallback on)")
    o_neg_patients_helped: float = Field(description="Mean number of such patients per simulation")
    first_short_day: float | None = Field(
        description="Median day the first patient goes without blood, in runs where anyone does")
    share_runs_with_shortage: float
    donors_to_cover_total: int
    cover_share: float


class AppealRequest(BaseModel):
    country: str
    people: int = Field(ge=1, le=50)
    days: int = Field(ge=1, le=365)
    verdict: str
    donors: dict[BloodGroup, int] = Field(description="Blood group -> donors to recruit")
    deadlines: dict[BloodGroup, str] = Field(
        default_factory=dict, description="Blood group -> 'by Sun 15 Nov' style deadline")
    organisation: str | None = Field(None, max_length=80)
    patients_by_age: dict[str, int] = Field(
        default_factory=dict, description="under_5 | children | teens | adults -> count")
    variant: int = Field(0, ge=0, le=50, description="0 = first draft; 1, 2, ... = rewrites")


class AppealResponse(BaseModel):
    whatsapp: str
    sms: str = Field(description="Short version, about 300 characters")
    email_subject: str
    email_body: str
    source: str = Field(description="gemini | template")


class PlanGroup(BaseModel):
    blood_group: str
    action: str = Field(description="push | watch | ok")
    status: str = Field(description="ok | low | critical (everyday stock)")
    days: Percentiles
    fill: float
    p_short: float = Field(description="Share of crisis simulations where this group ran short")
    runs_dry_after_days: float | None = None
    units_short: Percentiles
    scd_units_per_year: Percentiles = Field(description="Red-cell units a year for people with SCD in care")
    extra_donations_per_year: Percentiles = Field(
        description="The whole country's everyday shortfall for this group (context, not the target)")
    donors_ongoing: Percentiles = Field(description="Regular donors to supply the chosen share of SCD need")
    donors_surge: Percentiles = Field(description="One-off donors for the crisis window")


class PlanTotals(BaseModel):
    donors_ongoing: Percentiles
    donors_surge: Percentiles


class PlanParams(BaseModel):
    share_in_care: float
    people: int
    days: int
    seed: int
    deferral: float
    donations_per_donor: float
    coverage: float
    o_neg_fallback: bool


class PlanAssumption(BaseModel):
    key: str
    label: str
    value: float | None = None
    is_assumption: bool
    source: str


class PlanResponse(BaseModel):
    country: str
    projection_year: int
    params: PlanParams
    verdict: str = Field(description="enough | at_risk | not_enough (crisis test)")
    p_all_served: float
    patients_unserved: Percentiles
    units_needed: Percentiles
    target_days: float
    scd_patients: float
    push: list[str]
    watch: list[str]
    groups: list[PlanGroup]
    totals: PlanTotals
    assumptions: list[PlanAssumption]
    disclaimer: str


class BacktestHorizon(BaseModel):
    years_ahead: int
    year: int
    countries: int
    median_error: float
    p90_error: float
    share_within_10pct: float


class BacktestWorst(BaseModel):
    country: str
    error: float


class BacktestResponse(BaseModel):
    train_end: int
    fit_years: int
    min_cases: int
    by_horizon: list[BacktestHorizon]
    worst_at_longest: list[BacktestWorst]


class SensitivityRow(BaseModel):
    key: str
    label: str
    as_percent: bool
    low_value: float
    high_value: float
    low_donors: float
    high_donors: float
    swing: float


class SensitivityResponse(BaseModel):
    country: str
    base_donors: float
    rows: list[SensitivityRow]


class SavedPlanIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    country: str
    query: str = Field(max_length=400, description="The plan page's settings, as in the URL")


class SavedPlan(BaseModel):
    id: int
    name: str
    country: str
    query: str
    created_at: str


class BriefingRequest(BaseModel):
    country: str


class BriefingItem(BaseModel):
    text: str


class BriefingSection(BaseModel):
    title: str
    items: list[BriefingItem]


class BriefingResponse(BaseModel):
    country: str
    grounded: bool = Field(description="True when UK government advice was loaded for this country")
    sources: list[str] = []
    updated: str | None = Field(None, description="Date gov.uk last updated its advice, YYYY-MM-DD")
    sections: list[BriefingSection]
    fallback_used: bool = False


# ───────────── donor registry ─────────────


class DonorIn(BaseModel):
    """A donor signing up. They must agree to be contacted, and give a phone or an email."""
    name: str = Field(min_length=1, max_length=80)
    phone: str | None = Field(None, max_length=24, description="International format, e.g. +233 20 123 4567")
    email: str | None = Field(None, max_length=120)
    blood_group: BloodGroup
    country: str = Field(min_length=1, max_length=80)
    last_donated: date | None = None
    consent: Literal[True] = Field(description="Agrees to be contacted when their group is needed")

    @field_validator("name", "phone", "email", mode="before")
    @classmethod
    def blank_is_none(cls, v):
        return (v.strip() or None) if isinstance(v, str) else v

    @field_validator("phone")
    @classmethod
    def phone_digits(cls, v: str | None) -> str | None:
        if v is None:
            return None
        digits = "".join(ch for ch in v if ch.isdigit())
        if not 7 <= len(digits) <= 15:
            raise ValueError("phone needs 7 to 15 digits, with the country code")
        return "+" + digits

    @field_validator("email")
    @classmethod
    def email_shape(cls, v: str | None) -> str | None:
        if v is not None and ("@" not in v or "." not in v.rsplit("@", 1)[-1]):
            raise ValueError("not an email address")
        return v

    @model_validator(mode="after")
    def reachable(self):
        if not (self.phone or self.email):
            raise ValueError("give a phone number or an email address")
        return self


class Donor(BaseModel):
    id: int
    name: str
    phone: str | None
    email: str | None
    blood_group: BloodGroup
    country: str
    last_donated: date | None


class MatchedDonor(Donor):
    can_donate: bool = Field(description="Enough time has passed since they last gave blood")
    can_donate_from: date | None = Field(description="When they can next give, if they have given")
    status: Literal["contacted", "pledged", "declined"] | None = Field(
        description="Latest reply in this appeal; null if not contacted yet")
    status_at: datetime | None


class DonorMatchRequest(BaseModel):
    country: str
    donors: dict[BloodGroup, int] = Field(description="Blood group -> donors to recruit")
    deadlines: dict[BloodGroup, str] = Field(default_factory=dict)


class DonorGroupMatch(BaseModel):
    blood_group: BloodGroup
    needed: int
    deadline: str
    on_file: int = Field(description="Consenting donors of this group in the country")
    eligible: int = Field(description="Of those, how many can give now")
    pledged: int
    donors: list[MatchedDonor]


class DonorMatchResponse(BaseModel):
    connected: bool
    registered: int = Field(0, description="Consenting donors on file in this country")
    groups: list[DonorGroupMatch] = []


class CharityIn(BaseModel):
    """The signed-in charity's display name (from its Auth0 profile)."""
    name: str = Field(min_length=1, max_length=120)


class Charity(BaseModel):
    id: str = Field(description="Auth0 user id, or 'local' when sign-in is not set up")
    name: str | None


class ActivityDay(BaseModel):
    day: date
    contacted: int
    pledged: int
    declined: int


class ActivityResponse(BaseModel):
    """This charity's outreach in one country over recent days (from the outreach hypertable)."""
    connected: bool
    days: int
    contacted: int = 0
    pledged: int = 0
    declined: int = 0
    by_day: list[ActivityDay] = []


class OutreachIn(BaseModel):
    donor_ids: list[int] = Field(min_length=1, max_length=500)
    status: Literal["contacted", "pledged", "declined"]
    channel: Channel | None = None
