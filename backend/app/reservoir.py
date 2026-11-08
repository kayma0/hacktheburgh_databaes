"""Blood reservoir per country: how many days of red-cell stock each blood type could
sustain, how fast each type is donated, and how much of the pull comes from SCD.

Reads data/blood_supply.csv (blood-type mix, WHO whole-blood donations, population,
national reserve target, each with a source or ASSUMPTION tag), data/need_calibration.csv
(published national blood requirements used to calibrate general need) and data/male_raw.csv +
data/female_raw.csv (GBD SCD prevalence by age band). Every output is MODELLED, not live
stock, and reported as P10/P50/P90 over a fixed-seed Monte Carlo. See docs/METHOD.md.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

from .model import BLOOD_TYPES, DEFAULT_DEMAND_WEIGHTS, DEFAULT_UNITS_BY_AGE

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
SUPPLY_CSV = DATA_DIR / "blood_supply.csv"
AGE_SEX_CSVS = (DATA_DIR / "male_raw.csv", DATA_DIR / "female_raw.csv")

N_DRAWS = 10_000
SEED = 20261107
Z95 = 1.959964

# Units discarded before use (expiry, TTI-reactive, incomplete, storage...). WHO AFRO
# 2022 survey: 15.6% of units in 33 countries. Range around it is an ASSUMPTION.
DISCARD = (0.08, 0.156, 0.25)
# General (non-SCD) whole-blood need per 1000 population per year is CALIBRATED, not
# assumed: see calibrate_need() and data/need_calibration.csv.
CALIBRATION_CSV = DATA_DIR / "need_calibration.csv"
# Transfusion events per SCD patient-year, untreated (REACH trial, clinic-based children;
# see docs/METHOD.md). Applied only to patients reached by care.
EVENTS_PER_PY = (0.30, 0.432, 0.60)
# ASSUMPTION: share of people with SCD who are in care and so draw on the blood bank.
DEFAULT_SHARE_IN_CARE = 0.3
# ASSUMPTION: uncertainty in each country's blood-type mix. Dirichlet concentration:
# higher for a cited national study than for a regional average.
DIRICHLET_CITED, DIRICHLET_ASSUMED = 400.0, 60.0
# Status thresholds as a share of the target, scaled from SANBS (5 days adequate,
# below 3 days critical): ok at the target, critical below 60% of it.
CRITICAL_AT = 0.6

# GBD age bands -> the app's units-per-transfusion bands. 20+ uses the adult dose.
GBD_TO_BAND = {
    "<1 year": "under_5", "12-23 months": "under_5", "2-4 years": "under_5",
    "5-9 years": "age_5_14", "10-14 years": "age_5_14",
    "15-19 years": "age_15_24", "20+ years": "age_25_plus",
}


@dataclass(frozen=True)
class Supply:
    country: str
    shares: dict[str, float]
    blood_type_source: str
    donations_year: int
    whole_blood_donations: float
    population: float
    donations_per_1000: float
    donations_source: str
    donations_note: str
    reserve_target_days: float
    reserve_source: str


@lru_cache(maxsize=1)
def load_supply() -> dict[str, Supply]:
    if not SUPPLY_CSV.exists():
        raise FileNotFoundError(f"Missing blood supply data: {SUPPLY_CSV}")
    out: dict[str, Supply] = {}
    with open(SUPPLY_CSV, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out[r["country"]] = Supply(
                country=r["country"],
                shares={t: float(r[f"share_{t}"]) for t in BLOOD_TYPES},
                blood_type_source=r["blood_type_source"],
                donations_year=int(r["donations_year"]),
                whole_blood_donations=float(r["whole_blood_donations"]),
                population=float(r["population"]),
                donations_per_1000=float(r["donations_per_1000"]),
                donations_source=r["donations_source"],
                donations_note=r["donations_note"],
                reserve_target_days=float(r["reserve_target_days"]),
                reserve_source=r["reserve_source"],
            )
    return out


@lru_cache(maxsize=1)
def load_scd_by_age() -> dict[tuple[str, int], dict[str, tuple[float, float, float]]]:
    """(country, year) -> band -> (val, lower, upper), male + female summed."""
    acc: dict[tuple[str, int], dict[str, list[float]]] = {}
    for path in AGE_SEX_CSVS:
        if not path.exists():
            raise FileNotFoundError(f"Missing SCD age data: {path}")
        with open(path, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                band = GBD_TO_BAND.get(r["age_name"])
                if band is None:
                    continue
                key = (r["location_name"], int(r["year"]))
                v = acc.setdefault(key, {}).setdefault(band, [0.0, 0.0, 0.0])
                v[0] += float(r["val"])
                v[1] += float(r["lower"])
                v[2] += float(r["upper"])
    return {k: {b: tuple(v) for b, v in bands.items()} for k, bands in acc.items()}


def _pct(x: np.ndarray) -> dict:
    p10, p50, p90 = np.percentile(x, [10, 50, 90])
    return {"p10": float(p10), "p50": float(p50), "p90": float(p90)}


def _tri(rng: np.random.Generator, lo: float, mode: float, hi: float, n: int) -> np.ndarray:
    return rng.triangular(lo, min(max(mode, lo), hi), hi, n)


def _status(days_p50: float, target: float) -> str:
    if days_p50 >= target * 0.999:
        return "ok"
    if days_p50 >= target * CRITICAL_AT:
        return "low"
    return "critical"


def _scd_year(country: str, year: int) -> int:
    years = sorted(y for (c, y) in load_scd_by_age() if c == country)
    if not years:
        raise KeyError(country)
    return min(years, key=lambda y: abs(y - year))


def _scd_units_day(
    country: str, year: int, share_in_care: float, rng: np.random.Generator, n: int
) -> tuple[np.ndarray, int, float, dict[str, dict]]:
    """Red-cell units a day used by people with SCD in care, from GBD prevalence by age
    for the GBD year nearest `year`. Returns (draws, gbd_year, patients, by_band)."""
    scd_year = _scd_year(country, year)
    bands = load_scd_by_age()[(country, scd_year)]
    z = rng.standard_normal(n)  # GBD band uncertainties move together
    events = _tri(rng, *EVENTS_PER_PY, n)
    total = np.zeros(n)
    patients = 0.0
    by_band: dict[str, dict] = {}
    for band, (val, lo, hi) in bands.items():
        sigma = (np.log(max(hi, 1e-9)) - np.log(max(lo, 1e-9))) / (2 * Z95)
        people = max(val, 1e-9) * np.exp(z * sigma)
        u = DEFAULT_UNITS_BY_AGE[band]
        units = people * share_in_care * events * _tri(rng, u["min"], u["mode"], u["max"], n) / 365
        total += units
        patients += val
        by_band[band] = {"patients": float(val), "units_per_day": _pct(units)}
    return total, scd_year, patients, by_band


@lru_cache(maxsize=1)
def calibrate_need() -> dict:
    """Fit general (non-SCD) need per 1000 population to published national figures.

    Each row of data/need_calibration.csv gives a country's stated annual requirement.
    Its implied general need = (requirement - modelled SCD use that year) / population.
    The need distribution is triangular(min, median, max) over those implied rates.
    """
    if not CALIBRATION_CSV.exists():
        raise FileNotFoundError(f"Missing calibration data: {CALIBRATION_CSV}")
    rng = np.random.default_rng(SEED)
    rows = []
    with open(CALIBRATION_CSV, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            req, pop, year = float(r["requirement_units"]), float(r["population"]), int(r["year"])
            scd_day, _, _, _ = _scd_units_day(r["country"], year, DEFAULT_SHARE_IN_CARE, rng, N_DRAWS)
            scd_year_units = float(np.median(scd_day)) * 365
            rows.append({
                "country": r["country"],
                "year": year,
                "requirement_units": req,
                "population": pop,
                "scd_units": scd_year_units,
                "implied_need_per_1000": (req - scd_year_units) / pop * 1000,
                "source": r["source"],
                "url": r["url"],
                "note": r["note"],
            })
    implied = np.array([r["implied_need_per_1000"] for r in rows])
    need = (float(implied.min()), float(np.median(implied)), float(implied.max()))

    # Check: re-run each calibration country through the calibrated model.
    for r in rows:
        draws = r["population"] * _tri(rng, *need, N_DRAWS) / 1000 + r["scd_units"]
        r["modelled_units"] = _pct(draws)
    return {"need_per_1000": {"min": need[0], "mode": need[1], "max": need[2]}, "rows": rows}


@lru_cache(maxsize=256)
def compute_reservoir(country: str, share_in_care: float = DEFAULT_SHARE_IN_CARE) -> dict:
    supply = load_supply().get(country)
    if supply is None:
        raise KeyError(country)
    share_in_care = float(min(max(share_in_care, 0.0), 1.0))
    rng = np.random.default_rng(SEED)
    n = N_DRAWS
    target = supply.reserve_target_days

    # Blood-type mix with uncertainty.
    alpha_k = DIRICHLET_ASSUMED if supply.blood_type_source.startswith("ASSUMPTION") \
        else DIRICHLET_CITED
    base = np.array([supply.shares[t] for t in BLOOD_TYPES])
    mix = rng.dirichlet(np.maximum(base, 1e-4) * alpha_k, n)  # (n, 8)

    # Supply: reported donations, minus discards.
    donated_day = supply.whole_blood_donations / 365.0
    discard = _tri(rng, *DISCARD, n)
    usable_day = donated_day * (1 - discard)

    # General (non-SCD) need, calibrated to published national requirements.
    cal = calibrate_need()["need_per_1000"]
    need_day = supply.population * _tri(rng, cal["min"], cal["mode"], cal["max"], n) / 1000 / 365.0

    # SCD load for the same year as the donation data, by age band.
    scd_units_day, scd_year, patients, by_band = _scd_units_day(
        country, supply.donations_year, share_in_care, rng, n)

    demand_day = need_day + scd_units_day

    # Per type: supply follows the donor mix; demand is pulled harder for O- (universal
    # donor) and less for AB, then renormalised so totals are unchanged.
    w = np.array([DEFAULT_DEMAND_WEIGHTS[t] for t in BLOOD_TYPES])
    pull = mix * w
    pull /= pull.sum(axis=1, keepdims=True)

    types = []
    for i, t in enumerate(BLOOD_TYPES):
        s_t = usable_day * mix[:, i]
        d_t = np.maximum(demand_day * pull[:, i], 1e-9)
        ratio = s_t / d_t
        # ASSUMPTION: a service that collects x% of what it uses can hold x% of its target
        # buffer; it cannot hold more than its target.
        days = target * np.minimum(ratio, 1.0)
        gap = np.maximum(d_t - s_t, 0.0) / (1 - discard)  # extra donations per day
        p = _pct(days)
        types.append({
            "blood_type": t,
            "donor_share": float(base[i]),
            "donated_per_day": _pct(donated_day * mix[:, i]),
            "usable_per_day": _pct(s_t),
            "demand_per_day": _pct(d_t),
            "scd_demand_per_day": _pct(scd_units_day * pull[:, i]),
            "supply_ratio": _pct(ratio),
            "days": p,
            "fill": float(min(p["p50"] / target, 1.0)) if target > 0 else 0.0,
            "status": _status(p["p50"], target),
            "extra_donations_per_day": _pct(gap),
        })

    return {
        "country": country,
        "data_year": supply.donations_year,
        "scd_data_year": scd_year,
        "target_days": target,
        "target_source": supply.reserve_source,
        "target_is_assumption": supply.reserve_source.startswith("ASSUMPTION"),
        "blood_type_source": supply.blood_type_source,
        "blood_type_is_assumption": supply.blood_type_source.startswith("ASSUMPTION"),
        "donations_source": supply.donations_source,
        "donations_is_assumption": supply.donations_source.startswith("ASSUMPTION"),
        "donations_note": supply.donations_note,
        "population": supply.population,
        "donations_per_year": supply.whole_blood_donations,
        "donations_per_1000": supply.donations_per_1000,
        "share_in_care": share_in_care,
        "need_per_1000": cal,
        "scd_patients": patients,
        "scd_by_age": by_band,
        "donated_per_day": float(donated_day),
        "usable_per_day": _pct(usable_day),
        "demand_per_day": _pct(demand_day),
        "scd_demand_per_day": _pct(scd_units_day),
        "scd_share_of_demand": _pct(scd_units_day / demand_day),
        "types": types,
    }
