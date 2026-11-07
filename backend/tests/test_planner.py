import pytest

from app import montecarlo as M
from app.planner import PlanError, plan_drives, plan_to_csv


@pytest.fixture(scope="module")
def sim(ds, params):
    return M.simulate(ds, params, "lancet", n=3000, seed=11)


def _plan(sim, ds, params, **kw):
    args = dict(iso3=sim.iso3[0], admin1=None, drives_per_month=4, donors_per_drive=60, horizon_months=12,
                partner_service="National Blood Transfusion Service", partner_confirmed_licensed=True)
    args.update(kw)
    return plan_drives(sim, ds, params, **args)


def test_requires_named_licensed_partner(sim, ds, params):
    with pytest.raises(PlanError, match="licensed"):
        _plan(sim, ds, params, partner_service="")
    with pytest.raises(PlanError, match="licensed"):
        _plan(sim, ds, params, partner_confirmed_licensed=False)


def test_more_capacity_more_likely(sim, ds, params):
    big = max(range(len(sim.iso3)), key=lambda i: sim.draws["donors_needed"][i].mean())
    iso = sim.iso3[big]
    lo = _plan(sim, ds, params, iso3=iso, drives_per_month=0.5)["probability_reaching_target"]
    hi = _plan(sim, ds, params, iso3=iso, drives_per_month=5000)["probability_reaching_target"]
    assert 0 <= lo <= hi <= 1
    assert hi > lo


def test_plan_outputs_and_csv(sim, ds, params):
    p = _plan(sim, ds, params, donors_per_drive=None, horizon_months=6)
    assert len(p["timeline"]) == 6
    assert p["donors_per_drive_basis"].startswith("ASSUMPTION")
    assert p["label"] == "MODELLED ESTIMATE"
    q = p["drives_needed_in_horizon"]
    assert q["p10"] <= q["p50"] <= q["p90"]
    csv = plan_to_csv(p, is_sample=True)
    assert "MODELLED ESTIMATE" in csv and "SAMPLE DATA" in csv and "unpaid" in csv


def test_admin1_plan_is_smaller_than_country(sim, ds, params):
    iso = sim.iso3[0]
    region = ds.admin1_shares[ds.admin1_shares["iso3"] == iso]["admin1"].iloc[0]
    whole = _plan(sim, ds, params)["donors_needed_in_horizon"]["p50"]
    part = _plan(sim, ds, params, admin1=region)["donors_needed_in_horizon"]["p50"]
    assert part < whole
