from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import appeal as appeal_mod
from . import auth as auth_mod
from . import plans_store
from . import backtest as backtest_mod
from . import crisis as crisis_mod
from . import hotspots as hotspots_mod
from . import plan as plan_mod
from . import reservoir as reservoir_mod
from .crisis_appeal import draft_crisis_appeal
from .briefing import get_briefing
from .schemas import (
    AppealRequest,
    AppealResponse,
    BacktestResponse,
    BriefingRequest,
    BriefingResponse,
    CalibrationResponse,
    CrisisAppealRequest,
    CrisisAppealResponse,
    CrisisResponse,
    HotspotsResponse,
    PlanResponse,
    SavedPlan,
    SavedPlanIn,
    SensitivityResponse,
    ReservoirResponse,
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

@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/countries")
def countries():
    return {"countries": sorted(c["country"] for c in hotspots_mod.load_heatmap()["items"])}


@app.get("/api/hotspots", response_model=HotspotsResponse)
def hotspots():
    """Every country in data/processed/heatmap.json, highest number of cases first."""
    return hotspots_mod.load_heatmap()


@app.get("/api/calibration", response_model=CalibrationResponse)
def calibration():
    """General blood need per 1000 people, fitted to published national requirements,
    and how the calibrated model compares with each of them."""
    return reservoir_mod.calibrate_need()


@app.get("/api/crisis", response_model=CrisisResponse)
def crisis(
    country: str,
    people: int = Query(25, ge=1, le=crisis_mod.MAX_PEOPLE),
    days: int = Query(30, ge=1, le=crisis_mod.MAX_DAYS),
    seed: int | None = Query(None, ge=0, description="Fix to repeat a run; random if left out"),
    o_neg_fallback: bool = Query(False, description="Give O- when a patient's own group runs out"),
    crisis_first: bool = Query(False, description="Serve crisis patients before normal hospital use"),
):
    """Monte Carlo of `people` sickle cell crises in a `days`-long window, drawn from a
    100-patient pool for `country`: can the blood supply cover them?"""
    import secrets
    run_seed = seed if seed is not None else secrets.randbelow(2**31)
    try:
        return crisis_mod.simulate_crisis(
            country, people, days, run_seed, o_neg_fallback, crisis_first)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No data for country: {country}")


@app.post("/api/crisis-appeal", response_model=CrisisAppealResponse)
def crisis_appeal(req: CrisisAppealRequest):
    """A donor appeal (WhatsApp, SMS, email) from a crisis-simulator result. Gemini writes it
    when GEMINI_API_KEY is set; otherwise a template, so it always works."""
    return draft_crisis_appeal(req)


@app.get("/api/reservoir", response_model=ReservoirResponse)
def reservoir(
    country: str,
    share_in_care: float = Query(reservoir_mod.DEFAULT_SHARE_IN_CARE, ge=0, le=1),
):
    """Modelled days of red-cell stock per blood type for one country, against that
    country's reserve target, with donation rates per type and the SCD share of demand."""
    try:
        return reservoir_mod.compute_reservoir(country, share_in_care)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No data for country: {country}")


@app.get("/api/plan", response_model=PlanResponse)
def plan(
    country: str,
    share_in_care: float = Query(reservoir_mod.DEFAULT_SHARE_IN_CARE, ge=0, le=1),
    people: int = Query(25, ge=1, le=crisis_mod.MAX_PEOPLE),
    days: int = Query(30, ge=1, le=crisis_mod.MAX_DAYS),
    seed: int = Query(plan_mod.DEFAULT_SEED, ge=0, le=2**31 - 1,
                      description="Fixed by default so a shared link rebuilds the same plan"),
    deferral: float = Query(plan_mod.DEFAULT_DEFERRAL, ge=plan_mod.DEFERRAL_RANGE[0], le=plan_mod.DEFERRAL_RANGE[1]),
    donations_per_donor: float = Query(plan_mod.DEFAULT_DONATIONS_PER_DONOR,
                                       ge=plan_mod.DONATIONS_PER_DONOR_RANGE[0],
                                       le=plan_mod.DONATIONS_PER_DONOR_RANGE[1]),
    coverage: float = Query(plan_mod.DEFAULT_COVERAGE, ge=0, le=1),
    o_neg_fallback: bool = False,
    crisis_first: bool = False,
):
    """Drive plan for one country: which blood groups to push for, and how many donors to
    recruit, from the reservoir (everyday gap) and crisis (surge) models."""
    try:
        return plan_mod.build_plan(
            country, share_in_care, people, days, seed, deferral,
            donations_per_donor, coverage, o_neg_fallback, crisis_first)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No data for country: {country}")


@app.get("/api/backtest", response_model=BacktestResponse)
def backtest():
    """The case-trend method tested on the past: fit to data up to 2018, predict after."""
    return backtest_mod.backtest()


@app.get("/api/sensitivity", response_model=SensitivityResponse)
def sensitivity(
    country: str,
    people: int = Query(25, ge=1, le=crisis_mod.MAX_PEOPLE),
    days: int = Query(30, ge=1, le=crisis_mod.MAX_DAYS),
    deferral: float = Query(plan_mod.DEFAULT_DEFERRAL, ge=plan_mod.DEFERRAL_RANGE[0], le=plan_mod.DEFERRAL_RANGE[1]),
    donations_per_donor: float = Query(plan_mod.DEFAULT_DONATIONS_PER_DONOR,
                                       ge=plan_mod.DONATIONS_PER_DONOR_RANGE[0],
                                       le=plan_mod.DONATIONS_PER_DONOR_RANGE[1]),
    coverage: float = Query(plan_mod.DEFAULT_COVERAGE, ge=0, le=1),
):
    """Which assumption moves the regular-donor total most, for this country."""
    try:
        return plan_mod.sensitivity(country, people=people, days=days, deferral=deferral,
                                    donations_per_donor=donations_per_donor, coverage=coverage)
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No data for country: {country}")


@app.post("/api/appeal", response_model=AppealResponse)
def appeal(req: AppealRequest):
    """A donation appeal written from the drive plan's numbers (Gemini, with a template
    fallback). Text only: nothing is sent and no donor details are stored."""
    try:
        return appeal_mod.write_appeal(
            req.country, req.channel, req.tone, req.language, req.details.model_dump(),
            dict(people=req.people, days=req.days, deferral=req.deferral,
                 donations_per_donor=req.donations_per_donor, coverage=req.coverage,
                 o_neg_fallback=req.o_neg_fallback, crisis_first=req.crisis_first))
    except KeyError:
        raise HTTPException(status_code=404, detail=f"No data for country: {req.country}")


@app.get("/api/auth/config")
def auth_config():
    """Whether sign-in is set up on this server (the browser also needs its own Auth0 ids)."""
    return {"enabled": auth_mod.auth_config() is not None}


@app.get("/api/plans", response_model=list[SavedPlan])
def list_saved_plans(user: str = Depends(auth_mod.current_user)):
    return plans_store.list_plans(user)


@app.post("/api/plans", response_model=SavedPlan)
def save_plan(body: SavedPlanIn, user: str = Depends(auth_mod.current_user)):
    known = {c["country"] for c in hotspots_mod.load_heatmap()["items"]}
    if body.country not in known:
        raise HTTPException(status_code=404, detail=f"No data for country: {body.country}")
    query = plans_store.clean_query(body.query)
    if not query:
        raise HTTPException(status_code=422, detail="Nothing to save")
    try:
        return plans_store.add_plan(user, body.name.strip(), body.country, query)
    except ValueError:
        raise HTTPException(status_code=409, detail=f"You can keep up to {plans_store.MAX_PLANS_PER_USER} saved plans.")


@app.delete("/api/plans/{plan_id}")
def delete_saved_plan(plan_id: int, user: str = Depends(auth_mod.current_user)):
    if not plans_store.delete_plan(user, plan_id):
        raise HTTPException(status_code=404, detail="No such saved plan")
    return {"deleted": plan_id}


MONTHS = ("January", "February", "March", "April", "May", "June", "July", "August",
          "September", "October", "November", "December")


@app.post("/api/briefing", response_model=BriefingResponse)
def briefing(req: BriefingRequest):
    """Travel checklist for a charity team. Country and month are checked against known
    values because they go into a Gemini prompt."""
    known = {c["country"] for c in hotspots_mod.load_heatmap()["items"]}
    if req.country not in known:
        raise HTTPException(status_code=404, detail=f"No data for country: {req.country}")
    if req.month not in MONTHS:
        raise HTTPException(status_code=422, detail="month must be a calendar month name")
    return get_briefing(req.country, req.month)


# Serve the built frontend, if present, from the same container.
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR),
              html=True), name="static")
