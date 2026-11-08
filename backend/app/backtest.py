"""How far to trust the case-trend projection: a back-test on the past.

Fit the same kind of trend the heat map uses (log-linear over 10 years) using only data up
to `train_end`, predict the years after it, and compare with the GBD figures for those
years. Honest limit: GBD series are themselves modelled and smooth, so this checks that
the trend method is stable and well-behaved, not that it matches counted patients.
"""
from __future__ import annotations

from functools import lru_cache

import numpy as np

from .hotspots import load_series

TRAIN_END = 2018
FIT_YEARS = 10
MIN_CASES = 1_000  # tiny countries make percentage errors meaningless


@lru_cache(maxsize=4)
def backtest(train_end: int = TRAIN_END, fit_years: int = FIT_YEARS) -> dict:
    errors: dict[int, list[tuple[str, float]]] = {}
    for s in load_series().values():
        years, val = s.years, s.val
        train = (years > train_end - fit_years) & (years <= train_end)
        if train.sum() < fit_years:
            continue
        slope, intercept = np.polyfit(years[train].astype(float), np.log(np.maximum(val[train], 1.0)), 1)
        for yr, actual in zip(years, val):
            h = int(yr) - train_end
            if h < 1 or actual < MIN_CASES:
                continue
            pred = float(np.exp(intercept + slope * yr))
            errors.setdefault(h, []).append((s.country, abs(pred - actual) / actual))

    by_horizon = []
    for h in sorted(errors):
        a = np.array([e for _, e in errors[h]])
        by_horizon.append({
            "years_ahead": h,
            "year": train_end + h,
            "countries": int(a.size),
            "median_error": float(np.median(a)),
            "p90_error": float(np.percentile(a, 90)),
            "share_within_10pct": float((a <= 0.10).mean()),
        })
    last = errors[max(errors)] if errors else []
    worst = sorted(last, key=lambda t: -t[1])[:3]
    return {
        "train_end": train_end,
        "fit_years": fit_years,
        "min_cases": MIN_CASES,
        "by_horizon": by_horizon,
        "worst_at_longest": [{"country": c, "error": float(e)} for c, e in worst],
    }
