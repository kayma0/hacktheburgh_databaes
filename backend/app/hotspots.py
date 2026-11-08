"""Africa SCD hotspots: how many people live with sickle cell disease in each country.

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


def _country(s: Series, rng: np.random.Generator) -> dict:
    n = N_DRAWS
    # People living with SCD: lognormal matched to the latest GBD value and its 95% interval.
    floor = 1.0
    p50 = max(s.val[-1], floor)
    lo = max(s.lower[-1], floor * 0.5)
    hi = max(s.upper[-1], lo * 1.0001)
    sigma = max((np.log(hi) - np.log(lo)) / (2 * Z95), 1e-6)
    cases = rng.lognormal(np.log(p50), sigma, n)
    return {"country": s.country, "cases_now": _pct(cases)}


@lru_cache(maxsize=1)
def compute_hotspots() -> dict:
    rng = np.random.default_rng(SEED)
    items = [_country(s, rng) for s in sorted(load_series().values(), key=lambda s: s.country)]

    # Heat: people living with SCD, scaled to the highest country, then square-rooted so
    # mid-sized countries stay visible next to Nigeria.
    c_max = max((i["cases_now"]["p50"] for i in items), default=1) or 1
    for i in items:
        i["heat"] = float(np.sqrt(i["cases_now"]["p50"] / c_max))
    items.sort(key=lambda i: i["heat"], reverse=True)

    data_year = int(next(iter(load_series().values())).years[-1])
    return {"data_year": data_year, "items": items}
