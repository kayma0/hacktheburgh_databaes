import numpy as np
import pytest

from app import montecarlo as M
from app.params import ParameterError, apply_overrides

N = 4000


def p50_total(ds, params, metric="demand_units", seed=7, **kw):
    sim = M.simulate(ds, params, "lancet", n=N, seed=seed, **kw)
    return M.totals(sim)[metric]["p50"]


def test_seeded_reproducibility(ds, params):
    a = M.simulate(ds, params, "lancet", n=N, seed=42)
    b = M.simulate(ds, params, "lancet", n=N, seed=42)
    c = M.simulate(ds, params, "lancet", n=N, seed=43)
    for k in a.draws:
        np.testing.assert_array_equal(a.draws[k], b.draws[k])
    assert not np.array_equal(a.draws["demand_units"], c.draws["demand_units"])


def test_interval_ordering(ds, params):
    sim = M.simulate(ds, params, "gbd", n=N, seed=1)
    for row in M.summarise(sim, ds):
        for m in sim.draws:
            q = row[m]
            assert q["p10"] <= q["p50"] <= q["p90"], (row["iso3"], m)
    for m, q in M.totals(sim).items():
        assert q["p10"] <= q["p50"] <= q["p90"], m


@pytest.mark.parametrize("name,field,lo,hi,direction", [
    ("share_diagnosed", "mean", 0.05, 0.30, +1),
    ("share_on_hydroxyurea", "mean", 0.01, 0.50, -1),
    ("units_per_event", "mode", 0.8, 1.8, +1),
])
def test_monotonicity_demand(ds, params, name, field, lo, hi, direction):
    a = p50_total(ds, apply_overrides(params, {name: {field: lo}}))
    b = p50_total(ds, apply_overrides(params, {name: {field: hi}}))
    assert (b - a) * direction > 0


def test_deferral_increases_donors(ds, params):
    a = p50_total(ds, apply_overrides(params, {"donor_deferral_rate": {"mode": 0.12}}), "donors_needed")
    b = p50_total(ds, apply_overrides(params, {"donor_deferral_rate": {"mode": 0.33}}), "donors_needed")
    assert b > a


def test_target_coverage_scales_gap(ds, params):
    a = p50_total(ds, apply_overrides(params, {"target_coverage": {"value": 0.2}}), "gap_units")
    b = p50_total(ds, apply_overrides(params, {"target_coverage": {"value": 0.4}}), "gap_units")
    assert b == pytest.approx(2 * a, rel=1e-9)


def test_units_avoided_non_negative_and_consistent(ds, params):
    sim = M.simulate(ds, params, "lancet", n=N, seed=3)
    assert (sim.draws["units_avoided_by_hu"] >= 0).all()
    np.testing.assert_allclose(sim.draws["universal_no_hu_demand_units"] - sim.draws["universal_demand_units"],
                               sim.draws["units_avoided_by_hu"])
    # universal diagnosis without HU can never be below baseline demand
    assert (sim.draws["universal_no_hu_demand_units"] >= sim.draws["demand_units"] - 1e-9).all()


def test_rank_stability_bounds(ds, params):
    sim = M.simulate(ds, params, "lancet", n=N, seed=5)
    rows = M.summarise(sim, ds, top_k=10)
    probs = [r["p_top_k"] for r in rows]
    assert all(0 <= p <= 1 for p in probs)
    assert sum(probs) == pytest.approx(10.0)          # exactly 10 countries are in the top 10 in every draw
    assert [r["rank"] for r in rows] == list(range(1, len(rows) + 1))


def test_admin1_shares_sum_to_country(ds, params):
    sim = M.simulate(ds, params, "lancet", n=N, seed=9)
    iso = sim.iso3[0]
    br = M.admin1_breakdown(sim, ds, iso)
    assert sum(r["share"] for r in br["regions"]) == pytest.approx(1.0)
    assert "ASSUMPTION" in br["note"]


def test_sensitivity_sorted_and_contains_assumptions(ds, params):
    s = M.sensitivity(ds, params, "lancet")
    swings = [b["swing"] for b in s["bars"]]
    assert swings == sorted(swings, reverse=True)
    assert {b["input"] for b in s["bars"]} == set(M.SENS_INPUTS)
    for b in s["bars"]:
        assert min(b["output_at_p10_input"], b["output_at_p90_input"]) <= s["baseline"] * (1 + 1e-9)


def test_bad_overrides_rejected(params):
    with pytest.raises(ParameterError):
        apply_overrides(params, {"not_a_param": {"value": 1}})
    with pytest.raises(ParameterError):
        apply_overrides(params, {"share_diagnosed": {"mean": 1.5}})
    with pytest.raises(ParameterError):
        apply_overrides(params, {"units_per_event": {"label": 3}})


def test_unknown_source(ds, params):
    with pytest.raises(ValueError):
        M.simulate(ds, params, "nope", n=10)
