from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import hotspots as hotspots_mod
from . import model
from .briefing import get_briefing
from .data_loader import load_data
from .schemas import (
    BriefingRequest,
    BriefingResponse,
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

# Legacy model data (burden / WHO blood / parameters). The stock and briefing pages need
# it; the hotspots page does not, so a missing file must not stop the API starting.
try:
    DATA = load_data()
except FileNotFoundError:
    DATA = None


def _need_data():
    if DATA is None:
        raise HTTPException(
            status_code=503,
            detail="Blood-stock model data is not in data/raw/ yet.",
        )
    return DATA


def _inputs_for(country: str) -> tuple[dict, float] | None:
    _need_data()
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
    return {"status": "ok", "is_sample_data": DATA.is_sample if DATA else False}


@app.get("/api/countries")
def countries():
    if DATA is None:
        return {"countries": sorted(hotspots_mod.load_series())}
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


@app.get("/api/hotspots", response_model=HotspotsResponse)
def hotspots(
    horizon: int = Query(hotspots_mod.DEFAULT_HORIZON,
                         ge=hotspots_mod.MIN_HORIZON, le=hotspots_mod.MAX_HORIZON),
):
    """Every country from data/raw.csv: people living with SCD now, projected to
    `horizon`, and the newborns per year who could be reached by early screening."""
    return hotspots_mod.compute_hotspots(horizon)


@app.post("/api/briefing", response_model=BriefingResponse)
def briefing(req: BriefingRequest):
    return get_briefing(req.country, req.month)


# Serve the built frontend, if present, from the same container.
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR),
              html=True), name="static")
