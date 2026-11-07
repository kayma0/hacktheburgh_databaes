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


class HistoryPoint(BaseModel):
    year: int
    p10: float
    p50: float
    p90: float


class HotspotItem(BaseModel):
    country: str
    heat: float = Field(
        description="0-1 composite of current burden and projected child deaths")
    cases_now: Percentiles
    cases_horizon: Percentiles
    growth_pct_per_year: Percentiles
    births_per_year_horizon: Percentiles
    deaths_per_year_horizon: Percentiles
    deaths_cumulative: Percentiles
    history: list[HistoryPoint]
    path: list[HistoryPoint]


class HotspotsResponse(BaseModel):
    data_year: int
    horizon: int
    u5_mortality_mode: float
    items: list[HotspotItem]


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
