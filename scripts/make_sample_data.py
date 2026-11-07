"""Generate PLACEHOLDER *_SAMPLE.csv files for the offline demo (DATA_MODE=sample).

These numbers are random placeholders, NOT estimates of anything. They exist only so the app can be
demonstrated without the real files. The UI shows a SAMPLE DATA banner whenever they are in use.
Some countries are deliberately left out of some files so the ML imputation path is exercised.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.countries import SSA_COUNTRIES  # noqa: E402

OUT = ROOT / "data" / "sample"
OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(12345)
isos = list(SSA_COUNTRIES)
names = [SSA_COUNTRIES[i][0] for i in isos]

pop = np.round(np.exp(rng.uniform(np.log(1e5), np.log(2e8), len(isos))))
pd.DataFrame({"iso3": isos, "country": names, "year": 2023, "population": pop}).to_csv(OUT / "population_SAMPLE.csv", index=False)

groups = ["Low income", "Lower middle income", "Upper middle income", "High income"]
pd.DataFrame({"Country Code": isos, "TableName": names,
              "IncomeGroup": rng.choice(groups, len(isos), p=[0.45, 0.35, 0.17, 0.03])}).to_csv(
    OUT / "country_metadata_SAMPLE.csv", index=False)

# WHO-style donations: leave ~10 countries out
keep = rng.random(len(isos)) > 0.2
pd.DataFrame({"country": np.array(names)[keep], "year": 2022,
              "donations_per_1000": np.round(rng.uniform(1, 12, keep.sum()), 1),
              "vnrd_share": np.where(rng.random(keep.sum()) > 0.25, np.round(rng.uniform(0.2, 1.0, keep.sum()), 2), np.nan)}
             ).to_csv(OUT / "who_blood_donations_per_1000_SAMPLE.csv", index=False)

# placeholder child SCD rate per 1000 population
rate = rng.uniform(0.5, 12, len(isos))
rows = []
ages, causes = ["<5 years", "5-9 years", "10-14 years"], ["Sample sub-cause A", "Sample sub-cause B"]
for iso, name, p, r in zip(isos, names, pop, rate):
    if rng.random() < 0.15:
        continue
    total = p / 1000 * r
    for a in ages:
        for c in causes:
            v = total / 6 * rng.uniform(0.7, 1.3)
            rows.append({"measure_name": "Prevalence", "location_name": name, "sex_name": "Both", "age_name": a,
                         "cause_name": c, "metric_name": "Number", "year": 2021,
                         "val": round(v, 1), "lower": round(v * rng.uniform(0.4, 0.8), 1), "upper": round(v * rng.uniform(1.3, 2.2), 1)})
pd.DataFrame(rows).to_csv(OUT / "gbd_scd_2021_SAMPLE.csv", index=False)

lrows = []
for iso, name, p, r in zip(isos, names, pop, rate):
    if rng.random() < 0.25:
        continue
    v = p / 1000 * r * rng.uniform(0.6, 1.6)
    lrows.append({"country": name, "iso3": iso, "value": round(v), "lower": round(v * rng.uniform(0.3, 0.7)),
                  "upper": round(v * rng.uniform(1.5, 3.0)), "year": 2021})
pd.DataFrame(lrows).to_csv(OUT / "lancet_child_2026_country_SAMPLE.csv", index=False)

# facilities: invented region names, no coordinates (we will not invent locations)
frows = []
for name in names:
    for j in range(int(rng.integers(3, 7))):
        for k in range(int(rng.integers(5, 40))):
            frows.append({"Country": name, "Admin1": f"Sample Region {chr(65 + j)}",
                          "Facility name": f"Sample Facility {chr(65 + j)}{k + 1}", "Facility type": "Sample",
                          "Lat": None, "Long": None})
pd.DataFrame(frows).to_csv(OUT / "facilities_SAMPLE.csv", index=False)
print(f"wrote placeholder sample files to {OUT}")
