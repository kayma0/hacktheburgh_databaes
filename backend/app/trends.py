"""Trend fitting shared by the reservoir page and the crisis simulator.

- People with SCD by sex and age (GBD, data/male_raw.csv + data/female_raw.csv): log-linear
  fit per group over the last 10 years, projected to the current year.
- Whole-blood donations per 1000 people (data/donations_history.csv: WHO 2014-2018 plus
  newer national reports, with World Bank population from data/population.csv): log-linear
  fit, slope capped, projected to the current year with its uncertainty.
"""
from __future__ import annotations

import csv
from datetime import date
from functools import lru_cache
from pathlib import Path

import numpy as np

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
AGE_SEX_CSVS = {"male": DATA_DIR / "male_raw.csv", "female": DATA_DIR / "female_raw.csv"}
DONATIONS_CSV = DATA_DIR / "donations_history.csv"
POPULATION_CSV = DATA_DIR / "population.csv"

PROJECTION_YEAR = date.today().year
GBD_AGES = ["<1 year", "12-23 months", "2-4 years", "5-9 years", "10-14 years",
            "15-19 years", "20+ years"]
GBD_FIT_YEARS = 10
# ASSUMPTION: national donation rates usually change by about 3% a year (prior SD on the
# slope) and rarely by more than 8% a year for long (cap). Keeps 2-5 noisy points from
# extrapolating wildly.
DONATION_SLOPE_PRIOR_SD = 0.03
DONATION_SLOPE_CAP = 0.08
# A 2-point fit has no residuals to estimate its error from: treat its slope as this noisy.
DONATION_TWO_POINT_SE = 0.10
DONATION_LEVEL_SD_FLOOR = 0.05
# Recent years count more: a data point's weight halves every this many years back.
DONATION_HALF_LIFE_YEARS = 5.0
# Fallback when there is no data for a country: WHO AFRO 2022 regional average.
FALLBACK_PER_1000 = 5.2


def _loglinear(x: np.ndarray, y: np.ndarray, w: np.ndarray | None = None
               ) -> tuple[float, float, float, float]:
    """(Weighted) least squares of log(y) on x.
    Returns (weighted mean x, weighted mean log y, slope, slope standard error)."""
    ly = np.log(np.maximum(y, 1e-9))
    w = np.ones_like(x, dtype=float) if w is None else np.asarray(w, dtype=float)
    w = w / w.sum()
    xm, ym = float((w * x).sum()), float((w * ly).sum())
    if len(x) < 2:
        return xm, ym, 0.0, 0.0
    xc = x - xm
    sxx = float((w * xc**2).sum())
    slope = float((w * xc * (ly - ym)).sum() / sxx)
    if len(x) <= 2:
        return xm, ym, slope, 0.0
    resid = ly - (ym + slope * xc)
    n_eff = 1.0 / float((w**2).sum())
    var = float((w * resid**2).sum()) * n_eff / max(n_eff - 2, 1.0)
    return xm, ym, slope, float(np.sqrt(var / (sxx * n_eff)))


@lru_cache(maxsize=1)
def _gbd_by_sex() -> dict[tuple[str, str, str], list[tuple[int, float]]]:
    """(country, sex, age) -> [(year, people living with SCD)]."""
    out: dict[tuple[str, str, str], list[tuple[int, float]]] = {}
    for sex, path in AGE_SEX_CSVS.items():
        with open(path, newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                out.setdefault((r["location_name"], sex, r["age_name"]), []).append(
                    (int(r["year"]), float(r["val"])))
    for v in out.values():
        v.sort()
    return out


@lru_cache(maxsize=128)
def project_age_sex(country: str, year: int = PROJECTION_YEAR) -> dict:
    """People with SCD by sex and age, projected to `year` by a log-linear trend per
    group over the last GBD_FIT_YEARS of data."""
    data = _gbd_by_sex()
    cells, last_year, last_total = {}, 0, 0.0
    for sex in ("male", "female"):
        for age in GBD_AGES:
            series = data.get((country, sex, age))
            if not series:
                raise KeyError(country)
            series = series[-GBD_FIT_YEARS:]
            x = np.array([s[0] for s in series], dtype=float)
            y = np.array([s[1] for s in series], dtype=float)
            xm, ym, slope, _ = _loglinear(x, y)
            cells[(sex, age)] = float(np.exp(ym + slope * (year - xm))) if y.max() > 0 else 0.0
            last_year = int(x[-1])
            last_total += float(y[-1])
    total = sum(cells.values()) or 1.0
    return {
        "year": year,
        "data_year": last_year,
        "people_now": total,
        "people_data_year": last_total,
        "shares": {k: v / total for k, v in cells.items()},
    }


@lru_cache(maxsize=1)
def _population() -> dict[str, list[tuple[int, float]]]:
    out: dict[str, list[tuple[int, float]]] = {}
    with open(POPULATION_CSV, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out.setdefault(r["country"], []).append((int(r["year"]), float(r["population"])))
    for v in out.values():
        v.sort()
    return out


@lru_cache(maxsize=1)
def _donation_history() -> dict[str, list[tuple[int, float]]]:
    out: dict[str, list[tuple[int, float]]] = {}
    with open(DONATIONS_CSV, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            out.setdefault(r["country"], []).append(
                (int(r["year"]), float(r["whole_blood_donations"])))
    for v in out.values():
        v.sort()
    return out


def population_in(country: str, year: int) -> float:
    pts = _population()[country]
    known = dict(pts)
    if year in known:
        return known[year]
    # Past the last World Bank year: continue the last 5 years' growth.
    recent = pts[-6:]
    x = np.array([p[0] for p in recent], dtype=float)
    y = np.array([p[1] for p in recent], dtype=float)
    xm, ym, slope, _ = _loglinear(x, y)
    return float(np.exp(ym + slope * (year - xm)))


@lru_cache(maxsize=128)
def donation_trend(country: str, year: int = PROJECTION_YEAR) -> dict:
    """Donations per 1000 people a year, projected to `year`.

    Slope: weighted least squares on log(rate) (recent years weighted more), then shrunk
    toward zero by a prior that national rates change about DONATION_SLOPE_PRIOR_SD a year,
    so a short, noisy series projects nearly flat unless the trend in it is clear; capped.
    Level: starts from the latest reported figure, with the series' scatter as its noise.
    """
    hist = _donation_history().get(country, [])
    if not hist:
        return {"years": [], "per_1000": [], "slope": 0.0, "slope_sd": DONATION_SLOPE_PRIOR_SD,
                "level_sd": 2 * DONATION_LEVEL_SD_FLOOR, "anchor_year": year,
                "anchor_log": float(np.log(FALLBACK_PER_1000)), "fitted_now": FALLBACK_PER_1000,
                "year": year, "fallback": True}
    yrs = np.array([h[0] for h in hist], dtype=float)
    rate = np.array([h[1] / population_in(country, int(y)) * 1000 for h, y in zip(hist, yrs)])
    tau2 = DONATION_SLOPE_PRIOR_SD ** 2
    if len(yrs) >= 2:
        wts = 0.5 ** ((yrs.max() - yrs) / DONATION_HALF_LIFE_YEARS)
        xm, ym, raw, se = _loglinear(yrs, rate, wts)
        se2 = se**2 if len(yrs) > 2 else DONATION_TWO_POINT_SE**2
        slope = raw * tau2 / (tau2 + se2)
        slope_sd = float(np.sqrt(1.0 / (1.0 / tau2 + 1.0 / se2)))
        resid = np.log(rate) - (ym + raw * (yrs - xm))
        level_sd = max(float(np.sqrt((resid**2).sum() / max(len(yrs) - 2, 1))) if len(yrs) > 2
                       else 2 * DONATION_LEVEL_SD_FLOOR, DONATION_LEVEL_SD_FLOOR)
    else:
        raw, slope, slope_sd, level_sd = 0.0, 0.0, DONATION_SLOPE_PRIOR_SD, 2 * DONATION_LEVEL_SD_FLOOR
    slope = float(np.clip(slope, -DONATION_SLOPE_CAP, DONATION_SLOPE_CAP))
    anchor_year, anchor_log = int(yrs[-1]), float(np.log(rate[-1]))
    return {
        "years": [int(y) for y in yrs],
        "per_1000": [float(r) for r in rate],
        "raw_slope": float(raw),
        "slope": slope,
        "slope_sd": float(slope_sd),
        "level_sd": float(level_sd),
        "anchor_year": anchor_year,
        "anchor_log": anchor_log,
        "fitted_now": float(np.exp(anchor_log + slope * (year - anchor_year))),
        "year": year,
        "fallback": False,
    }


def sample_donations_per_1000(tr: dict, rng: np.random.Generator, n: int) -> np.ndarray:
    """Draws of this year's donations per 1000 people from a donation_trend() fit."""
    slopes = rng.normal(tr["slope"], tr["slope_sd"], n)
    return np.exp(tr["anchor_log"] + rng.normal(0, tr["level_sd"], n)
                  + slopes * (tr["year"] - tr["anchor_year"]))
