from __future__ import annotations

from typing import Annotated

from pydantic import BaseModel, Field

CrisisCount = Annotated[int, Field(ge=0, le=5_000_000)]


class SimulateRequest(BaseModel):
    country: str
    units_per_event: float = Field(2.0, ge=0.5, le=10)
    donor_deferral_rate: float = Field(0.20, ge=0, le=0.9)
    share_diagnosed: float = Field(0.20, ge=0, le=1)
    share_on_hydroxyurea: float = Field(0.15, ge=0, le=1)
    target_coverage: float = Field(0.50, ge=0, le=1)
    # Stress test: patients in acute crisis needing transfusion in the same window.
    crisis_patients: int = Field(0, ge=0, le=5_000_000)
    # ASSUMPTION slider: red cells held, in days of national collections.
    stock_days_on_hand: float = Field(5.0, ge=0, le=60)
    # Patients in crisis by age band: under_5, age_5_14, age_15_24, age_25_plus.
    # When given, it replaces crisis_patients x units_per_event for the stock test.
    crisis_by_age: dict[str, CrisisCount] | None = None


class Percentiles(BaseModel):
    p10: float
    p50: float
    p90: float


class ScenarioResult(BaseModel):
    demand_units: Percentiles
    donors_needed: Percentiles
    demand_pct_of_collections: Percentiles


class BloodTypeStock(BaseModel):
    blood_type: str
    supply_share: float
    demand_share: float
    units_on_hand: float
    target_units: float
    units_after_crisis: Percentiles
    days_of_cover: Percentiles
    crisis_units: Percentiles
    shortfall_units: Percentiles
    donors_to_target: Percentiles
    status: str = Field(description="ok | low | critical")


class SimulateResponse(BaseModel):
    country: str
    is_sample_data: bool
    affected_children: Percentiles
    collections_per_day: float
    target_stock_days: float
    stock: list[BloodTypeStock]
    crisis_units_total: Percentiles
    crisis_units_by_age: dict[str, Percentiles] = {}
    baseline: ScenarioResult
    universal_diagnosis_hydroxyurea: ScenarioResult
    units_avoided: Percentiles


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


class BriefingRequest(BaseModel):
    country: str
    month: str


class BriefingItem(BaseModel):
    text: str
    confidence: str = Field(description="low | medium | high")
    verify_with: str


class BriefingSection(BaseModel):
    title: str
    items: list[BriefingItem]


class BriefingResponse(BaseModel):
    country: str
    month: str
    grounded: bool
    sources: list[str] = []
    sections: list[BriefingSection]
    fallback_used: bool = False
