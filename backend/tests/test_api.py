from fastapi.testclient import TestClient

import pytest

from app.main import DATA, app

client = TestClient(app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


needs_model_data = pytest.mark.skipif(
    DATA is None, reason="legacy model data (data/raw/*.csv, parameters.yaml) not present")


def test_countries():
    r = client.get("/api/countries")
    assert r.status_code == 200
    assert "Nigeria" in r.json()["countries"]


@needs_model_data
def test_simulate_percentile_ordering():
    r = client.post("/api/simulate", json={"country": "Nigeria"})
    assert r.status_code == 200
    body = r.json()
    for scenario in ("baseline", "universal_diagnosis_hydroxyurea"):
        p = body[scenario]["demand_units"]
        assert p["p10"] <= p["p50"] <= p["p90"]


@needs_model_data
def test_simulate_unknown_country():
    r = client.post("/api/simulate", json={"country": "Nowhere"})
    assert r.status_code == 404


def test_briefing_fallback_without_api_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    r = client.post("/api/briefing", json={"country": "Nigeria", "month": "March"})
    assert r.status_code == 200
    assert r.json()["fallback_used"] is True


def test_hotspots_shape_and_ordering():
    r = client.get("/api/hotspots")
    assert r.status_code == 200
    body = r.json()
    assert body["data_year"] == 2023
    items = body["items"]
    assert len(items) == 54
    assert items[0]["country"] == "Nigeria" and items[0]["heat"] == 1.0
    assert [i["heat"] for i in items] == sorted((i["heat"] for i in items), reverse=True)
    for it in items:
        p = it["cases_now"]
        assert p["p10"] <= p["p50"] <= p["p90"]
