"""Monte Carlo model of SCD blood demand and blood-stock stress for one country.

Every output is modelled, not observed: see docs/METHOD.md for sources.
"""
from __future__ import annotations

import numpy as np

N_DRAWS = 10_000
SEED = 20261107

BLOOD_TYPES = ["O+", "A+", "B+", "AB+", "O-", "A-", "B-", "AB-"]

# ASSUMPTION: rough sub-Saharan Africa ABO/RhD donor mix (RhD-negative is rare).
# Override per project with `blood_type_shares` in parameters.yaml.
DEFAULT_BLOOD_TYPE_SHARES = {
    "O+": 0.46, "A+": 0.23, "B+": 0.21, "AB+": 0.04,
    "O-": 0.03, "A-": 0.015, "B-": 0.012, "AB-": 0.003,
}
# ASSUMPTION: how hard each group is pulled relative to its donor share.
# O- is the emergency "universal" red-cell group; AB is rarely requested.
# Override with `blood_type_demand_weights` in parameters.yaml.
DEFAULT_DEMAND_WEIGHTS = {
    "O+": 1.1, "A+": 0.95, "B+": 0.95, "AB+": 0.7,
    "O-": 2.2, "A-": 1.0, "B-": 1.0, "AB-": 0.6,
}
DEFAULT_TARGET_STOCK_DAYS = 6.0

# ASSUMPTION: red-cell units per crisis transfusion by age. Children are dosed by
# weight (~10-15 mL/kg; one adult unit is ~250-300 mL), so a toddler needs a
# fraction of a unit and an adult 2-3. Exchange transfusions can need far more.
# Override with `units_per_crisis_by_age` in parameters.yaml.
AGE_BANDS = ["under_5", "age_5_14", "age_15_24", "age_25_plus"]
DEFAULT_UNITS_BY_AGE = {
    "under_5": {"min": 0.3, "mode": 0.6, "max": 1.0},
    "age_5_14": {"min": 0.8, "mode": 1.3, "max": 2.2},
    "age_15_24": {"min": 1.5, "mode": 2.2, "max": 3.5},
    "age_25_plus": {"min": 1.5, "mode": 2.5, "max": 4.0},
}
# ASSUMPTION: day-to-day variability in hospital red-cell usage (lognormal sigma).
DEMAND_NOISE_SIGMA = 0.15


def _lognormal_from_p50_ci(p50: float, p2_5: float, p97_5: float, n: int, rng: np.random.Generator) -> np.ndarray:
    p50 = max(float(p50), 1e-9)
    p2_5 = max(float(p2_5), 1e-9)
    p97_5 = max(float(p97_5), p2_5 * 1.0001)
    mu = np.log(p50)
    sigma = (np.log(p97_5) - np.log(p2_5)) / (2 * 1.959964)
    return rng.lognormal(mean=mu, sigma=sigma, size=n)


def _tri(rng: np.random.Generator, lo: float, mode: float, hi: float, n: int) -> np.ndarray:
    """Triangular draw that never crashes on a slider value outside [lo, hi]."""
    lo, hi = min(lo, hi), max(lo, hi)
    mode = min(max(mode, lo), hi)
    if hi - lo < 1e-12:
        return np.full(n, float(mode))
    return rng.triangular(lo, mode, hi, n)


def _percentiles(x: np.ndarray) -> dict:
    p10, p50, p90 = np.percentile(x, [10, 50, 90])
    return {"p10": float(p10), "p50": float(p50), "p90": float(p90)}


def _blood_stock(
    collections_per_year: float,
    params: dict,
    crisis_total: np.ndarray,
    deferral: np.ndarray,
    stock_days_on_hand: float,
    rng: np.random.Generator,
    n: int,
) -> tuple[list[dict], float]:
    supply_raw = params.get("blood_type_shares") or DEFAULT_BLOOD_TYPE_SHARES
    weights = params.get("blood_type_demand_weights") or DEFAULT_DEMAND_WEIGHTS
    target = float(params.get("target_stock_days", DEFAULT_TARGET_STOCK_DAYS))

    s_total = sum(float(supply_raw[t]) for t in BLOOD_TYPES)
    supply = {t: float(supply_raw[t]) / s_total for t in BLOOD_TYPES}
    d_raw = {t: supply[t] * float(weights.get(t, 1.0)) for t in BLOOD_TYPES}
    d_total = sum(d_raw.values())
    demand = {t: d_raw[t] / d_total for t in BLOOD_TYPES}

    daily_collections = collections_per_year / 365.0
    usage_noise = rng.lognormal(0.0, DEMAND_NOISE_SIGMA, n)

    out = []
    for t in BLOOD_TYPES:
        on_hand = stock_days_on_hand * daily_collections * supply[t]
        mean_usage = daily_collections * demand[t]
        daily_usage = np.maximum(mean_usage * usage_noise, 1e-9)
        crisis_units = crisis_total * demand[t]
        remaining = np.maximum(on_hand - crisis_units, 0.0)
        days = remaining / daily_usage
        shortfall = np.maximum(target * daily_usage - remaining, 0.0)
        donors = shortfall / (1 - deferral)

        p50_days = float(np.median(days))
        status = "ok" if p50_days >= target else (
            "low" if p50_days >= target / 2 else "critical")
        out.append({
            "blood_type": t,
            "supply_share": supply[t],
            "demand_share": demand[t],
            "units_on_hand": float(on_hand),
            "target_units": float(target * mean_usage),
            "units_after_crisis": _percentiles(remaining),
            "days_of_cover": _percentiles(days),
            "crisis_units": _percentiles(crisis_units),
            "shortfall_units": _percentiles(shortfall),
            "donors_to_target": _percentiles(donors),
            "status": status,
        })
    return out, target


def run_simulation(
    burden_row: dict,
    collections_per_year: float,
    params: dict,
    share_diagnosed: float,
    share_on_hydroxyurea: float,
    units_per_event: float,
    donor_deferral_rate: float,
    target_coverage: float,
    crisis_patients: int = 0,
    stock_days_on_hand: float = 5.0,
    crisis_by_age: dict[str, int] | None = None,
) -> dict:
    rng = np.random.default_rng(SEED)
    n = N_DRAWS

    affected_children = _lognormal_from_p50_ci(
        burden_row["affected_children_p50"], burden_row["p2_5"], burden_row["p97_5"], n, rng
    )
    diagnosed_children = affected_children * share_diagnosed

    rate_untreated = params["events_per_100py_untreated"]
    rate_treated = params["events_per_100py_hydroxyurea"]
    events_untreated = _tri(
        rng, rate_untreated["min"], rate_untreated["mode"], rate_untreated["max"], n) / 100
    events_treated = _tri(
        rng, rate_treated["min"], rate_treated["mode"], rate_treated["max"], n) / 100
    units = _tri(rng, params["units_per_event"]["min"],
                 units_per_event, params["units_per_event"]["max"], n)
    deferral = _tri(
        rng, params["donor_deferral_rate"]["min"], donor_deferral_rate, params["donor_deferral_rate"]["max"], n
    )
    deferral = np.clip(deferral, 0.0, 0.95)

    def demand_for(diagnosed: np.ndarray, hu_share: float) -> np.ndarray:
        on_hu = diagnosed * hu_share
        off_hu = diagnosed * (1 - hu_share)
        events = on_hu * events_treated + off_hu * events_untreated
        return events * units

    demand_baseline = demand_for(diagnosed_children, hu_share=0.0)
    # Scenario: everyone affected gets diagnosed, then the hydroxyurea slider share is treated.
    demand_scenario = demand_for(
        affected_children, hu_share=share_on_hydroxyurea)

    donors_baseline = demand_baseline * target_coverage / (1 - deferral)
    donors_scenario = demand_scenario * target_coverage / (1 - deferral)

    collections = max(collections_per_year, 1e-9)
    pct_baseline = demand_baseline / collections * 100
    pct_scenario = demand_scenario / collections * 100

    units_avoided = demand_baseline - demand_scenario

    # Crisis surge: age-specific units per patient if an age mix is given.
    age_params = params.get("units_per_crisis_by_age") or DEFAULT_UNITS_BY_AGE
    crisis_by_age_units: dict[str, np.ndarray] = {}
    if crisis_by_age is not None:
        crisis_total = np.zeros(n)
        for band in AGE_BANDS:
            p = age_params.get(band, DEFAULT_UNITS_BY_AGE[band])
            per_patient = _tri(rng, p["min"], p["mode"], p["max"], n)
            arr = int(crisis_by_age.get(band, 0)) * per_patient
            crisis_by_age_units[band] = arr
            crisis_total = crisis_total + arr
    else:
        crisis_total = crisis_patients * units

    stock, target_days = _blood_stock(
        collections_per_year, params, crisis_total, deferral, stock_days_on_hand, rng, n
    )

    return {
        "affected_children": _percentiles(affected_children),
        "collections_per_day": float(collections_per_year / 365.0),
        "target_stock_days": target_days,
        "stock": stock,
        "crisis_units_total": _percentiles(crisis_total),
        "crisis_units_by_age": {b: _percentiles(a) for b, a in crisis_by_age_units.items()},
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
