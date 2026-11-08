from __future__ import annotations

import logging
import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import auth as auth_mod
from . import backtest as backtest_mod
from . import charities
from . import crisis as crisis_mod
from . import db, donors
from . import hotspots as hotspots_mod
from . import plan as plan_mod
from . import plans_store
from . import reservoir as reservoir_mod
from .appeal import draft_appeal
from .briefing import get_briefing
from .charities import current_charity
from .schemas import (
    ActivityResponse,
    AppealRequest,
    AppealResponse,
    BacktestResponse,
    BriefingRequest,
    BriefingResponse,
    CalibrationResponse,
    Charity,
    CharityIn,
    CrisisResponse,
    Donor,
    DonorGroupMatch,
    DonorIn,
    DonorMatchRequest,
    DonorMatchResponse,
    HotspotsResponse,
    MatchedDonor,
    OutreachIn,
    PlanResponse,
    ReservoirResponse,
    SavedPlan,
    SavedPlanIn,
    SensitivityResponse,
)

load_dotenv()

# So the "gemini" / "template" line each Gemini-backed feature logs reaches the terminal.
logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_: FastAPI):
    yield
    db.close()


app = FastAPI(title="SickleSignal API", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

# Query parameters shared by the drive plan and its sensitivity check.
People = Query(25, ge=1, le=crisis_mod.MAX_PEOPLE)
Days = Query(30, ge=1, le=crisis_mod.MAX_DAYS)
Deferral = Query(plan_mod.DEFAULT_DEFERRAL, ge=plan_mod.DEFERRAL_RANGE[0], le=plan_mod.DEFERRAL_RANGE[1])
DonationsPerDonor = Query(plan_mod.DEFAULT_DONATIONS_PER_DONOR,
                          ge=plan_mod.DONATIONS_PER_DONOR_RANGE[0],
                          le=plan_mod.DONATIONS_PER_DONOR_RANGE[1])
Coverage = Query(plan_mod.DEFAULT_COVERAGE, ge=0, le=1)


def _not_found(country: str) -> HTTPException:
    return HTTPException(status_code=404, detail=f"No data for country: {country}")


def _known_countries() -> set[str]:
    return {c["country"] for c in hotspots_mod.load_heatmap()["items"]}


@app.get("/api/health")
def health():
    return {"status": "ok", "donor_database": db.is_configured()}


@app.get("/api/countries")
def countries():
    return {"countries": sorted(_known_countries())}


@app.get("/api/hotspots", response_model=HotspotsResponse)
def hotspots():
    """Every country in data/processed/heatmap.json, highest number of cases first."""
    return hotspots_mod.load_heatmap()


@app.get("/api/calibration", response_model=CalibrationResponse)
def calibration():
    """General blood need per 1000 people, fitted to published national requirements,
    and how the calibrated model compares with each of them."""
    return reservoir_mod.calibrate_need()


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
        raise _not_found(country)


@app.get("/api/crisis", response_model=CrisisResponse)
def crisis(
    country: str,
    people: int = People,
    days: int = Days,
    seed: int | None = Query(None, ge=0, le=2**31 - 1, description="Fix to repeat a run; random if left out"),
    o_neg_fallback: bool = Query(False, description="Give O- when a patient's own group runs out"),
):
    """Monte Carlo of `people` sickle cell crises in a `days`-long window, drawn from a
    100-patient pool for `country`: can the blood supply cover them?"""
    run_seed = seed if seed is not None else secrets.randbelow(2**31)
    try:
        return crisis_mod.simulate_crisis(country, people, days, run_seed, o_neg_fallback)
    except KeyError:
        raise _not_found(country)


@app.get("/api/plan", response_model=PlanResponse)
def plan(
    country: str,
    share_in_care: float = Query(reservoir_mod.DEFAULT_SHARE_IN_CARE, ge=0, le=1),
    people: int = People,
    days: int = Days,
    seed: int = Query(plan_mod.DEFAULT_SEED, ge=0, le=2**31 - 1,
                      description="The crisis run's seed, so the plan matches it and a link rebuilds it"),
    deferral: float = Deferral,
    donations_per_donor: float = DonationsPerDonor,
    coverage: float = Coverage,
    o_neg_fallback: bool = False,
):
    """Drive plan for one country: which blood groups to push for, and how many donors to
    recruit, from the reservoir (everyday gap) and crisis (surge) models."""
    try:
        return plan_mod.build_plan(country, share_in_care, people, days, seed, deferral,
                                   donations_per_donor, coverage, o_neg_fallback)
    except KeyError:
        raise _not_found(country)


@app.get("/api/backtest", response_model=BacktestResponse)
def backtest():
    """The case-trend method tested on the past: fit to data up to 2018, predict after."""
    return backtest_mod.backtest()


@app.get("/api/sensitivity", response_model=SensitivityResponse)
def sensitivity(
    country: str,
    people: int = People,
    days: int = Days,
    deferral: float = Deferral,
    donations_per_donor: float = DonationsPerDonor,
    coverage: float = Coverage,
):
    """Which assumption moves the regular-donor total most, for this country."""
    try:
        return plan_mod.sensitivity(country, people=people, days=days, deferral=deferral,
                                    donations_per_donor=donations_per_donor, coverage=coverage)
    except KeyError:
        raise _not_found(country)


@app.post("/api/appeal", response_model=AppealResponse)
def appeal(req: AppealRequest):
    """An urgent donor appeal (WhatsApp, SMS, email) from a crisis-simulator result. Gemini
    writes it when GEMINI_API_KEY is set; otherwise a template, so it always works."""
    return draft_appeal(req)


@app.post("/api/briefing", response_model=BriefingResponse)
def briefing(req: BriefingRequest):
    """Trip checklist for a charity team, written for one country and opening with what the
    UK government currently says about it. The country is checked against known values
    because it goes into a Gemini prompt."""
    if req.country not in _known_countries():
        raise _not_found(req.country)
    return get_briefing(req.country)


# ───────────── charity data (Postgres on Tiger Data; needs DATABASE_URL) ─────────────
# Auth0 says who is asking (charities.current_charity); each charity's donors, outreach and
# saved plans live in the database under its id.

Charity_ = Depends(current_charity)


def _need_db() -> None:
    if not db.is_configured():
        raise HTTPException(status_code=503, detail="No database: set DATABASE_URL in .env")


@app.get("/api/auth/config")
def auth_config():
    """Whether sign-in is set up on this server (the browser also needs its own Auth0 ids)."""
    return {"enabled": auth_mod.auth_config() is not None}


@app.put("/api/me", response_model=Charity)
def update_me(body: CharityIn, charity: str = Charity_):
    """Record the signed-in charity's name (shown by Auth0 at sign-in)."""
    _need_db()
    charities.touch(charity, body.name.strip())
    return Charity(id=charity, name=body.name.strip())


@app.post("/api/donors/match", response_model=DonorMatchResponse)
def match_donors(req: DonorMatchRequest, charity: str = Charity_):
    """This charity's donors (and the shared demo donors) for each blood group in the plan,
    with whether each can give now and their reply so far."""
    if not db.is_configured():
        return DonorMatchResponse(connected=False)
    wanted = {g: n for g, n in req.donors.items() if n > 0}
    rows = donors.match(charity, req.country, list(wanted))
    groups = []
    for group, needed in wanted.items():
        mine = [r for r in rows if r["blood_group"] == group]
        counts = mine[0] if mine else {"on_file": 0, "eligible": 0, "pledged": 0}
        groups.append(DonorGroupMatch(
            blood_group=group,
            needed=needed,
            deadline=req.deadlines.get(group, ""),
            on_file=counts["on_file"],
            eligible=counts["eligible"],
            pledged=counts["pledged"],
            donors=[MatchedDonor(**r) for r in mine],
        ))
    return DonorMatchResponse(
        connected=True, registered=donors.registered(charity, req.country), groups=groups)


@app.post("/api/donors", response_model=Donor, status_code=201)
def register_donor(donor: DonorIn, charity: str = Charity_):
    """Add a donor who has agreed to be contacted, to this charity's list."""
    _need_db()
    return donors.register(charity, donor)


@app.post("/api/outreach")
def log_outreach(event: OutreachIn, charity: str = Charity_):
    """Record that donors were contacted (one, or a whole blood group at once), or a reply
    (pledged / declined)."""
    _need_db()
    logged = donors.record_outreach(charity, event.donor_ids, event.status, event.channel)
    if not logged:
        raise HTTPException(status_code=404, detail="No such donors")
    return {"logged": logged}


@app.get("/api/outreach/activity", response_model=ActivityResponse)
def outreach_activity(country: str, days: int = Query(7, ge=1, le=90), charity: str = Charity_):
    """This charity's messages and replies in `country` per day (time_bucket on Tiger Data)."""
    if not db.is_configured():
        return ActivityResponse(connected=False, days=days)
    by_day = donors.activity(charity, country, days)
    totals = {k: sum(d[k] for d in by_day) for k in ("contacted", "pledged", "declined")}
    return ActivityResponse(connected=True, days=days, by_day=by_day, **totals)


@app.get("/api/plans", response_model=list[SavedPlan])
def list_saved_plans(charity: str = Charity_):
    _need_db()
    return plans_store.list_plans(charity)


@app.post("/api/plans", response_model=SavedPlan)
def save_plan(body: SavedPlanIn, charity: str = Charity_):
    _need_db()
    if body.country not in _known_countries():
        raise _not_found(body.country)
    query = plans_store.clean_query(body.query)
    if not query:
        raise HTTPException(status_code=422, detail="Nothing to save")
    try:
        return plans_store.add_plan(charity, body.name.strip(), body.country, query)
    except ValueError:
        raise HTTPException(status_code=409,
                            detail=f"You can keep up to {plans_store.MAX_PLANS_PER_CHARITY} saved plans.")


@app.delete("/api/plans/{plan_id}")
def delete_saved_plan(plan_id: int, charity: str = Charity_):
    _need_db()
    if not plans_store.delete_plan(charity, plan_id):
        raise HTTPException(status_code=404, detail="No such saved plan")
    return {"deleted": plan_id}


# Serve the built frontend, if present, from the same container.
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
