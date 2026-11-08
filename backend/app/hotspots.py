"""Africa SCD hotspots: how many people live with sickle cell disease in each country.

`load_heatmap` serves the map from data/processed/heatmap.json (built by
scripts/build_data.py). `load_series` reads the raw GBD series (data/raw.csv: people living
with sickle cell disorders, all ages, by country and year, with a 95% uncertainty interval),
which the back-test (backtest.py) fits and checks. Every output is MODELLED; see
docs/METHOD.md.
"""
from __future__ import annotations

import csv
import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

RAW_CSV = Path(__file__).resolve().parent.parent.parent / "data" / "raw.csv"
HEATMAP_JSON = Path(__file__).resolve().parent.parent.parent / "data" / "processed" / "heatmap.json"

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


@lru_cache(maxsize=1)
def load_heatmap() -> dict:
    """data/processed/heatmap.json for the map: per-country estimate for `meta.year`
    (a GBD trend carried forward from `meta.data_year`), low/high range, log-scaled
    intensity and legend bucket. Countries sorted by cases, highest first."""
    if not HEATMAP_JSON.exists():
        raise FileNotFoundError(f"Missing hotspot data: {HEATMAP_JSON}")
    raw = json.loads(HEATMAP_JSON.read_text(encoding="utf-8"))
    meta = raw["meta"]
    return {
        "year": int(meta["year"]),
        "data_year": int(meta["data_year"]),
        "source": meta["source"],
        "method": meta["method"],
        "buckets": meta["scale"]["buckets"],
        "items": sorted(raw["countries"], key=lambda c: c["cases"], reverse=True),
    }
