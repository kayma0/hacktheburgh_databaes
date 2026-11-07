"""Assemble the per-country input table from all sources, then fill gaps with labelled ML imputation."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import loaders
from .config import Settings
from .countries import SSA_COUNTRIES
from .imputation import ImputationResult, impute, lognormal_from_quantiles

BURDEN_LOADERS = {"lancet": loaders.load_lancet, "gbd": loaders.load_gbd}
Z95 = 1.959963984540054


@dataclass
class Dataset:
    countries: pd.DataFrame
    sources: list[str]
    is_sample: bool
    facilities: pd.DataFrame | None = None
    facilities_error: str | None = None
    admin1_shares: pd.DataFrame | None = None
    admin1_share_basis: str | None = None
    imputation: dict[str, ImputationResult] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    excluded: dict[str, str] = field(default_factory=dict)


def build_dataset(settings: Settings) -> Dataset:
    d, s = settings.data_dir, settings.is_sample
    warnings: list[str] = []

    base = pd.DataFrame(
        [{"iso3": k, "name": v[0], "subregion": v[1]} for k, v in SSA_COUNTRIES.items()]
    ).set_index("iso3")

    # core files: raise DataFileError (loud) if missing
    pop = loaders.load_population(d, s, settings.reference_year).set_index("iso3")
    who = loaders.load_who(d, s, settings.reference_year).set_index("iso3")
    meta = loaders.load_metadata(d, s).set_index("iso3")
    burden: dict[str, pd.DataFrame] = {}
    burden_errors = []
    for name, fn in BURDEN_LOADERS.items():
        try:
            burden[name] = fn(d, s).set_index("iso3")
        except loaders.DataFileError as e:
            burden_errors.append(str(e))
    if not burden:
        raise loaders.DataFileError("No burden source could be loaded. At least one is required.\n\n" + "\n\n".join(burden_errors))
    for e in burden_errors:
        warnings.append("Burden source not loaded: " + e.splitlines()[0])

    df = base.join(pop).join(meta).join(who)
    df["income_group"] = df["income_group"].fillna("Unknown")
    excluded = {iso: "no population figure" for iso in df.index[df["population"].isna()]}

    # ---- national donations
    df["donations_status"] = np.where(df["donations_per_1000"].notna(), "observed", "missing")
    df["don_mu"] = np.log(df["donations_per_1000"].where(df["donations_per_1000"] > 0))
    df["don_sigma"] = 0.0
    df["don_p10"] = df["donations_per_1000"]
    df["don_p90"] = df["donations_per_1000"]
    results: dict[str, ImputationResult] = {}
    r = impute(df, "donations_per_1000")
    results["donations_per_1000"] = r
    for iso, row in r.predictions.iterrows():
        mu, sg = lognormal_from_quantiles(row.p10, row.p50, row.p90)
        df.loc[iso, ["donations_per_1000", "don_mu", "don_sigma", "don_p10", "don_p90"]] = [row.p50, mu, sg, row.p10, row.p90]
        df.loc[iso, "donations_status"] = "ml_imputed"

    # ---- children living with SCD, per source
    for name, b in burden.items():
        df[f"{name}_value"] = b["value"]
        df[f"{name}_lower"] = b["lower"]
        df[f"{name}_upper"] = b["upper"]
        df[f"{name}_rate"] = b["value"] / df["population"] * 1000.0
        df[f"{name}_status"] = np.where(df[f"{name}_value"].notna(), "observed", "missing")
        df[f"{name}_mu"] = np.log(df[f"{name}_value"])
        df[f"{name}_sigma"] = (np.log(df[f"{name}_upper"]) - np.log(df[f"{name}_lower"])) / (2 * Z95)
        if b.attrs.get("unmatched_names"):
            warnings.append(f"{name}: names not matched to a sub-Saharan country and ignored: {b.attrs['unmatched_names'][:10]}")
    for name in burden:
        others = [o for o in burden if o != name]
        extra = []
        if others:
            df["other_log_rate"] = np.log(df[f"{others[0]}_rate"])
            extra = ["other_log_rate"]
        r = impute(df, f"{name}_rate", feature_extra=extra)
        results[f"{name}_children_per_1000"] = r
        for iso, row in r.predictions.iterrows():
            popk = df.loc[iso, "population"] / 1000.0
            p10, p50, p90 = row.p10 * popk, row.p50 * popk, row.p90 * popk
            mu, sg = lognormal_from_quantiles(p10, p50, p90)
            lo, hi = np.exp(mu - Z95 * sg), np.exp(mu + Z95 * sg)
            df.loc[iso, [f"{name}_value", f"{name}_lower", f"{name}_upper", f"{name}_mu", f"{name}_sigma"]] = [p50, lo, hi, mu, sg]
            df.loc[iso, f"{name}_status"] = "ml_imputed"
    df = df.drop(columns=["other_log_rate"], errors="ignore")

    ds = Dataset(countries=df, sources=list(burden), is_sample=s, imputation=results, warnings=warnings, excluded=excluded)

    # ---- facilities (optional feature: error kept and surfaced, not swallowed)
    try:
        fac = loaders.load_facilities(d, s)
        ds.facilities = fac
        if not fac.attrs.get("has_coordinates"):
            warnings.append("Facility file has no latitude/longitude columns: facilities cannot be mapped.")
        elif fac.attrs.get("rows_without_coordinates"):
            warnings.append(f"{fac.attrs['rows_without_coordinates']} facilities have no coordinates.")
        counts = fac.groupby(["iso3", "admin1"]).size().rename("n_facilities").reset_index()
        counts["share"] = counts["n_facilities"] / counts.groupby("iso3")["n_facilities"].transform("sum")
        ds.admin1_shares = counts
        ds.admin1_share_basis = "facility_count"
        apop = d / ("admin1_population_SAMPLE.csv" if s else "admin1_population.csv")
        if apop.exists():
            ap = pd.read_csv(apop)
            from .countries import to_iso3
            ap["iso3"] = ap["iso3"].map(to_iso3) if "iso3" in ap.columns else ap["country"].map(to_iso3)
            ap["admin1"] = ap["admin1"].astype(str).str.strip()
            ap["share"] = ap["population"] / ap.groupby("iso3")["population"].transform("sum")
            merged = counts.drop(columns="share").merge(ap[["iso3", "admin1", "share"]], on=["iso3", "admin1"], how="outer")
            merged["n_facilities"] = merged["n_facilities"].fillna(0).astype(int)
            ds.admin1_shares = merged.dropna(subset=["share"])
            ds.admin1_share_basis = "admin1_population"
    except loaders.DataFileError as e:
        ds.facilities_error = str(e)
    return ds
