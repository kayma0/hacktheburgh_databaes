from __future__ import annotations

from pydantic import BaseModel, Field


class SimulateRequest(BaseModel):
    country: str
    units_per_event: float = 2.0
    donor_deferral_rate: float = 0.20
    share_diagnosed: float = 0.20
    share_on_hydroxyurea: float = 0.15
    target_coverage: float = 0.50


class Percentiles(BaseModel):
    p10: float
    p50: float
    p90: float


class ScenarioResult(BaseModel):
    demand_units: Percentiles
    donors_needed: Percentiles
    demand_pct_of_collections: Percentiles


class SimulateResponse(BaseModel):
    country: str
    is_sample_data: bool
    baseline: ScenarioResult
    universal_diagnosis_hydroxyurea: ScenarioResult
    units_avoided: Percentiles


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
