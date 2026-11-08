"""Builds the two data files the app needs from the GBD exports in data/.

    python scripts/build_data.py [--year 2026]

Inputs (GBD 2021, sickle cell disorders, prevalence as number of people):
  data/raw.csv                 all ages, both sexes, per country and year, 95% interval
  data/male_raw.csv            by age group, male
  data/female_raw.csv          by age group, female
  data/blood_groups_simple.json  ABO/RhD probability distribution, one global rate

Outputs:
  data/processed/usecases.json  100 likely patient personas per country
  data/processed/heatmap.json   projected cases per country for the target year

Both outputs are MODELLED estimates. See docs/METHOD.md.
"""
from __future__ import annotations

import argparse
import csv
import json
import math
from collections import defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = DATA / "processed"

# Years of history used for the log-linear trend fit.
TREND_YEARS = 10

# GBD age labels, youngest first. Kept verbatim so they match the source data.
AGE_GROUPS = [
    "<1 year",
    "12-23 months",
    "2-4 years",
    "5-9 years",
    "10-14 years",
    "15-19 years",
    "20+ years",
]

# ASSUMPTION. Red cells transfused in one acute sickle-cell episode, in millilitres.
# Not in the GBD data. Children are dosed by weight (10-15 mL/kg red cells), adults in
# whole units, so the dose rises steeply with age. `ml` is the planning figure; `min`
# and `max` bound it so the UI can show a range. Consistent with the units-per-crisis
# assumptions in backend/app/model.py at ~250 mL per red-cell unit.
BLOOD_ML = {
    "<1 year":      {"ml": 75,  "min": 60,  "max": 100},
    "12-23 months": {"ml": 120, "min": 90,  "max": 150},
    "2-4 years":    {"ml": 170, "min": 130, "max": 210},
    "5-9 years":    {"ml": 270, "min": 200, "max": 330},
    "10-14 years":  {"ml": 450, "min": 340, "max": 570},
    "15-19 years":  {"ml": 550, "min": 420, "max": 700},
    "20+ years":    {"ml": 620, "min": 500, "max": 750},
}
# ASSUMPTION: adolescent and adult women weigh less on average, so need a smaller dose.
FEMALE_DOSE_FACTOR = 0.9
FEMALE_DOSE_FROM_AGE = ("15-19 years", "20+ years")

ML_PER_UNIT = 250  # one red-cell unit, so personas can be read in units as well as mL

PERSONAS_PER_COUNTRY = 100

BLOOD_GROUPS_FILE = "blood_groups_simple.json"

# Legend bands for the map, in projected cases. Fixed and round, so the legend is
# stable between runs and readable.
BUCKETS = [
    ("very low", 1_000),
    ("low", 10_000),
    ("moderate", 100_000),
    ("high", 500_000),
    ("very high", None),
]

ISO3 = {
    "Algeria": "DZA", "Angola": "AGO", "Benin": "BEN", "Botswana": "BWA",
    "Burkina Faso": "BFA", "Burundi": "BDI", "Cabo Verde": "CPV", "Cameroon": "CMR",
    "Central African Republic": "CAF", "Chad": "TCD", "Comoros": "COM", "Congo": "COG",
    "Côte d'Ivoire": "CIV", "Democratic Republic of the Congo": "COD",
    "Djibouti": "DJI", "Egypt": "EGY", "Equatorial Guinea": "GNQ", "Eritrea": "ERI",
    "Eswatini": "SWZ", "Ethiopia": "ETH", "Gabon": "GAB", "Gambia": "GMB",
    "Ghana": "GHA", "Guinea": "GIN", "Guinea-Bissau": "GNB", "Kenya": "KEN",
    "Lesotho": "LSO", "Liberia": "LBR", "Libya": "LBY", "Madagascar": "MDG",
    "Malawi": "MWI", "Mali": "MLI", "Mauritania": "MRT", "Mauritius": "MUS",
    "Morocco": "MAR", "Mozambique": "MOZ", "Namibia": "NAM", "Niger": "NER",
    "Nigeria": "NGA", "Rwanda": "RWA", "Sao Tome and Principe": "STP",
    "Senegal": "SEN", "Seychelles": "SYC", "Sierra Leone": "SLE", "Somalia": "SOM",
    "South Africa": "ZAF", "South Sudan": "SSD", "Sudan": "SDN", "Togo": "TGO",
    "Tunisia": "TUN", "Uganda": "UGA", "United Republic of Tanzania": "TZA",
    "Zambia": "ZMB", "Zimbabwe": "ZWE",
}


def read_csv(name: str) -> list[dict]:
    path = DATA / name
    if not path.exists():
        raise FileNotFoundError(f"Missing input: {path}")
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def dose_ml(age_group: str, sex: str) -> int:
    ml = BLOOD_ML[age_group]["ml"]
    if sex == "female" and age_group in FEMALE_DOSE_FROM_AGE:
        ml *= FEMALE_DOSE_FACTOR
    return round(ml)


def allocate(weights: dict, total: int) -> dict:
    """Split `total` whole personas across cells in proportion to their weights.

    Largest-remainder method: every cell gets its floor share, then the leftovers go to
    the cells that were rounded down hardest. The result always sums to `total`, so the
    100 personas mirror the real mix as closely as 100 whole people can.
    """
    pool = sum(weights.values())
    exact = {k: total * w / pool for k, w in weights.items()}
    counts = {k: int(v) for k, v in exact.items()}
    leftover = total - sum(counts.values())
    ranked = sorted(exact, key=lambda k: exact[k] - counts[k], reverse=True)
    for k in ranked[:leftover]:
        counts[k] += 1
    return counts


def load_blood_group_probabilities() -> dict[str, float]:
    """blood_group -> probability, from data/blood_groups_simple.json.

    One global ABO/RhD distribution (not broken down by country, age or sex -- the
    source data has no such breakdown), so it is applied the same way everywhere.
    """
    path = DATA / BLOOD_GROUPS_FILE
    if not path.exists():
        raise FileNotFoundError(f"Missing input: {path}")
    with open(path, encoding="utf-8") as f:
        rows = json.load(f)
    probs = {row["blood_group"]: float(row["probability"]) for row in rows}
    total = sum(probs.values())
    if abs(total - 1.0) > 1e-3:
        raise ValueError(f"{BLOOD_GROUPS_FILE} probabilities sum to {total}, not 1.0")
    return probs


def interleave(counts: dict[str, int], total: int) -> list[str]:
    """Order `counts` items so each key is spread through the sequence instead of
    bunched into one block.

    Weighted round-robin: each step picks whichever key is furthest behind its
    proportional share so far. Used for blood group so it does not end up clustered
    with age/sex just because of the order personas happen to be built in -- blood
    group is independent of both.
    """
    eligible = {k: c for k, c in counts.items() if c > 0}
    assigned = {k: 0 for k in eligible}
    order = []
    for _ in range(total):
        pick = min(eligible, key=lambda k: (assigned[k] + 1) / eligible[k])
        order.append(pick)
        assigned[pick] += 1
    return order


def build_usecases(latest_year: int) -> dict:
    """100 personas per country, in proportion to who actually lives with the disease."""
    cases: dict[str, dict] = defaultdict(lambda: defaultdict(float))
    for name, sex in (("male_raw.csv", "male"), ("female_raw.csv", "female")):
        for r in read_csv(name):
            if int(r["year"]) == latest_year:
                cases[r["location_name"]][(r["age_name"], sex)] += float(r["val"])

    blood_probs = load_blood_group_probabilities()
    blood_counts = allocate(blood_probs, PERSONAS_PER_COUNTRY)
    # Same 100-long sequence for every country: there is no per-country blood group
    # data, so each country's personas get the one global distribution, interleaved so
    # it does not correlate with that country's particular age/sex ordering.
    blood_sequence = interleave(blood_counts, PERSONAS_PER_COUNTRY)

    countries = []
    for country in sorted(cases):
        counts = allocate(cases[country], PERSONAS_PER_COUNTRY)
        personas = []
        for age_group in AGE_GROUPS:
            for sex in ("male", "female"):
                ml = dose_ml(age_group, sex)
                for _ in range(counts.get((age_group, sex), 0)):
                    idx = len(personas)
                    personas.append({
                        "id": idx + 1,
                        "age_group": age_group,
                        "sex": sex,
                        "blood_group": blood_sequence[idx],
                        "blood_ml": ml,
                        "units": round(ml / ML_PER_UNIT, 1),
                    })
        countries.append({
            "country": country,
            "iso3": ISO3[country],
            "personas": personas,
        })

    return {
        "meta": {
            "description": (
                f"{PERSONAS_PER_COUNTRY} likely sickle-cell patient personas per "
                "country. The age and sex mix is the real GBD prevalence distribution; "
                "blood_group is a general population ABO/RhD distribution, not specific "
                "to this country or to sickle cell disease; the blood amount is a "
                "modelled assumption."
            ),
            "source": f"GBD 2021 sickle cell disorders prevalence, {latest_year}",
            "blood_group_probabilities": blood_probs,
            "blood_ml_assumption": BLOOD_ML,
            "female_dose_factor": FEMALE_DOSE_FACTOR,
            "ml_per_unit": ML_PER_UNIT,
        },
        "countries": countries,
    }


def fit_growth(years: list[int], values: list[float]) -> float:
    """Log-linear least squares. Returns the growth rate in log-points per year."""
    xs = [float(y) for y in years]
    ys = [math.log(max(v, 1e-9)) for v in values]
    mx = sum(xs) / len(xs)
    my = sum(ys) / len(ys)
    var = sum((x - mx) ** 2 for x in xs)
    if var == 0:
        return 0.0
    return sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / var


def bucket_for(value: float) -> str:
    for label, limit in BUCKETS:
        if limit is None or value < limit:
            return label
    return BUCKETS[-1][0]


def build_heatmap(target_year: int) -> dict:
    series: dict[str, dict[int, tuple[float, float, float]]] = defaultdict(dict)
    for r in read_csv("raw.csv"):
        series[r["location_name"]][int(r["year"])] = (
            float(r["val"]), float(r["lower"]), float(r["upper"])
        )

    latest_year = max(max(years) for years in series.values())
    countries = []
    for country in sorted(series):
        by_year = series[country]
        years = sorted(by_year)[-TREND_YEARS:]
        growth = fit_growth(years, [by_year[y][0] for y in years])

        val, lower, upper = by_year[latest_year]
        scale = math.exp(growth * (target_year - latest_year))
        countries.append({
            "country": country,
            "iso3": ISO3[country],
            "cases": round(val * scale),
            # The 95% interval is carried forward at its latest-year width. It covers
            # the uncertainty in today's count, not in the trend, so it is a floor.
            "cases_low": round(lower * scale),
            "cases_high": round(upper * scale),
            "growth_pct_per_year": round((math.exp(growth) - 1) * 100, 2),
        })

    # Cases span four orders of magnitude, so colour on a log scale: on a linear one
    # every country but Nigeria would be the same shade. `intensity` is 0-1, ready for
    # the UI to feed straight into a colour ramp.
    lo = math.log(max(min(c["cases"] for c in countries), 1))
    hi = math.log(max(max(c["cases"] for c in countries), 10))
    for c in countries:
        pos = (math.log(max(c["cases"], 1)) - lo) / (hi - lo)
        c["intensity"] = round(min(max(pos, 0.0), 1.0), 3)
        c["bucket"] = bucket_for(c["cases"])
    countries.sort(key=lambda c: c["cases"], reverse=True)

    return {
        "meta": {
            "description": (
                f"People living with sickle cell disorders in {target_year}, per "
                "country, projected from the GBD series. `intensity` is a log-scaled "
                "0-1 value for colouring the map; `bucket` is the legend band."
            ),
            "source": "GBD 2021 sickle cell disorders prevalence, all ages, both sexes",
            "year": target_year,
            "data_year": latest_year,
            "method": (
                f"Log-linear trend over {TREND_YEARS} years of history, extrapolated "
                f"{target_year - latest_year} years."
            ),
            "scale": {
                "field": "cases",
                "type": "log",
                "floor_cases": 1,  # intensity treats anything below this as 0
                "min": min(c["cases"] for c in countries),
                "max": max(c["cases"] for c in countries),
                "buckets": [
                    {"label": label, "max_cases": limit} for label, limit in BUCKETS
                ],
            },
        },
        "countries": countries,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--year", type=int, default=date.today().year,
        help="year to project the heatmap to (default: this year)",
    )
    target_year = parser.parse_args().year

    OUT.mkdir(parents=True, exist_ok=True)
    heatmap = build_heatmap(target_year)
    usecases = build_usecases(heatmap["meta"]["data_year"])

    for name, payload in (("usecases.json", usecases), ("heatmap.json", heatmap)):
        path = OUT / name
        with open(path, "w", encoding="utf-8") as f:
            json.dump(payload, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"{path.relative_to(ROOT)}  {len(payload['countries'])} countries"
              f"  {path.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
