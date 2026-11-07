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
    SimulateRequest,
    SimulateResponse,
)

load_dotenv()

app = FastAPI(title="SickleSupply API")

origins = os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA = load_data()


@app.get("/api/health")
def health():
    return {"status": "ok", "is_sample_data": DATA.is_sample}


@app.get("/api/countries")
def countries():
    return {"countries": sorted(DATA.burden["country"].tolist())}


@app.post("/api/simulate", response_model=SimulateResponse)
def simulate(req: SimulateRequest):
    burden_rows = DATA.burden[DATA.burden["country"] == req.country]
    who_rows = DATA.who_blood[DATA.who_blood["country"] == req.country]
    if burden_rows.empty or who_rows.empty:
        raise HTTPException(status_code=404, detail=f"No data for country: {req.country}")

    burden_row = burden_rows.iloc[0].to_dict()
    who_row = who_rows.iloc[0].to_dict()
    collections_per_year = who_row["donations_per_1000"] * who_row["population"] / 1000

    result = model.run_simulation(
        burden_row=burden_row,
        collections_per_year=collections_per_year,
        params=DATA.parameters,
        share_diagnosed=req.share_diagnosed,
        share_on_hydroxyurea=req.share_on_hydroxyurea,
        units_per_event=req.units_per_event,
        donor_deferral_rate=req.donor_deferral_rate,
        target_coverage=req.target_coverage,
    )

    return SimulateResponse(country=req.country, is_sample_data=DATA.is_sample, **result)


@app.post("/api/briefing", response_model=BriefingResponse)
def briefing(req: BriefingRequest):
    return get_briefing(req.country, req.month)


# Serve the built frontend, if present, from the same container.
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
