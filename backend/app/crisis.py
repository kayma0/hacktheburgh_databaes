"""Sickle cell crisis simulator: can a country's blood supply cover N people in crisis
within a time window, at the rate it collects blood?

1. Trend fitting. GBD SCD prevalence by sex and age band (data/male_raw.csv,
   data/female_raw.csv) is fitted log-linearly over the last 10 years and projected to the
   current year, giving today's age/sex mix. WHO whole-blood donations per 1000 people
   (data/donations_history.csv, 2014-2018, with World Bank population) are fitted the same
   way and projected to the current year, with the slope's uncertainty carried forward.
2. Patient pool. 100 patients drawn at random from that age/sex mix, each given a blood
   group drawn from data/blood_groups_simple.json.
3. Monte Carlo. Each draw picks N patients at random from the pool, gives each a random
   crisis day in the window and a dose for their age and sex, then serves them in the
   order their crises happen from the blood available for their group at that moment:
   stock at the start of the window plus what is collected, minus normal hospital use.
   A patient whose group has run out is not served.

Everything is MODELLED, not live data. See docs/METHOD.md.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import numpy as np

from .trends import (
    PROJECTION_YEAR,
    donation_trend,
    population_in,
    project_age_sex,
    sample_donations_per_1000,
)
from .reservoir import (
    BLOOD_TYPES,
    DEFAULT_DEMAND_WEIGHTS,
    DEFAULT_SHARE_IN_CARE,
    DIRICHLET_ASSUMED,
    DIRICHLET_CITED,
    DISCARD,
    _pct,
    _scd_units_day,
    _tri,
    calibrate_need,
    load_supply,
)

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
BLOOD_GROUPS_JSON = DATA_DIR / "blood_groups_simple.json"
USECASES_JSON = DATA_DIR / "processed" / "usecases.json"

N_DRAWS = 5_000
POOL_SIZE = 100
MAX_PEOPLE, MAX_DAYS = 50, 365

# How the result sentence groups people.
AGE_GROUP_OF = {
    "<1 year": "under_5", "12-23 months": "under_5", "2-4 years": "under_5",
    "5-9 years": "children", "10-14 years": "teens", "15-19 years": "teens",
    "20+ years": "adults",
}
AGE_GROUP_LABELS = {
    "under_5": "under-5s", "children": "children aged 5-9",
    "teens": "teens aged 10-19", "adults": "adults aged 20+",
}
# Same rule as scripts/build_data.py (FEMALE_DOSE_FROM_AGE).
FEMALE_DOSE_FROM_AGE = ("15-19 years", "20+ years")

# Turning a shortfall into a recruitment target. WHO AFRO 2022 survey: 7.6% of donor
# candidates deferred, 15.6% of collected units discarded; one donation = one unit.
DONOR_DEFERRAL = 0.076
DISCARD_TYPICAL = 0.156
# Recruit enough to cover the shortfall in this share of simulations.
COVER_SHARE = 0.9

# Verdict thresholds: share of simulations in which every patient was served.
ENOUGH_AT, AT_RISK_AT = 0.9, 0.5


@lru_cache(maxsize=1)
def _blood_group_probs() -> dict[str, float]:
    rows = json.loads(BLOOD_GROUPS_JSON.read_text(encoding="utf-8"))
    p = {r["blood_group"]: float(r["probability"]) for r in rows}
    s = sum(p.values())
    return {t: p.get(t, 0.0) / s for t in BLOOD_TYPES}


@lru_cache(maxsize=1)
def _doses() -> tuple[dict, float, float]:
    """Per-age blood dose (mL min/mode/max), female factor and mL per unit, from the
    team's usecases.json so both use the same assumption."""
    meta = json.loads(USECASES_JSON.read_text(encoding="utf-8"))["meta"]
    return meta["blood_ml_assumption"], float(meta["female_dose_factor"]), float(meta["ml_per_unit"])


def make_pool(country: str, rng: np.random.Generator, size: int = POOL_SIZE) -> list[dict]:
    """`size` patients drawn from today's projected age/sex mix, with random blood groups."""
    proj = project_age_sex(country)
    keys = list(proj["shares"])
    p = np.array([proj["shares"][k] for k in keys])
    pick = rng.choice(len(keys), size=size, p=p / p.sum())
    probs = _blood_group_probs()
    groups = rng.choice(BLOOD_TYPES, size=size, p=[probs[t] for t in BLOOD_TYPES])
    return [
        {"id": i + 1, "sex": keys[k][0], "age": keys[k][1], "age_group": AGE_GROUP_OF[keys[k][1]],
         "blood_group": str(g)}
        for i, (k, g) in enumerate(zip(pick, groups))
    ]


def simulate_crisis(
    country: str,
    people: int,
    days: int,
    seed: int,
    o_neg_fallback: bool = False,
) -> dict:
    """Crisis patients are served from the blood left after normal hospital use.
    o_neg_fallback: a patient whose own group has run out gets O- (the universal red-cell
    donor) if there is O- left."""
    supply = load_supply().get(country)
    if supply is None:
        raise KeyError(country)
    people = int(min(max(people, 1), MAX_PEOPLE))
    days = int(min(max(days, 1), MAX_DAYS))
    rng = np.random.default_rng(seed)
    n = N_DRAWS
    year = PROJECTION_YEAR
    target = supply.reserve_target_days

    # ── 1-2. Pool from the trend-projected age/sex mix ──
    pool = make_pool(country, rng)
    g_idx = np.array([BLOOD_TYPES.index(p["blood_group"]) for p in pool])
    dose_tab, female_factor, ml_per_unit = _doses()
    lo = np.array([dose_tab[p["age"]]["min"] for p in pool], dtype=float)
    mode = np.array([dose_tab[p["age"]]["ml"] for p in pool], dtype=float)
    hi = np.array([dose_tab[p["age"]]["max"] for p in pool], dtype=float)
    sexf = np.array([female_factor if p["sex"] == "female" and p["age"] in FEMALE_DOSE_FROM_AGE
                     else 1.0 for p in pool])

    # ── supply side, projected to this year ──
    pop_now = population_in(country, year)
    tr = donation_trend(country, year)
    rate_now = sample_donations_per_1000(tr, rng, n)
    collected_day = rate_now * pop_now / 1000 / 365
    usable_day = collected_day * (1 - _tri(rng, *DISCARD, n))

    # Normal hospital use: calibrated general need + SCD patients already in care,
    # scaled to today's projected number of people with SCD.
    cal = calibrate_need()["need_per_1000"]
    general_day = pop_now * _tri(rng, cal["min"], cal["mode"], cal["max"], n) / 1000 / 365
    proj = project_age_sex(country)
    scd_day, _, _, _ = _scd_units_day(country, proj["data_year"], DEFAULT_SHARE_IN_CARE, rng, n)
    scd_day = scd_day * proj["people_now"] / max(proj["people_data_year"], 1e-9)
    routine_day = general_day + scd_day

    alpha_k = DIRICHLET_ASSUMED if supply.blood_type_source.startswith("ASSUMPTION") \
        else DIRICHLET_CITED
    base = np.array([supply.shares[t] for t in BLOOD_TYPES])
    mix = rng.dirichlet(np.maximum(base, 1e-4) * alpha_k, n)
    pull = mix * np.array([DEFAULT_DEMAND_WEIGHTS[t] for t in BLOOD_TYPES])
    pull /= pull.sum(axis=1, keepdims=True)

    usable_g = usable_day[:, None] * mix                     # (n, 8) units a day
    routine_g = np.maximum(routine_day[:, None] * pull, 1e-9)
    # Stock at the start: the reservoir model's days of cover x daily use.
    stock_g = target * np.minimum(usable_g, routine_g)
    net_g = usable_g - routine_g                             # spare (+) or shortfall (-) a day

    # ── 3. Monte Carlo: pick people, time their crises, serve in order ──
    chosen = np.argsort(rng.random((n, POOL_SIZE)), axis=1)[:, :people]   # (n, people)
    t_crisis = rng.random((n, people)) * days
    order = np.argsort(t_crisis, axis=1)
    chosen = np.take_along_axis(chosen, order, axis=1)
    t_crisis = np.take_along_axis(t_crisis, order, axis=1)
    grp = g_idx[chosen]
    dose = rng.triangular(lo[chosen], mode[chosen], hi[chosen]) * sexf[chosen] / ml_per_unit

    # What flows in for crisis patients each day: what is spare after normal use.
    inflow_g = net_g
    o_neg = BLOOD_TYPES.index("O-")
    rows = np.arange(n)
    used = np.zeros((n, len(BLOOD_TYPES)))
    served = np.zeros((n, people), dtype=bool)
    o_neg_given = np.zeros(n)        # O- units given to patients of other groups
    o_neg_helped = np.zeros(n)       # how many such patients
    for k in range(people):
        g = grp[:, k]
        t_k = t_crisis[:, k]
        d_k = dose[:, k]
        avail = stock_g[rows, g] + inflow_g[rows, g] * t_k - used[rows, g]
        ok = d_k <= avail
        used[rows, g] += np.where(ok, d_k, 0.0)
        if o_neg_fallback:
            avail_o = stock_g[:, o_neg] + inflow_g[:, o_neg] * t_k - used[:, o_neg]
            sub = ~ok & (g != o_neg) & (d_k <= avail_o)
            used[:, o_neg] += np.where(sub, d_k, 0.0)
            o_neg_given += np.where(sub, d_k, 0.0)
            o_neg_helped += sub
            ok = ok | sub
        served[:, k] = ok

    unserved = (~served).sum(axis=1)
    all_served = unserved == 0
    # Day the first patient goes without, in runs where anyone does.
    t_first = np.where(~served, t_crisis, np.inf).min(axis=1)
    any_short = np.isfinite(t_first)
    donors_per_unit = 1.0 / ((1 - DISCARD_TYPICAL) * (1 - DONOR_DEFERRAL))

    by_group = []
    for gi, t in enumerate(BLOOD_TYPES):
        in_g = grp == gi
        need = (dose * in_g).sum(axis=1)
        short = (dose * in_g * ~served).sum(axis=1)
        has = in_g.any(axis=1)
        p_short = float(((in_g & ~served).any(axis=1)).sum() / max(has.sum(), 1))
        # Needs and shortfall: only over simulations that picked someone of this group.
        need_h = need[has] if has.any() else np.zeros(1)
        short_h = short[has] if has.any() else np.zeros(1)
        # Deadline: median day this group's first patient goes without, in runs where one does.
        g_first = np.where(in_g & ~served, t_crisis, np.inf).min(axis=1)
        g_hit = np.isfinite(g_first)
        # Day the group's stock runs dry from normal use alone (inf if it never does).
        dry = np.where(net_g[:, gi] < 0, stock_g[:, gi] / np.maximum(-net_g[:, gi], 1e-9), np.inf)
        by_group.append({
            "blood_group": t,
            "patients_mean": float(in_g.sum(axis=1).mean()),
            "share_of_sims_with_patients": float(has.mean()),
            "units_needed": _pct(need_h),
            "units_short": _pct(short_h),
            "p_short": p_short,
            "collected_per_day": float(np.median(usable_day * mix[:, gi])),
            "routine_use_per_day": float(np.median(routine_g[:, gi])),
            "stock_at_start": float(np.median(stock_g[:, gi])),
            "runs_dry_after_days": float(np.median(dry)) if np.isfinite(np.median(dry)) else None,
            # Extra donors of this group to recruit before the window so that the shortfall
            # is covered in COVER_SHARE of simulations.
            "donors_to_cover": int(np.ceil(np.quantile(short, COVER_SHARE) * donors_per_unit - 1e-9)),
            "deadline_day": float(np.median(g_first[g_hit])) if g_hit.any() else None,
        })

    # A typical simulation to describe in words: unserved count at the median, then the
    # draw whose total need is closest to the median among those.
    med_unserved = int(np.median(unserved))
    cand = np.flatnonzero(unserved == med_unserved)
    tot = dose.sum(axis=1)
    pick = int(cand[np.argmin(np.abs(tot[cand] - np.median(tot)))])
    example = [
        {**pool[int(chosen[pick, k])], "day": float(t_crisis[pick, k]),
         "units": float(dose[pick, k]), "served": bool(served[pick, k])}
        for k in range(people)
    ]
    counts = {a: 0 for a in AGE_GROUP_LABELS}
    for p in example:
        counts[p["age_group"]] += 1

    p_all = float(all_served.mean())
    verdict = "enough" if p_all >= ENOUGH_AT else "at_risk" if p_all >= AT_RISK_AT else "not_enough"
    lacking = [g["blood_group"] for g in sorted(by_group, key=lambda g: -g["p_short"])
               if g["p_short"] >= 0.5 and g["share_of_sims_with_patients"] > 0.05]
    at_risk = [g["blood_group"] for g in sorted(by_group, key=lambda g: -g["p_short"])
               if 0.2 <= g["p_short"] < 0.5 and g["share_of_sims_with_patients"] > 0.05]

    return {
        "country": country,
        "people": people,
        "days": days,
        "seed": seed,
        "draws": n,
        "projection_year": year,
        "verdict": verdict,
        "p_all_served": p_all,
        "patients_unserved": _pct(unserved.astype(float)),
        "units_needed": _pct(tot),
        "lacking": lacking,
        "at_risk": at_risk,
        "by_group": by_group,
        "example": example,
        "example_counts": counts,
        "age_group_labels": AGE_GROUP_LABELS,
        "pool": pool,
        "trend": {
            "scd_people_now": proj["people_now"],
            "scd_people_data_year": proj["people_data_year"],
            "scd_data_year": proj["data_year"],
            "donation_years": tr["years"],
            "donations_per_1000_history": tr["per_1000"],
            "donations_per_1000_now": _pct(rate_now),
            "donation_growth_pct_per_year": tr["slope"] * 100,
            "donation_fallback": tr["fallback"],
            "population_now": pop_now,
        },
        "collected_per_day": _pct(collected_day),
        "routine_use_per_day": _pct(routine_day),
        "target_days": target,
        "o_neg_fallback": bool(o_neg_fallback),
        "o_neg_given_units": _pct(o_neg_given),
        "o_neg_patients_helped": float(o_neg_helped.mean()),
        "first_short_day": float(np.median(t_first[any_short])) if any_short.any() else None,
        "share_runs_with_shortage": float(any_short.mean()),
        "donors_to_cover_total": int(sum(g["donors_to_cover"] for g in by_group)),
        "cover_share": COVER_SHARE,
    }
