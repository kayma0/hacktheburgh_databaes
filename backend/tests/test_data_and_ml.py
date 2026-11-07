from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from app import loaders
from app.countries import to_iso3
from app.imputation import impute


def test_iso_aliases():
    assert to_iso3("Cote d'Ivoire") == "CIV"
    assert to_iso3("Côte d’Ivoire") == "CIV"
    assert to_iso3("Congo, Dem. Rep.") == "COD"
    assert to_iso3("Congo") == "COG"
    assert to_iso3("United Republic of Tanzania") == "TZA"
    assert to_iso3("Gambia, The") == "GMB"
    assert to_iso3("France") is None


def test_missing_real_file_fails_loudly(tmp_path):
    with pytest.raises(loaders.DataFileError) as e:
        loaders.load_who(tmp_path, sample=False)
    msg = str(e.value)
    assert "How to get it" in msg and "who_blood_donations_per_1000.csv" in msg


def _gbd(tmp_path: Path, causes):
    rows = []
    for c in causes:
        for a in ["<5 years", "5-9 years", "10-14 years"]:
            rows.append({"measure_name": "Prevalence", "metric_name": "Number", "sex_name": "Both",
                         "location_name": "Nigeria", "age_name": a, "cause_name": c, "year": 2021,
                         "val": 100.0, "lower": 50.0, "upper": 200.0})
    pd.DataFrame(rows).to_csv(tmp_path / "gbd_scd_2021.csv", index=False)


def test_gbd_rejects_aggregate_with_trait(tmp_path):
    _gbd(tmp_path, ["Sickle cell disorders"])
    with pytest.raises(loaders.DataFileError, match="trait"):
        loaders.load_gbd(tmp_path)


def test_gbd_excludes_trait_and_aggregate(tmp_path):
    _gbd(tmp_path, ["Sickle cell disorders", "Sickle cell trait", "Homozygous sickle cell and severe sickle cell beta thalassemia"])
    g = loaders.load_gbd(tmp_path)
    assert g.loc[0, "iso3"] == "NGA"
    assert g.loc[0, "value"] == pytest.approx(300.0)   # 3 age groups x 1 sub-cause


def test_world_bank_wide_population(tmp_path):
    p = tmp_path / "population.csv"
    p.write_text('"Data Source","World Development Indicators",\n\n"Last Updated Date","2026-01-01",\n\n'
                 '"Country Name","Country Code","Indicator Name","Indicator Code","2022","2023",\n'
                 '"Ghana","GHA","Population, total","SP.POP.TOTL","33000000","33500000",\n')
    df = loaders.load_population(tmp_path)
    assert df.loc[0, "iso3"] == "GHA" and df.loc[0, "population"] == 33500000 and df.loc[0, "population_year"] == 2023


def test_invalid_interval_rejected(tmp_path):
    pd.DataFrame({"country": ["Ghana"], "value": [100], "lower": [150], "upper": [200]}).to_csv(
        tmp_path / "lancet_child_2026_country.csv", index=False)
    with pytest.raises(loaders.DataFileError, match="invalid intervals"):
        loaders.load_lancet(tmp_path)


def test_imputation_is_calibrated_and_beats_baseline():
    rng = np.random.default_rng(0)
    n = 48
    df = pd.DataFrame({
        "population": np.exp(rng.uniform(13, 19, n)),
        "vnrd_share": rng.uniform(0, 1, n),
        "subregion": rng.choice(["A", "B", "C"], n),
        "income_group": rng.choice(["Low", "Lower middle"], n),
    }, index=[f"C{i}" for i in range(n)])
    signal = 0.6 * (np.log(df["population"]) - 16) + 1.5 * df["vnrd_share"] + (df["subregion"] == "A") * 0.8
    df["y"] = np.exp(1 + signal + rng.normal(0, 0.15, n))
    truth = df["y"].copy()
    df.loc[df.index[:6], "y"] = np.nan
    r = impute(df, "y")
    assert r.n_train == 42
    assert r.loco_mae < r.baseline_mae
    assert r.conformal_coverage_80 >= 0.75
    assert set(r.predictions.index) == set(df.index[:6])        # only the missing rows are imputed
    p = r.predictions
    assert ((p["p10"] <= p["p50"]) & (p["p50"] <= p["p90"])).all()
    inside = ((truth[p.index] >= p["p10"]) & (truth[p.index] <= p["p90"])).mean()
    assert inside >= 0.5


def test_dataset_flags_imputed_values(ds):
    c = ds.countries
    for col in ["donations_status", "lancet_status", "gbd_status"]:
        assert set(c[col].unique()) <= {"observed", "ml_imputed", "missing"}
    assert (c["donations_status"] == "ml_imputed").any()
    assert ds.is_sample
