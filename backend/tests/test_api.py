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


def test_hotspots_from_processed_heatmap():
    r = client.get("/api/hotspots")
    assert r.status_code == 200
    body = r.json()
    assert body["year"] == 2026 and body["data_year"] == 2023
    assert [b["label"] for b in body["buckets"]] == [
        "very low", "low", "moderate", "high", "very high"]
    items = body["items"]
    assert len(items) == 54
    assert items[0]["country"] == "Nigeria" and items[0]["intensity"] == 1.0
    assert [i["cases"] for i in items] == sorted((i["cases"] for i in items), reverse=True)
    for it in items:
        assert it["cases_low"] <= it["cases"] <= it["cases_high"]
        assert 0 <= it["intensity"] <= 1


BLOOD_TYPES = ["O+", "A+", "B+", "AB+", "O-", "A-", "B-", "AB-"]


def test_blood_supply_covers_every_hotspot_country():
    from app.hotspots import load_series
    from app.reservoir import load_supply

    supply = load_supply()
    assert set(supply) == set(load_series())
    for s in supply.values():
        assert abs(sum(s.shares.values()) - 1) < 1e-3
        assert s.reserve_target_days > 0 and s.whole_blood_donations > 0


def test_reservoir_shape_and_bounds():
    r = client.get("/api/reservoir", params={"country": "Nigeria"})
    assert r.status_code == 200
    body = r.json()
    assert [t["blood_type"] for t in body["types"]] == BLOOD_TYPES
    assert body["target_days"] == 6.0 and body["target_is_assumption"]
    for t in body["types"]:
        assert 0 <= t["fill"] <= 1
        for k in ("days", "donated_per_day", "demand_per_day", "extra_donations_per_day"):
            p = t[k]
            assert p["p10"] <= p["p50"] <= p["p90"]
        assert t["days"]["p90"] <= body["target_days"] + 1e-9
    assert 0 < body["scd_share_of_demand"]["p50"] < 1


def test_reservoir_uses_country_policy():
    za = client.get("/api/reservoir", params={"country": "South Africa"}).json()
    assert za["target_days"] == 5.0 and not za["target_is_assumption"]


def test_reservoir_more_care_means_more_scd_demand():
    lo = client.get("/api/reservoir", params={"country": "Ghana", "share_in_care": 0.1}).json()
    hi = client.get("/api/reservoir", params={"country": "Ghana", "share_in_care": 0.9}).json()
    assert hi["scd_demand_per_day"]["p50"] > lo["scd_demand_per_day"]["p50"]


def test_need_is_calibrated_to_national_figures():
    body = client.get("/api/calibration").json()
    need = body["need_per_1000"]
    assert need["min"] <= need["mode"] <= need["max"]
    assert {r["country"] for r in body["rows"]} >= {"Ghana", "Nigeria", "Kenya"}
    for r in body["rows"]:
        # Every published requirement sits inside the calibrated model's full range.
        assert need["min"] - 1e-9 <= r["implied_need_per_1000"] <= need["max"] + 1e-9
        lo = r["population"] * need["min"] / 1000 + r["scd_units"]
        hi = r["population"] * need["max"] / 1000 + r["scd_units"]
        assert lo - 1 <= r["requirement_units"] <= hi + 1
    # The reservoir uses the same calibrated range.
    res = client.get("/api/reservoir", params={"country": "Ghana"}).json()
    assert res["need_per_1000"] == need


def test_crisis_shape_and_consistency():
    r = client.get("/api/crisis", params={"country": "Ghana", "people": 25, "days": 30, "seed": 7})
    assert r.status_code == 200
    b = r.json()
    assert b["people"] == 25 and b["days"] == 30 and b["seed"] == 7
    assert len(b["pool"]) == 100 and len(b["example"]) == 25
    assert sum(b["example_counts"].values()) == 25
    assert {p["id"] for p in b["example"]} <= {p["id"] for p in b["pool"]}
    assert all(0 <= p["day"] <= 30 and p["units"] > 0 for p in b["example"])
    assert b["verdict"] in {"enough", "at_risk", "not_enough"}
    assert [g["blood_group"] for g in b["by_group"]] == BLOOD_TYPES
    for g in b["by_group"]:
        assert 0 <= g["p_short"] <= 1
        assert g["units_short"]["p50"] <= g["units_needed"]["p90"] + 1e-9
    # Same seed, same answer.
    again = client.get("/api/crisis", params={"country": "Ghana", "people": 25, "days": 30, "seed": 7}).json()
    assert again["p_all_served"] == b["p_all_served"] and again["pool"] == b["pool"]


def test_crisis_supply_matters():
    # Same crisis: a country that collects far more blood per person copes better.
    za = client.get("/api/crisis", params={"country": "South Africa", "people": 10, "days": 7, "seed": 1}).json()
    ng = client.get("/api/crisis", params={"country": "Nigeria", "people": 10, "days": 7, "seed": 1}).json()
    assert za["p_all_served"] > ng["p_all_served"]
    assert ng["verdict"] == "not_enough"


def test_crisis_options_only_ever_help_crisis_patients():
    q = {"country": "Ghana", "people": 30, "days": 30, "seed": 3}
    base = client.get("/api/crisis", params=q).json()
    oneg = client.get("/api/crisis", params={**q, "o_neg_fallback": True}).json()
    first = client.get("/api/crisis", params={**q, "crisis_first": True}).json()
    assert oneg["o_neg_fallback"] and first["crisis_first"]
    assert base["o_neg_given_units"]["p90"] == 0 and base["routine_displaced_units"]["p90"] == 0
    # Same seed, same pool and picks: an extra source of blood can't serve fewer people.
    assert oneg["patients_unserved"]["p50"] <= base["patients_unserved"]["p50"]
    assert first["patients_unserved"]["p50"] <= base["patients_unserved"]["p50"]
    assert first["p_all_served"] >= base["p_all_served"]
    assert first["routine_displaced_units"]["p50"] > 0


def test_crisis_rejects_out_of_range():
    assert client.get("/api/crisis", params={"country": "Ghana", "people": 51}).status_code == 422
    assert client.get("/api/crisis", params={"country": "Ghana", "days": 366}).status_code == 422
    assert client.get("/api/crisis", params={"country": "Nowhere"}).status_code == 404


def test_trends_projection_is_anchored_and_bounded():
    from app.trends import DONATION_SLOPE_CAP, donation_trend, project_age_sex

    ng = donation_trend("Nigeria")
    assert ng["years"][-1] == 2024 and abs(ng["slope"]) <= DONATION_SLOPE_CAP
    assert donation_trend("Djibouti")["fallback"] is True
    proj = project_age_sex("Nigeria")
    assert abs(sum(proj["shares"].values()) - 1) < 1e-9 and proj["people_now"] > 0


def test_reservoir_unknown_country():
    assert client.get("/api/reservoir", params={"country": "Nowhere"}).status_code == 404
