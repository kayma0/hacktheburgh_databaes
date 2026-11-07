"""Monte Carlo model of SCD blood demand for one country.

Every output is modelled, not observed: see docs/METHOD.md for sources.
"""
from __future__ import annotations

import numpy as np

N_DRAWS = 10_000
SEED = 20261107


def _lognormal_from_p50_ci(p50: float, p2_5: float, p97_5: float, n: int, rng: np.random.Generator) -> np.ndarray:
    mu = np.log(p50)
    sigma = (np.log(p97_5) - np.log(p2_5)) / (2 * 1.959964)
    return rng.lognormal(mean=mu, sigma=sigma, size=n)


def _percentiles(x: np.ndarray) -> dict:
    p10, p50, p90 = np.percentile(x, [10, 50, 90])
    return {"p10": float(p10), "p50": float(p50), "p90": float(p90)}


def run_simulation(
    burden_row: dict,
    collections_per_year: float,
    params: dict,
    share_diagnosed: float,
    share_on_hydroxyurea: float,
    units_per_event: float,
    donor_deferral_rate: float,
    target_coverage: float,
) -> dict:
    rng = np.random.default_rng(SEED)
    n = N_DRAWS

    affected_children = _lognormal_from_p50_ci(
        burden_row["affected_children_p50"], burden_row["p2_5"], burden_row["p97_5"], n, rng
    )
    diagnosed_children = affected_children * share_diagnosed

    rate_untreated = params["events_per_100py_untreated"]
    rate_treated = params["events_per_100py_hydroxyurea"]
    events_untreated = rng.triangular(rate_untreated["min"], rate_untreated["mode"], rate_untreated["max"], n) / 100
    events_treated = rng.triangular(rate_treated["min"], rate_treated["mode"], rate_treated["max"], n) / 100
    units = rng.triangular(
        params["units_per_event"]["min"], units_per_event, params["units_per_event"]["max"], n
    )
    deferral = rng.triangular(
        params["donor_deferral_rate"]["min"], donor_deferral_rate, params["donor_deferral_rate"]["max"], n
    )

    def demand_for(diagnosed: np.ndarray, hu_share: float) -> np.ndarray:
        on_hu = diagnosed * hu_share
        off_hu = diagnosed * (1 - hu_share)
        events = on_hu * events_treated + off_hu * events_untreated
        return events * units

    demand_baseline = demand_for(diagnosed_children, hu_share=0.0)
    # Scenario: everyone affected gets diagnosed, then the hydroxyurea slider share is treated.
    demand_scenario = demand_for(affected_children, hu_share=share_on_hydroxyurea)

    donors_baseline = demand_baseline * target_coverage / (1 - deferral)
    donors_scenario = demand_scenario * target_coverage / (1 - deferral)

    pct_baseline = demand_baseline / collections_per_year * 100
    pct_scenario = demand_scenario / collections_per_year * 100

    units_avoided = demand_baseline - demand_scenario

    return {
        "baseline": {
            "demand_units": _percentiles(demand_baseline),
            "donors_needed": _percentiles(donors_baseline),
            "demand_pct_of_collections": _percentiles(pct_baseline),
        },
        "universal_diagnosis_hydroxyurea": {
            "demand_units": _percentiles(demand_scenario),
            "donors_needed": _percentiles(donors_scenario),
            "demand_pct_of_collections": _percentiles(pct_scenario),
        },
        "units_avoided": _percentiles(units_avoided),
    }
