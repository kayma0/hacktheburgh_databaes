"""HTTP-level smoke tests. Skipped automatically if FastAPI / httpx are not installed."""
import os

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")


@pytest.fixture(scope="module")
def client(sample_settings):
    os.environ["MC_DRAWS"] = "2000"
    from fastapi.testclient import TestClient
    from app.main import app
    with TestClient(app) as c:
        yield c


def test_health_and_meta(client):
    assert client.get("/api/health").json()["status"] == "ok"
    assert client.get("/api/meta").json()["sample_data"] is True


def test_simulate_plan_csv_briefing(client):
    sim = client.post("/api/simulate", json={"source": "lancet"}).json()
    iso = sim["countries"][0]["iso3"]
    body = {"iso3": iso, "drives_per_month": 4, "partner_service": "National Blood Transfusion Service",
            "partner_confirmed_licensed": True}
    assert client.post("/api/plan", json=body).status_code == 200
    csv = client.post("/api/plan.csv", json=body)
    assert csv.status_code == 200 and "MODELLED ESTIMATE" in csv.text
    bad = client.post("/api/plan", json={**body, "partner_confirmed_licensed": False})
    assert bad.status_code == 400
    b = client.post("/api/briefing", json={"iso3": iso, "month": 3}).json()
    assert b["status"] in {"FALLBACK", "UNGROUNDED", "GROUNDED"}


def test_bad_override_is_400(client):
    r = client.post("/api/simulate", json={"overrides": {"share_diagnosed": {"mean": 2}}})
    assert r.status_code == 400
