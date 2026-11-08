"""Africa SCD hotspots: where cases are concentrated, where they are heading, and how
many newborns each year could be reached by early screening and care.

Reads data/raw.csv (GBD sickle cell disorders prevalence, number of people, all ages,
by country and year, with a 95% uncertainty interval). Every output is MODELLED and
reported as P10/P50/P90 over a fixed-seed Monte Carlo. See docs/METHOD.md.
"""
from __future__ import annotations

import csv
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

RAW_CSV = Path(__file__).resolve().parent.parent.parent / "data" / "raw.csv"

N_DRAWS = 10_000
SEED = 20261107
Z95 = 1.959964

# Trend fit: log-linear regression over the most recent years of the GBD series.
FIT_YEARS = 15
# ASSUMPTION: extrapolation is less certain than the regression's own standard error
# (GBD series are smooth, so the fit error alone would be falsely tight). Added in
# quadrature to the slope's standard deviation, in log-points per year.
SLOPE_SD_FLOOR = 0.006

# ASSUMPTION: babies born with SCD each year as a fraction of people living with SCD.
# Rough calibration: Piel et al. 2013 put Nigeria at roughly 90,000 SCA births in 2010
# against ~1.9M GBD prevalent cases (~0.05); other countries differ with survival.
BIRTH_FRACTION = (0.03, 0.05, 0.09)  # min / mode / max

MIN_HORIZON, MAX_HORIZON = 2025, 2050
DEFAULT_HORIZON = 2035


@dataclass(frozen=True)
class Series:
    country: str
    years: np.ndarray
    val: np.ndarray
    lower: np.ndarray
    upper: np.ndarray


@lru_cache(maxsize=1)
def load_series() -> dict[str, Series]:
    """Country -> prevalence series from data/raw.csv. Fails loudly if it is missing."""
    if not RAW_CSV.exists():
        raise FileNotFoundError(f"Missing hotspot data: {RAW_CSV}")
    by_country: dict[str, list[tuple[int, float, float, float]]] = {}
    with open(RAW_CSV, newline="", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            by_country.setdefault(r["location_name"], []).append(
                (int(r["year"]), float(r["val"]), float(r["lower"]), float(r["upper"]))
            )
    out: dict[str, Series] = {}
    for country, rows in by_country.items():
        rows.sort()
        a = np.array(rows, dtype=float)
        out[country] = Series(country, a[:, 0].astype(int), a[:, 1], a[:, 2], a[:, 3])
    return out


def _pct(x: np.ndarray) -> dict:
    p10, p50, p90 = np.percentile(x, [10, 50, 90])
    return {"p10": float(p10), "p50": float(p50), "p90": float(p90)}


def _tri(rng: np.random.Generator, lo: float, mode: float, hi: float, n: int) -> np.ndarray:
    mode = min(max(mode, lo), hi)
    return rng.triangular(lo, mode, hi, n)


def _project_country(s: Series, horizon: int, rng: np.random.Generator) -> dict:
    n = N_DRAWS
    last = int(s.years[-1])
    steps = max(horizon - last, 0)

    # Today's level: lognormal matched to the GBD value and its 95% interval.
    floor = 1.0
    p50 = max(s.val[-1], floor)
    lo = max(s.lower[-1], floor * 0.5)
    hi = max(s.upper[-1], lo * 1.0001)
    sigma = max((np.log(hi) - np.log(lo)) / (2 * Z95), 1e-6)
    base = rng.lognormal(np.log(p50), sigma, n)

    # Growth: log-linear trend over the last FIT_YEARS, slope uncertain.
    k = min(FIT_YEARS, len(s.years))
    x = s.years[-k:].astype(float)
    y = np.log(np.maximum(s.val[-k:], floor))
    xc = x - x.mean()
    slope = float((xc * (y - y.mean())).sum() / (xc**2).sum())
    resid = y - (y.mean() + slope * xc)
    se = float(np.sqrt((resid**2).sum() / max(k - 2, 1) / (xc**2).sum()))
    slope_sd = float(np.hypot(se, SLOPE_SD_FLOOR))
    slopes = rng.normal(slope, slope_sd, n)

    births_frac = _tri(rng, *BIRTH_FRACTION, n)

    # cases[t] for every year after the last data year, all draws at once.
    ks = np.arange(1, steps + 1, dtype=float)[:, None]
    cases = base[None, :] * np.exp(slopes[None, :] * ks) if steps else np.empty((0, n))
    p = np.percentile(np.vstack([base[None, :], cases]), [10, 50, 90], axis=1)
    path = [
        {"year": last + t, "p10": float(p[0, t]), "p50": float(p[1, t]), "p90": float(p[2, t])}
        for t in range(steps + 1)
    ]
    cases_h = cases[-1] if steps else base

    return {
        "country": s.country,
        "history": [
            {"year": int(yr), "p50": float(v), "p10": float(l), "p90": float(u)}
            for yr, v, l, u in zip(s.years, s.val, s.lower, s.upper)
        ],
        "cases_now": _pct(base),
        "cases_horizon": _pct(cases_h),
        "growth_pct_per_year": _pct((np.exp(slopes) - 1) * 100),
        "change": _pct(cases_h - base),
        "births_per_year_horizon": _pct(cases_h * births_frac),
        "path": path,
    }


@lru_cache(maxsize=64)
def compute_hotspots(horizon: int = DEFAULT_HORIZON) -> dict:
    horizon = int(min(max(horizon, MIN_HORIZON), MAX_HORIZON))
    rng = np.random.default_rng(SEED)
    items = [
        _project_country(s, horizon, rng)
        for s in sorted(load_series().values(), key=lambda s: s.country)
    ]

    # Heat: half people living with SCD today, half the extra people expected to need
    # care by the horizon (growth only; shrinking countries count as zero), each scaled
    # to the highest country, then square-rooted so mid-sized countries stay visible.
    c_max = max((i["cases_now"]["p50"] for i in items), default=1) or 1
    g_max = max((max(i["change"]["p50"], 0.0) for i in items), default=1) or 1
    for i in items:
        raw = 0.5 * i["cases_now"]["p50"] / c_max + 0.5 * max(i["change"]["p50"], 0.0) / g_max
        i["heat"] = float(np.sqrt(raw))
    items.sort(key=lambda i: i["heat"], reverse=True)

    last_year = int(next(iter(load_series().values())).years[-1])
    return {"data_year": last_year, "horizon": horizon, "items": items}
