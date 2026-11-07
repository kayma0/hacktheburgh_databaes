"""Pydantic v2 request/response models."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

Overrides = dict[str, dict[str, float]]


class ModelRequest(BaseModel):
    source: str = "lancet"
    overrides: Overrides = Field(default_factory=dict)
    seed: int | None = None


class SimulateRequest(ModelRequest):
    top_k: int = Field(10, ge=1, le=48)
    rank_by: Literal["gap_units", "pct_of_collections", "children"] = "gap_units"


class CountryRequest(ModelRequest):
    iso3: str = Field(min_length=3, max_length=3)


class FacilityRequest(CountryRequest):
    admin1: str | None = None


class SensitivityRequest(ModelRequest):
    iso3: list[str] | None = None


class PlanRequest(ModelRequest):
    iso3: str = Field(min_length=3, max_length=3)
    admin1: str | None = None
    drives_per_month: float = Field(gt=0, le=1000)
    donors_per_drive: float | None = Field(default=None, gt=0, le=5000)
    horizon_months: int = Field(12, ge=1, le=60)
    partner_service: str = Field(min_length=3, max_length=200)
    partner_confirmed_licensed: bool


# ------------------------------------------------------------------ Gemini field briefing

class BriefingRequest(BaseModel):
    iso3: str = Field(min_length=3, max_length=3)
    admin1: str | None = Field(default=None, max_length=120)
    month: int = Field(ge=1, le=12)
    charity_context: str = Field(default="", max_length=1500)

    @field_validator("charity_context")
    @classmethod
    def strip(cls, v: str) -> str:
        return v.strip()


class BriefingItem(BaseModel):
    text: str
    confidence: Literal["low", "medium", "high"]
    verify_with: str


class BriefingSections(BaseModel):
    community_engagement: list[BriefingItem]
    logistics: list[BriefingItem]
    health_and_safety: list[BriefingItem]
    travel_and_security: list[BriefingItem]
    regulation_and_partnerships: list[BriefingItem]
    seasonal_factors: list[BriefingItem]
    questions_for_local_partners: list[BriefingItem]


class Source(BaseModel):
    title: str | None = None
    url: str


class Briefing(BaseModel):
    iso3: str
    country: str
    admin1: str | None
    month: int
    status: Literal["GROUNDED", "UNGROUNDED", "FALLBACK"]
    status_note: str
    sections: BriefingSections
    sources: list[Source] = Field(default_factory=list)
    model: str | None = None
    generated_at: str
    cached: bool = False
    disclaimer: str
