"""Loaders and validators for every input file.

Rule: no fabricated data. If a real file is missing or malformed, raise DataFileError with
instructions on where to get it. Placeholder files only exist as *_SAMPLE.* in data/sample/
and are only used when DATA_MODE=sample (the UI then shows a SAMPLE DATA banner).
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd

from .countries import SSA_COUNTRIES, to_iso3


class DataFileError(RuntimeError):
    """A required input file is missing or invalid. The message tells the user how to fix it."""


@dataclass(frozen=True)
class FileSpec:
    key: str
    filename: str
    sample_filename: str | None
    required_for: str
    how_to_get: str


FILES: dict[str, FileSpec] = {
    "gbd": FileSpec(
        "gbd", "gbd_scd_2021.csv", "gbd_scd_2021_SAMPLE.csv",
        "burden source 'gbd' (at least one burden source is required)",
        "GBD Results Tool (https://vizhub.healthdata.org/gbd-results/): GBD 2021, measure=Prevalence, metric=Number, "
        "cause = the sickle cell sub-causes EXCLUDING sickle cell trait, sex=Both, age=<5, 5-9, 10-14 years, "
        "locations = sub-Saharan African countries. Keep the default columns (location_name, age_name, val, upper, lower ...).",
    ),
    "lancet": FileSpec(
        "lancet", "lancet_child_2026_country.csv", "lancet_child_2026_country_SAMPLE.csv",
        "burden source 'lancet' (at least one burden source is required)",
        "Extract the country table from the 2026 Lancet Child & Adolescent Health paper into columns: "
        "country, value, lower, upper (number of children living with SCD and its 95% interval). "
        "Optional: iso3, metric, age_group, year.",
    ),
    "who": FileSpec(
        "who", "who_blood_donations_per_1000.csv", "who_blood_donations_per_1000_SAMPLE.csv",
        "national collections comparison and donor planning",
        "From WHO Global Status Report on Blood Safety and Availability / WHO GHO: columns "
        "country, year, donations_per_1000, vnrd_share (share of donations from voluntary non-remunerated donors).",
    ),
    "population": FileSpec(
        "population", "population.csv", "population_SAMPLE.csv",
        "turning donations per 1,000 into total national collections",
        "World Bank SP.POP.TOTL CSV download (wide format is fine) or UN WPP 2024 total population, "
        "long format with columns country (or iso3), year, population.",
    ),
    "meta": FileSpec(
        "meta", "country_metadata.csv", "country_metadata_SAMPLE.csv",
        "ML imputation covariates (income group)",
        "World Bank 'Metadata_Country_*.csv' (inside the SP.POP.TOTL zip): needs Country Code and IncomeGroup.",
    ),
    "facilities": FileSpec(
        "facilities", "sub-saharan_health_facilities.xlsx", "facilities_SAMPLE.csv",
        "admin1 breakdown and facility list",
        "HDX: 'A spatial database of health facilities managed by the public health sector in sub-Saharan Africa' "
        "(Maina et al. 2019), file sub-saharan_health_facilities.xlsx.",
    ),
    "geo_admin0": FileSpec(
        "geo_admin0", "africa_admin0.geojson", None,
        "country choropleth map (optional; the ranked table works without it)",
        "Natural Earth admin-0 countries (ne_50m_admin_0_countries) filtered to Africa, or geoBoundaries ADM0, "
        "saved as GeoJSON with an ISO3 property (ISO_A3, ADM0_A3, shapeGroup or iso3).",
    ),
}

GBD_REQUIRED = ["location_name", "age_name", "val", "upper", "lower"]
DEFAULT_CHILD_AGES = ["<5 years", "5-9 years", "10-14 years"]


def _path(key: str, data_dir: Path, sample: bool) -> Path:
    spec = FILES[key]
    name = spec.sample_filename if (sample and spec.sample_filename) else spec.filename
    return data_dir / name


def _missing(key: str, path: Path) -> DataFileError:
    s = FILES[key]
    return DataFileError(
        f"Missing data file: {path}\n  Needed for: {s.required_for}\n  How to get it: {s.how_to_get}\n"
        f"  Or run the offline demo with DATA_MODE=sample (shows a SAMPLE DATA banner)."
    )


def _need_cols(df: pd.DataFrame, cols: list[str], path: Path) -> None:
    miss = [c for c in cols if c not in df.columns]
    if miss:
        raise DataFileError(f"{path.name}: missing columns {miss}. Found columns: {list(df.columns)}")


def _attach_iso(df: pd.DataFrame, path: Path, name_col: str = "country") -> pd.DataFrame:
    if "iso3" in df.columns:
        df["iso3"] = df["iso3"].map(lambda v: to_iso3(v))
    else:
        _need_cols(df, [name_col], path)
        df["iso3"] = df[name_col].map(to_iso3)
    unmatched = sorted(set(df.loc[df["iso3"].isna(), name_col if name_col in df.columns else "iso3"].astype(str)))
    df = df[df["iso3"].notna()].copy()
    df.attrs["unmatched_names"] = unmatched
    return df


# ---------------------------------------------------------------- burden sources

def load_gbd(data_dir: Path, sample: bool = False, child_ages: list[str] | None = None,
             year: int | None = None) -> pd.DataFrame:
    """Children living with SCD per country from a GBD Results Tool export.

    Returns columns iso3, value, lower, upper, year, source.
    Intervals are summed across age groups and sub-causes, which is conservative (wider than the true interval).
    """
    path = _path("gbd", data_dir, sample)
    if not path.exists():
        raise _missing("gbd", path)
    df = pd.read_csv(path)
    _need_cols(df, GBD_REQUIRED, path)
    ages = child_ages or [a.strip() for a in os.environ.get("CHILD_AGE_GROUPS", "").split(",") if a.strip()] or DEFAULT_CHILD_AGES

    if "measure_name" in df.columns:
        df = df[df["measure_name"].str.lower() == "prevalence"]
    if "metric_name" in df.columns:
        df = df[df["metric_name"].str.lower() == "number"]
    if "sex_name" in df.columns:
        if (df["sex_name"].str.lower() == "both").any():
            df = df[df["sex_name"].str.lower() == "both"]
        # otherwise male + female rows are summed below
    if "cause_name" in df.columns:
        df = df[~df["cause_name"].str.lower().str.contains("trait")]
        is_agg = df["cause_name"].str.lower().str.strip() == "sickle cell disorders"
        if is_agg.all() and len(df):
            raise DataFileError(
                f"{path.name}: only the aggregate cause 'Sickle cell disorders' is present. In GBD this aggregate "
                "includes sickle cell trait, which would hugely overstate disease. Re-export the sub-causes "
                "(homozygous SCD and severe sickle beta-thalassaemia, sickle-haemoglobin C disease, "
                "mild sickle beta-thalassaemia) without trait.")
        df = df[~is_agg]
    present_ages = sorted(df["age_name"].unique())
    df = df[df["age_name"].isin(ages)]
    if df.empty:
        raise DataFileError(f"{path.name}: no rows for child age groups {ages}. Age groups in file: {present_ages}. "
                            "Set CHILD_AGE_GROUPS in .env to match.")
    if "year" in df.columns:
        target = year or int(df["year"].max())
        df = df[df["year"] == target]
    else:
        target = None
    df = df.rename(columns={"location_name": "country"})
    df = _attach_iso(df, path)
    g = df.groupby("iso3", as_index=False)[["val", "lower", "upper"]].sum()
    g = g.rename(columns={"val": "value"})
    g["year"] = target
    g["source"] = "gbd"
    _check_intervals(g, path)
    g.attrs["child_ages"] = ages
    return g


def load_lancet(data_dir: Path, sample: bool = False) -> pd.DataFrame:
    path = _path("lancet", data_dir, sample)
    if not path.exists():
        raise _missing("lancet", path)
    df = pd.read_csv(path)
    _need_cols(df, ["value", "lower", "upper"], path)
    if "metric" in df.columns and df["metric"].nunique() > 1:
        wanted = os.environ.get("LANCET_METRIC")
        if not wanted:
            raise DataFileError(f"{path.name}: several metrics {sorted(df['metric'].unique())}. Set LANCET_METRIC in .env "
                                "to the one meaning 'number of children living with SCD'.")
        df = df[df["metric"] == wanted]
    df = _attach_iso(df, path)
    if df["iso3"].duplicated().any():
        raise DataFileError(f"{path.name}: more than one row per country after filtering: "
                            f"{sorted(df.loc[df['iso3'].duplicated(), 'iso3'])}")
    out = df[["iso3", "value", "lower", "upper"]].copy()
    out["year"] = df["year"] if "year" in df.columns else None
    out["source"] = "lancet"
    _check_intervals(out, path)
    return out


def _check_intervals(df: pd.DataFrame, path: Path) -> None:
    for c in ["value", "lower", "upper"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    bad = df[(df["value"] <= 0) | (df["lower"] <= 0) | (df["lower"] > df["value"]) | (df["value"] > df["upper"])]
    if len(bad):
        raise DataFileError(f"{path.name}: invalid intervals (need 0 < lower <= value <= upper) for {list(bad['iso3'])}")


# ---------------------------------------------------------------- blood, population, metadata

def load_who(data_dir: Path, sample: bool = False, year: int | None = None) -> pd.DataFrame:
    path = _path("who", data_dir, sample)
    if not path.exists():
        raise _missing("who", path)
    df = pd.read_csv(path)
    _need_cols(df, ["country", "year", "donations_per_1000"], path)
    df = _attach_iso(df, path)
    df["donations_per_1000"] = pd.to_numeric(df["donations_per_1000"], errors="coerce")
    if "vnrd_share" not in df.columns:
        df["vnrd_share"] = np.nan
    df["vnrd_share"] = pd.to_numeric(df["vnrd_share"], errors="coerce")
    if df["vnrd_share"].max(skipna=True) > 1.0:
        df["vnrd_share"] = df["vnrd_share"] / 100.0
    if (df["donations_per_1000"] < 0).any() or (df["vnrd_share"] > 1).any():
        raise DataFileError(f"{path.name}: negative donations or vnrd_share > 100%")
    if year:
        df = df[df["year"] <= year]
    df = df.dropna(subset=["donations_per_1000"]).sort_values("year").groupby("iso3", as_index=False).last()
    return df[["iso3", "year", "donations_per_1000", "vnrd_share"]].rename(columns={"year": "who_year"})


def load_population(data_dir: Path, sample: bool = False, year: int | None = None) -> pd.DataFrame:
    path = _path("population", data_dir, sample)
    if not path.exists():
        raise _missing("population", path)
    with open(path, encoding="utf-8-sig") as f:
        first = f.readline()
    if first.startswith('"Data Source"') or first.startswith("Data Source"):
        df = pd.read_csv(path, skiprows=4)
    else:
        df = pd.read_csv(path)
    if "Country Code" in df.columns:  # World Bank wide format
        years = [c for c in df.columns if str(c).strip().isdigit()]
        df = df.melt(id_vars=["Country Code"], value_vars=years, var_name="year", value_name="population")
        df = df.rename(columns={"Country Code": "iso3"})
        df["year"] = df["year"].astype(int)
    _need_cols(df, ["year", "population"], path)
    df = _attach_iso(df, path)
    df["population"] = pd.to_numeric(df["population"], errors="coerce")
    df = df.dropna(subset=["population"])
    if year:
        df = df[df["year"] <= year]
    df = df.sort_values("year").groupby("iso3", as_index=False).last()
    return df[["iso3", "year", "population"]].rename(columns={"year": "population_year"})


def load_metadata(data_dir: Path, sample: bool = False) -> pd.DataFrame:
    path = _path("meta", data_dir, sample)
    if not path.exists():
        raise _missing("meta", path)
    df = pd.read_csv(path, encoding="utf-8-sig")
    df = df.rename(columns={"Country Code": "iso3", "IncomeGroup": "income_group", "TableName": "country"})
    _need_cols(df, ["income_group"], path)
    df = _attach_iso(df, path)
    df["income_group"] = df["income_group"].fillna("Unknown")
    return df[["iso3", "income_group"]].drop_duplicates("iso3")


# ---------------------------------------------------------------- facilities

_LAT = ["lat", "latitude", "y"]
_LON = ["long", "lon", "longitude", "lng", "x"]


def load_facilities(data_dir: Path, sample: bool = False) -> pd.DataFrame:
    path = _path("facilities", data_dir, sample)
    if not path.exists():
        raise _missing("facilities", path)
    df = pd.read_excel(path) if path.suffix in (".xlsx", ".xls") else pd.read_csv(path)
    cols = {c.lower().strip(): c for c in df.columns}
    if "country" not in cols or "admin1" not in cols:
        raise DataFileError(f"{path.name}: need 'Country' and 'Admin1' columns. Found {list(df.columns)}")
    lat = next((cols[c] for c in _LAT if c in cols), None)
    lon = next((cols[c] for c in _LON if c in cols), None)
    name = next((cols[c] for c in ["facility name", "facility_name", "name"] if c in cols), None)
    ftype = next((cols[c] for c in ["facility type", "facility_type", "type"] if c in cols), None)
    out = pd.DataFrame({
        "country": df[cols["country"]],
        "admin1": df[cols["admin1"]].astype(str).str.strip(),
        "name": df[name] if name else "(unnamed)",
        "facility_type": df[ftype] if ftype else None,
        "lat": pd.to_numeric(df[lat], errors="coerce") if lat else np.nan,
        "lon": pd.to_numeric(df[lon], errors="coerce") if lon else np.nan,
    })
    out = _attach_iso(out, path)
    out.attrs["has_coordinates"] = bool(lat and lon)
    out.attrs["coordinate_columns"] = [lat, lon]
    out.attrs["rows_without_coordinates"] = int(out["lat"].isna().sum())
    out = out.reset_index(drop=True)
    out["facility_id"] = out.index.astype(int)
    return out


def load_geojson_admin0(raw_dir: Path) -> dict:
    path = raw_dir / FILES["geo_admin0"].filename
    if not path.exists():
        raise _missing("geo_admin0", path)
    with open(path) as f:
        gj = json.load(f)
    keys = ["iso3", "ISO_A3", "ADM0_A3", "shapeGroup", "GID_0", "iso_a3", "ISO3"]
    feats = []
    for ft in gj.get("features", []):
        props = ft.get("properties") or {}
        iso = None
        for k in keys:
            if props.get(k) and to_iso3(str(props[k])):
                iso = to_iso3(str(props[k]))
                break
        if iso is None:
            iso = to_iso3(props.get("NAME") or props.get("name") or props.get("ADMIN") or props.get("shapeName"))
        if iso in SSA_COUNTRIES:
            ft["properties"] = {"iso3": iso, "name": SSA_COUNTRIES[iso][0]}
            feats.append(ft)
    if not feats:
        raise DataFileError(f"{path.name}: no features matched sub-Saharan ISO3 codes. Check the ISO property name.")
    return {"type": "FeatureCollection", "features": feats}


def file_status(data_dir: Path, raw_dir: Path, sample: bool) -> list[dict]:
    rows = []
    for key, spec in FILES.items():
        p = raw_dir / spec.filename if key == "geo_admin0" else _path(key, data_dir, sample)
        rows.append({"key": key, "file": p.name, "present": p.exists(), "required_for": spec.required_for,
                     "how_to_get": spec.how_to_get, "is_sample": "_SAMPLE" in p.name})
    return rows
