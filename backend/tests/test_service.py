import asyncio
import json
from dataclasses import replace

import pytest

from app.briefing import RateLimiter, generate_briefing, fallback_sections
from app.config import Settings
from app.db import Store
from app.loaders import DataFileError
from app.schemas import BriefingRequest, PlanRequest, SimulateRequest, CountryRequest, FacilityRequest, SensitivityRequest
from app.service import AppState


@pytest.fixture(scope="module")
def app_state(sample_settings):
    return AppState(replace(sample_settings, mc_draws=2000))


def test_endpoints_are_json_serialisable(app_state):
    assert app_state.health()["status"] == "ok"
    assert app_state.health()["sample_data"] is True
    sim = app_state.simulate(SimulateRequest(source="lancet"))
    iso = sim["countries"][0]["iso3"]
    payloads = [
        app_state.meta(), app_state.parameters(), sim,
        app_state.admin1(CountryRequest(iso3=iso)),
        app_state.facilities(FacilityRequest(iso3=iso)),
        app_state.sensitivity(SensitivityRequest(iso3=[iso])),
        app_state.method(),
        app_state.plan(PlanRequest(iso3=iso, drives_per_month=4, partner_service="National Blood Transfusion Service",
                                   partner_confirmed_licensed=True)),
    ]
    for p in payloads:
        json.dumps(p)
        assert p.get("banner")  # sample banner travels with every payload


def test_overrides_change_results(app_state):
    a = app_state.simulate(SimulateRequest(source="lancet"))["totals"]["demand_units"]["p50"]
    b = app_state.simulate(SimulateRequest(source="lancet", overrides={"share_diagnosed": {"mean": 0.3}}))["totals"]["demand_units"]["p50"]
    assert b > a


def test_real_mode_without_files_fails_loudly(tmp_path, sample_settings):
    st = AppState(replace(sample_settings, data_mode="real", raw_dir=tmp_path))
    assert st.health()["status"] == "data_error"
    assert "How to get it" in st.health()["error"]
    with pytest.raises(DataFileError):
        st.simulate(SimulateRequest())


def test_briefing_falls_back_without_key(sample_settings):
    s = replace(sample_settings, gemini_api_key=None, gemini_model=None)
    b = asyncio.run(generate_briefing(s, BriefingRequest(iso3="NGA", month=7), Store("sqlite:///:memory:")))
    assert b.status == "FALLBACK"
    assert "unpaid" in b.disclaimer
    for items in b.sections.model_dump().values():
        assert items and all(i["verify_with"] and i["confidence"] in {"low", "medium", "high"} for i in items)


def test_fallback_has_no_payment_or_unlicensed_language():
    text = json.dumps(fallback_sections().model_dump()).lower()
    assert "pay donors" not in text and "outside licensed" not in text


def test_rate_limiter():
    rl = RateLimiter(2)
    assert rl.allow("a") and rl.allow("a") and not rl.allow("a")
    assert rl.allow("b")


def test_store_roundtrip():
    st = Store("sqlite:///:memory:")
    st.put_briefing("k", {"x": 1})
    assert st.get_briefing("k", 60) == {"x": 1}
    assert st.get_briefing("missing", 60) is None
    pid = st.save_plan({"iso3": "NGA", "partner_service": "NBTS", "admin1": None})
    assert pid >= 1 and st.list_plans()[0]["iso3"] == "NGA"
