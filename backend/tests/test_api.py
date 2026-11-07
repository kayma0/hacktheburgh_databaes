from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_countries():
    r = client.get("/api/countries")
    assert r.status_code == 200
    assert "Nigeria" in r.json()["countries"]


def test_simulate_percentile_ordering():
    r = client.post("/api/simulate", json={"country": "Nigeria"})
    assert r.status_code == 200
    body = r.json()
    for scenario in ("baseline", "universal_diagnosis_hydroxyurea"):
        p = body[scenario]["demand_units"]
        assert p["p10"] <= p["p50"] <= p["p90"]


def test_simulate_unknown_country():
    r = client.post("/api/simulate", json={"country": "Nowhere"})
    assert r.status_code == 404


def test_briefing_fallback_without_api_key(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    r = client.post("/api/briefing", json={"country": "Nigeria", "month": "March"})
    assert r.status_code == 200
    assert r.json()["fallback_used"] is True
