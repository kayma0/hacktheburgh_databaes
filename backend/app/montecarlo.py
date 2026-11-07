"""Vectorised, seeded Monte Carlo model of paediatric SCD transfusion demand.

All outputs are MODELLED estimates, reported as P10 / P50 / P90.

Per draw (shared parameter draws are common to all countries, i.e. fully correlated across countries,
because e.g. 'units per event' is one unknown, not 48 independent unknowns):

    children          ~ lognormal(mu_c, sigma_c)            per country, from source point + 95% interval
    diagnosed         = children * share_diagnosed
    events_per_child  = (1 - hu) * rate_untreated + hu * rate_hydroxyurea     (rates per person-year)
    demand_units      = diagnosed * events_per_child * units_per_event        (expected value; Poisson noise
                                                                               is negligible at these counts)
    collections       = donations_per_1000 / 1000 * population
    pct_of_collections= demand_units / collections
    gap_units         = demand_units * target_coverage
    donors_needed     = gap_units / (1 - deferral_rate)                       (attendees needed)

Scenario 'universal diagnosis + hydroxyurea': share_diagnosed = 1, hu = universal_hydroxyurea_coverage.
Units avoided = demand(universal diagnosis, no HU) - demand(universal diagnosis, HU).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from . import params as P
from .dataset import Dataset

PCTS = (10, 50, 90)
Z90 = 1.2815515655446004


@dataclass
class SimResult:
    iso3: list[str]
    draws: dict[str, np.ndarray]     # metric -> (n_countries, n_draws)
    shared: dict[str, np.ndarray]    # parameter -> (n_draws,)
    source: str
    n: int
    seed: int


def _pcts(a: np.ndarray, axis: int = -1) -> np.ndarray:
    return np.percentile(a, PCTS, axis=axis)


def simulate(ds: Dataset, params: dict, source: str, n: int = 10_000, seed: int = 0,
             iso3: list[str] | None = None) -> SimResult:
    if source not in ds.sources:
        raise ValueError(f"burden source '{source}' not loaded. Available: {ds.sources}")
    df = ds.countries
    ok = df["population"].notna() & df[f"{source}_mu"].notna() & df["don_mu"].notna()
    if iso3:
        ok &= df.index.isin(iso3)
    sub = df[ok]
    if sub.empty:
        raise ValueError("no countries with complete inputs for this request")
    rng = np.random.default_rng(seed)
    k = len(sub)

    shared = {name: P.sample(params[name], n, rng) for name in [
        "share_diagnosed", "share_on_hydroxyurea", "transfusion_rate_untreated",
        "transfusion_rate_hydroxyurea", "units_per_event", "donor_deferral_rate"]}
    target = P.central(params["target_coverage"])
    hu_univ = P.central(params["universal_hydroxyurea_coverage"])

    z_child = rng.standard_normal((k, n))
    z_don = rng.standard_normal((k, n))
    mu = sub[f"{source}_mu"].to_numpy()[:, None]
    sg = sub[f"{source}_sigma"].to_numpy()[:, None]
    children = np.exp(mu + sg * z_child)
    don_per_1000 = np.exp(sub["don_mu"].to_numpy()[:, None] + sub["don_sigma"].to_numpy()[:, None] * z_don)
    collections = don_per_1000 / 1000.0 * sub["population"].to_numpy()[:, None]

    r_u = shared["transfusion_rate_untreated"] / 100.0
    r_t = shared["transfusion_rate_hydroxyurea"] / 100.0
    hu = shared["share_on_hydroxyurea"]
    units = shared["units_per_event"]
    events = (1 - hu) * r_u + hu * r_t
    demand = children * shared["share_diagnosed"] * events * units
    univ_no_hu = children * r_u * units
    univ_hu = children * ((1 - hu_univ) * r_u + hu_univ * r_t) * units
    gap = demand * target
    donors = gap / (1 - shared["donor_deferral_rate"])

    draws = {
        "children": children,
        "diagnosed": children * shared["share_diagnosed"],
        "demand_units": demand,
        "gap_units": gap,
        "donors_needed": donors,
        "collections": collections,
        "pct_of_collections": demand / collections,
        "universal_demand_units": univ_hu,
        "universal_no_hu_demand_units": univ_no_hu,
        "units_avoided_by_hu": univ_no_hu - univ_hu,
    }
    return SimResult(iso3=list(sub.index), draws=draws, shared=shared, source=source, n=n, seed=seed)


def summarise(sim: SimResult, ds: Dataset, top_k: int = 10, rank_by: str = "gap_units") -> list[dict]:
    """Per-country P10/P50/P90 for every metric, status flags, and rank stability."""
    df = ds.countries.loc[sim.iso3]
    out_q = {m: _pcts(a, axis=1) for m, a in sim.draws.items()}
    # rank stability: in each draw, which countries are in the top_k by rank_by
    a = sim.draws[rank_by]
    kk = min(top_k, a.shape[0])
    order = np.argsort(-a, axis=0)               # (k, n) indices sorted desc per draw
    in_top = np.zeros_like(a, dtype=bool)
    np.put_along_axis(in_top, order[:kk], True, axis=0)
    p_top = in_top.mean(axis=1)
    exp_val = a.mean(axis=1)
    rows = []
    for i, iso in enumerate(sim.iso3):
        r = df.loc[iso]
        row = {
            "iso3": iso, "name": r["name"], "subregion": r["subregion"], "population": float(r["population"]),
            "children_status": r[f"{sim.source}_status"], "donations_status": r["donations_status"],
            "who_year": None if pd.isna(r.get("who_year")) else int(r["who_year"]),
            "expected_" + rank_by: float(exp_val[i]), "p_top_k": float(p_top[i]), "top_k": kk,
        }
        for m, q in out_q.items():
            row[m] = {"p10": float(q[0, i]), "p50": float(q[1, i]), "p90": float(q[2, i])}
        rows.append(row)
    rows.sort(key=lambda x: -x["expected_" + rank_by])
    for rank, row in enumerate(rows, 1):
        row["rank"] = rank
    return rows


def totals(sim: SimResult) -> dict:
    """Region-wide totals (sum over countries within each draw, so uncertainty is propagated correctly)."""
    out = {}
    for m, a in sim.draws.items():
        if m == "pct_of_collections":
            s = sim.draws["demand_units"].sum(0) / sim.draws["collections"].sum(0)
        else:
            s = a.sum(0)
        q = np.percentile(s, PCTS)
        out[m] = {"p10": float(q[0]), "p50": float(q[1]), "p90": float(q[2])}
    return out


def admin1_breakdown(sim: SimResult, ds: Dataset, iso3: str, metric: str = "gap_units") -> dict:
    if ds.admin1_shares is None:
        raise ValueError(ds.facilities_error or "facility data not loaded")
    if iso3 not in sim.iso3:
        raise ValueError(f"{iso3} not in this simulation")
    i = sim.iso3.index(iso3)
    shares = ds.admin1_shares[ds.admin1_shares["iso3"] == iso3].copy()
    if shares.empty:
        raise ValueError(f"no admin1 regions for {iso3} in the facility file")
    rows = []
    for _, s in shares.iterrows():
        row = {"admin1": s["admin1"], "share": float(s["share"]), "n_facilities": int(s["n_facilities"])}
        for m in ["children", "demand_units", "gap_units", "donors_needed"]:
            q = np.percentile(sim.draws[m][i] * s["share"], PCTS)
            row[m] = {"p10": float(q[0]), "p50": float(q[1]), "p90": float(q[2])}
        rows.append(row)
    rows.sort(key=lambda r: -r[metric]["p50"])
    for k, r in enumerate(rows, 1):
        r["rank"] = k
    return {
        "iso3": iso3, "basis": ds.admin1_share_basis, "regions": rows,
        "note": ("ASSUMPTION: country totals are split across admin1 regions in proportion to "
                 + ("admin1 population." if ds.admin1_share_basis == "admin1_population"
                    else "the number of public health facilities (a crude proxy for population).")
                 + " The split itself carries no uncertainty, so the order within a country is fixed; "
                   "all P10-P90 ranges come from the country-level model."),
    }


def facilities_for(ds: Dataset, sim: SimResult, iso3: str, admin1: str | None, limit: int = 500) -> dict:
    if ds.facilities is None:
        raise ValueError(ds.facilities_error or "facility data not loaded")
    fac = ds.facilities[ds.facilities["iso3"] == iso3]
    if admin1:
        fac = fac[fac["admin1"] == admin1]
    br = admin1_breakdown(sim, ds, iso3)
    per = {r["admin1"]: r for r in br["regions"]}
    out = []
    for _, f in fac.head(limit).iterrows():
        reg = per.get(f["admin1"])
        if reg is None:
            continue
        nf = max(reg["n_facilities"], 1)
        out.append({
            "facility_id": int(f["facility_id"]), "name": str(f["name"]), "admin1": f["admin1"],
            "facility_type": None if pd.isna(f["facility_type"]) else str(f["facility_type"]),
            "lat": None if pd.isna(f["lat"]) else float(f["lat"]), "lon": None if pd.isna(f["lon"]) else float(f["lon"]),
            "modelled_gap_units": {k: v / nf for k, v in reg["gap_units"].items()},
        })
    return {
        "iso3": iso3, "admin1": admin1, "facilities": out, "total_in_selection": int(len(fac)),
        "note": ("MODELLED. ASSUMPTION: each admin1 region's modelled demand is spread equally across its "
                 "facilities. The facility list has no information on blood banks or SCD clinics, so this is "
                 "NOT a list of places that transfuse."),
    }


# ------------------------------------------------------------------ sensitivity (tornado)

SENS_INPUTS = ["children", "share_diagnosed", "share_on_hydroxyurea", "transfusion_rate_untreated",
               "transfusion_rate_hydroxyurea", "units_per_event", "donor_deferral_rate"]


def _deterministic(v: dict[str, np.ndarray | float], target: float) -> float:
    r_u, r_t = v["transfusion_rate_untreated"] / 100, v["transfusion_rate_hydroxyurea"] / 100
    hu = v["share_on_hydroxyurea"]
    demand = np.sum(v["children"] * v["share_diagnosed"] * ((1 - hu) * r_u + hu * r_t) * v["units_per_event"])
    return float(demand * target / (1 - v["donor_deferral_rate"]))


def sensitivity(ds: Dataset, params: dict, source: str, iso3: list[str] | None = None) -> dict:
    """One-at-a-time swing of each input between its P10 and P90, others at their central value.
    Output: annual donors needed (summed over the selected countries)."""
    df = ds.countries
    ok = df["population"].notna() & df[f"{source}_mu"].notna()
    if iso3:
        ok &= df.index.isin(iso3)
    sub = df[ok]
    mu, sg = sub[f"{source}_mu"].to_numpy(), sub[f"{source}_sigma"].to_numpy()
    target = P.central(params["target_coverage"])
    central = {k: P.central(params[k]) for k in SENS_INPUTS if k != "children"}
    central["children"] = np.exp(mu)
    lows = {k: P.quantile(params[k], 0.1) for k in SENS_INPUTS if k != "children"}
    highs = {k: P.quantile(params[k], 0.9) for k in SENS_INPUTS if k != "children"}
    lows["children"], highs["children"] = np.exp(mu - Z90 * sg), np.exp(mu + Z90 * sg)
    base = _deterministic(central, target)
    bars = []
    for k in SENS_INPUTS:
        lo = _deterministic({**central, k: lows[k]}, target)
        hi = _deterministic({**central, k: highs[k]}, target)
        label = "Children living with SCD (source interval)" if k == "children" else params[k].get("label", k)
        bars.append({"input": k, "label": label, "kind": "SOURCED" if k == "children" else params[k]["kind"],
                     "output_at_p10_input": lo, "output_at_p90_input": hi, "swing": abs(hi - lo)})
    bars.sort(key=lambda b: -b["swing"])
    return {"output": "donors_needed_per_year", "baseline": base, "bars": bars,
            "note": "One-at-a-time: each input moved to its own P10 and P90 while the others stay at their central value."}
