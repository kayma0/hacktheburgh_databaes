from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import model
from .briefing import get_briefing
from .data_loader import load_data
from .schemas import (
    BriefingRequest,
    BriefingResponse,
    HotspotItem,
    HotspotsResponse,
    SimulateRequest,
    SimulateResponse,
)

load_dotenv()

app = FastAPI(title="SickleSignal API")

origins = os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA = load_data()


def _inputs_for(country: str) -> tuple[dict, float] | None:
    burden_rows = DATA.burden[DATA.burden["country"] == country]
    who_rows = DATA.who_blood[DATA.who_blood["country"] == country]
    if burden_rows.empty or who_rows.empty:
        return None
    who_row = who_rows.iloc[0].to_dict()
    collections_per_year = who_row["donations_per_1000"] * \
        who_row["population"] / 1000
    return burden_rows.iloc[0].to_dict(), float(collections_per_year)


@app.get("/api/health")
def health():
    return {"status": "ok", "is_sample_data": DATA.is_sample}


@app.get("/api/countries")
def countries():
    return {"countries": sorted(DATA.burden["country"].tolist())}


@app.post("/api/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest):
    inputs = _inputs_for(req.country)
    if inputs is None:
        raise HTTPException(
            status_code=404, detail=f"No data for country: {req.country}")
    burden_row, collections_per_year = inputs

    result = model.run_simulation(
        burden_row=burden_row,
        collections_per_year=collections_per_year,
        params=DATA.parameters,
        share_diagnosed=req.share_diagnosed,
        share_on_hydroxyurea=req.share_on_hydroxyurea,
        units_per_event=req.units_per_event,
        donor_deferral_rate=req.donor_deferral_rate,
        target_coverage=req.target_coverage,
        crisis_patients=req.crisis_patients,
        stock_days_on_hand=req.stock_days_on_hand,
        crisis_by_age=req.crisis_by_age,
    )

    return SimulateResponse(country=req.country, is_sample_data=DATA.is_sample, **result)


_hotspots_cache: HotspotsResponse | None = None


@app.get("/api/hotspots", response_model=HotspotsResponse)
def hotspots():
    """Every country at default assumptions, scored for the Africa heat map."""
    global _hotspots_cache
    if _hotspots_cache is not None:
        return _hotspots_cache

    d = SimulateRequest(country="")
    rows = []
    for country in sorted(DATA.burden["country"].unique()):
        inputs = _inputs_for(country)
        if inputs is None:
            continue
        burden_row, collections_per_year = inputs
        res = model.run_simulation(
            burden_row=burden_row,
            collections_per_year=collections_per_year,
            params=DATA.parameters,
            share_diagnosed=d.share_diagnosed,
            share_on_hydroxyurea=d.share_on_hydroxyurea,
            units_per_event=d.units_per_event,
            donor_deferral_rate=d.donor_deferral_rate,
            target_coverage=d.target_coverage,
        )
        rows.append({
            "country": country,
            "affected_children": res["affected_children"],
            "demand_units": res["baseline"]["demand_units"],
            "donors_needed": res["baseline"]["donors_needed"],
            "demand_pct_of_collections": res["baseline"]["demand_pct_of_collections"],
        })

    a_max = max((r["affected_children"]["p50"] for r in rows), default=1) or 1
    p_max = max((r["demand_pct_of_collections"]["p50"]
                for r in rows), default=1) or 1
    for r in rows:
        r["heat"] = 0.5 * r["affected_children"]["p50"] / a_max + \
            0.5 * r["demand_pct_of_collections"]["p50"] / p_max
    rows.sort(key=lambda r: r["heat"], reverse=True)

    _hotspots_cache = HotspotsResponse(
        is_sample_data=DATA.is_sample, items=[HotspotItem(**r) for r in rows])
    return _hotspots_cache


@app.post("/api/briefing", response_model=BriefingResponse)
def briefing(req: BriefingRequest):
    return get_briefing(req.country, req.month)


# Serve the built frontend, if present, from the same container.
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR),
              html=True), name="static")
