"""FastAPI app. Run: uvicorn app.main:app --reload --port 8000 (from backend/)."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse

from .briefing import RateLimiter, generate_briefing
from .config import get_settings
from .db import Store
from .loaders import DataFileError
from .params import ParameterError
from .planner import PlanError
from .schemas import (BriefingRequest, CountryRequest, FacilityRequest, PlanRequest, SensitivityRequest,
                      SimulateRequest)
from .service import AppState

settings = get_settings()
state: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    state["app"] = AppState(settings)
    state["store"] = Store(settings.database_url)
    state["limiter"] = RateLimiter(settings.briefing_rate_per_min)
    yield


app = FastAPI(title="SickleSupply API", version="0.1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=[o for o in settings.cors_origins.split(",") if o],
                   allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(DataFileError)
async def _data_err(_: Request, e: DataFileError):
    return JSONResponse(status_code=503, content={"detail": str(e), "kind": "data_file"})


@app.exception_handler(PlanError)
@app.exception_handler(ParameterError)
@app.exception_handler(ValueError)
async def _bad_req(_: Request, e: Exception):
    return JSONResponse(status_code=400, content={"detail": str(e)})


def S() -> AppState:
    return state["app"]


@app.get("/api/health")
def health():
    return S().health()


@app.get("/api/meta")
def meta():
    return S().meta()


@app.get("/api/parameters")
def parameters():
    return S().parameters()


@app.post("/api/simulate")
def simulate(req: SimulateRequest):
    return S().simulate(req)


@app.post("/api/admin1")
def admin1(req: CountryRequest):
    return S().admin1(req)


@app.post("/api/facilities")
def facilities(req: FacilityRequest):
    return S().facilities(req)


@app.post("/api/sensitivity")
def sensitivity(req: SensitivityRequest):
    return S().sensitivity(req)


@app.post("/api/plan")
def plan(req: PlanRequest):
    p = S().plan(req)
    p["plan_id"] = state["store"].save_plan({k: v for k, v in p.items() if k != "assumptions"})
    return p


@app.post("/api/plan.csv", response_class=PlainTextResponse)
def plan_csv(req: PlanRequest):
    name = f"sicklesupply_plan_{req.iso3}{'_' + req.admin1 if req.admin1 else ''}_MODELLED.csv".replace(" ", "_")
    return PlainTextResponse(S().plan_csv(req), media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/plans")
def plans():
    return {"plans": state["store"].list_plans()}


@app.post("/api/briefing")
async def briefing(req: BriefingRequest, request: Request):
    client = request.client.host if request.client else "unknown"
    if not state["limiter"].allow(client):
        raise HTTPException(429, f"Too many briefing requests: limit is {settings.briefing_rate_per_min} per minute.")
    from .countries import SSA_COUNTRIES
    if req.iso3.upper() not in SSA_COUNTRIES:
        raise HTTPException(400, "Unknown country code")
    req = req.model_copy(update={"iso3": req.iso3.upper()})
    return (await generate_briefing(settings, req, state["store"])).model_dump()


@app.get("/api/method")
def method():
    return S().method()


@app.get("/api/geo/admin0")
def geo_admin0():
    return S().geo_admin0()
