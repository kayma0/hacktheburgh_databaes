# Method

This app estimates blood demand from sickle cell disease (SCD) and the donors needed to
cover a chosen share of that demand. Every output is a MODELLED estimate with uncertainty,
never a single point figure.

## Data sources

- `data/raw/burden.csv` — affected children per country (P50, 2.5th/97.5th percentile).
  Source: GBD 2021 / Lancet Child & Adolescent Health SCD burden estimates. Until real data
  is placed there, `burden_SAMPLE.csv` is used and the UI shows a SAMPLE DATA banner.
- `data/raw/who_blood.csv` — **real data**, replacing the sample. National whole-blood
  donation totals for 2018, from WHO, *Global status report on blood safety and
  availability 2021* (Annex 3, "Blood donations 2014–2018"),
  https://www.who.int/publications/i/item/9789240051683. `donations_per_1000` is
  computed from that total and the matching UN WPP 2024 mid-year population estimate
  (see `un_wpp_population_projections.csv` below). Caveat: Nigeria's figure is flagged
  `partial_national_coverage` in the source report (not all facilities reported), so it
  likely understates the true national rate.
- `data/raw/parameters.yaml` — min/mode/max for each model parameter with a source, or
  `ASSUMPTION` if none was found.
- `data/raw/africa_hotspot.csv` — national sickle cell anaemia (SCA) birth frequency and
  projected newborns with SCA, 2010 vs. 2050, plus each country's global rank by
  cumulative SCA births 2010–2050. Source: Piel FB et al. (2013), "Global Epidemiology
  of Sickle Haemoglobin in Neonates," *PLOS Medicine* 10(7):e1001484, Table S2,
  https://doi.org/10.1371/journal.pmed.1001484.s003. Not yet wired into the backend —
  intended for the planned Africa hotspots page. Note: this paper's own population
  projections date from ~2013 (pre-dating UN WPP 2024), so for forward projections
  prefer combining its SCA *frequency* (which is a biological/genetic rate, not
  time-sensitive) with current UN WPP birth projections below, rather than using its
  2050 birth figures directly.
- `data/raw/un_wpp_population_projections.csv` — population, births, under-5 deaths and
  under-5 mortality rate (Q5) per country, 2015–2050, medium-variant projection. Source:
  UN World Population Prospects 2024, https://population.un.org/wpp/. Intended for
  scaling future SCA case/mortality projections on the hotspots page.
- Untreated child mortality for the hotspots page: no file yet, but the citable estimate
  is Grosse SD et al. (2011), "Sickle Cell Disease in Africa: A Neglected Cause of Early
  Childhood Mortality," *Am J Prev Med* 41(6 Suppl 4):S398-405 (free full text:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC3708126) — 50%–90% of children born with SCA
  in Africa die before age 5 without diagnosis/treatment. The authors themselves flag
  the underlying data as weak, so treat this as a wide-uncertainty triangular
  distribution (e.g. min 0.50 / mode 0.70 / max 0.90), not a point estimate.
- `burden.csv` is still the sample (GBD 2021 Results Tool requires a free account and an
  interactive query — see project notes for exact filter settings to export the real
  file).

## Model

`backend/app/model.py` draws 10,000 Monte Carlo samples (fixed seed `20261107`):

1. Affected children ~ lognormal fitted to the P50 and 95% interval from `burden.csv`.
2. Diagnosed children = affected children × `share_diagnosed` (ASSUMPTION, adjustable).
3. Transfusion events/year = triangular-distributed rates per 100 person-years:
   - Untreated: min 30 / mode 43.2 / max 60 (REACH trial, clinic-based children — not
     generalisable to all settings).
   - On hydroxyurea: min 6 / mode 10.8 / max 18 (REACH trial, maximum dose).
4. Units per event ~ triangular (ASSUMPTION).
5. Demand = events × units. Donors needed = demand × target coverage / (1 − donor
   deferral rate, ASSUMPTION).
6. Baseline scenario assumes current diagnosis rate and no hydroxyurea use. The
   "universal diagnosis + hydroxyurea" scenario assumes all affected children are
   diagnosed and a chosen share are on hydroxyurea.

Every output is reported as P10 / P50 / P90.

## Limits

- This is an aggregate planning tool, not a medical device, and gives no clinical advice.
- REACH trial rates come from a clinic-based cohort and may not generalise to all settings.
- Several parameters (units per event, donor deferral rate, diagnosis share, hydroxyurea
  uptake, target coverage) have no cited source and are ASSUMPTIONS — adjustable via
  sliders in the UI.
- Donations must be voluntary, unpaid, and go through a licensed national blood service.

## Hotspots page (`backend/app/hotspots.py`, reads `data/raw.csv`)

`data/raw.csv` is the GBD export of sickle cell disorders **prevalence** (number of
people, all ages, both sexes) for 54 African countries, 1996-2023, with a 95% interval.
10,000 Monte Carlo draws per country (seed `20261107`), reported as P10/P50/P90:

1. Cases today ~ lognormal matched to the 2023 value and its 95% interval.
2. Growth: log-linear trend over 2009-2023. Slope ~ normal with SD = sqrt(regression SE^2 +
   0.006^2). The 0.006 floor is an ASSUMPTION so extrapolation is not falsely tight.
3. Cases in year *t* = cases today x exp(slope x (*t* - 2023)), up to the chosen horizon.
   "Change" is cases at the horizon minus cases today.
4. Newborns with SCD per year = cases x a fraction ~ triangular(0.03, 0.05, 0.09).
   ASSUMPTION, roughly calibrated to Piel et al. 2013 (Nigeria ~ 90k SCA births in 2010
   vs ~ 1.9M GBD cases). Recalled from memory, not from a file in this repo: verify.
   Shown as the number of babies who could be reached by early screening and care.
5. Heat = sqrt(1/2 x cases today / max + 1/2 x max(change, 0) / max).

Not modelled: the effect of screening or treatment, migration, changes in survival or
birth rates over time, and any difference between SCD and SCA (the data counts all
sickle cell disorders; the birth fraction is calibrated on SCA).

## Pre-built data files (`scripts/build_data.py`)

Run `python scripts/build_data.py` to regenerate both files from the GBD exports in
`data/`. No dependencies beyond the standard library; the output is deterministic.

### `data/processed/usecases.json`

100 likely sickle-cell patient personas per country (`age_group`, `sex`, `blood_ml`,
`units`). The age and sex mix is **real**: the 2023 GBD prevalence distribution over the
seven GBD age groups by sex, allocated to 100 whole personas by the largest-remainder
method, so the set mirrors who actually lives with the disease in that country rather
than a random draw. The profiles differ sharply and meaningfully — Nigeria comes out
child-heavy (≈55 of 100 under 10), Algeria adult-heavy (≈45 of 100 aged 20+), which
tracks differences in survival to adulthood.

`blood_ml` is an **ASSUMPTION**, not data: red cells transfused in one acute episode.
Children are dosed by weight (10-15 mL/kg red cells) and adults in whole units, so the
dose rises steeply with age — 75 mL under 1 year to 620 mL at 20+. Adolescent and adult
women get ×0.9 for lower average body weight. Per-age min/max bounds are in the file's
`meta.blood_ml_assumption` for a UI that wants to show a range. These figures are
consistent with `units_per_crisis_by_age` in `backend/app/model.py` at ~250 mL per unit.
The file describes one episode per patient, not annual demand — episode *frequency* is
the model's job (see above).

### `data/processed/heatmap.json`

People living with SCD per country in the target year (default: the current year),
projected from `data/raw.csv` by a log-linear trend fitted over the last 10 years of
history and extrapolated past 2023. Fitted growth rates land between −3.1% and +4.0% a
year, so no country's projection is implausible. Per country: `iso3` (for the map),
`cases`, `cases_low`/`cases_high`, `growth_pct_per_year`, `intensity` and `bucket`.

`cases_low`/`cases_high` carry the 2023 GBD 95% interval forward at its original
relative width. It covers uncertainty in today's count but **not** in the trend, so it
is a floor on the true uncertainty, narrower than the Monte Carlo interval
`hotspots.py` produces for the same quantity.

No population denominator is available in these exports, so the map shows **absolute
cases, not prevalence per 100k**. For blood-supply planning that is the wanted quantity:
units needed scale with the number of patients, not with how common the disease is.

Cases span four orders of magnitude (0 in Seychelles to ≈3.0M in Nigeria), so
`intensity` is log-scaled 0-1 (floored at 1 case) for direct use in a colour ramp — on a
linear scale every country but Nigeria would be the same shade. `bucket` gives a fixed
five-band legend (<1k / <10k / <100k / <500k / rest) that stays stable between runs;
the thresholds are in `meta.scale.buckets`.
