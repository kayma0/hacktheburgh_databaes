# Method

This app estimates blood demand from sickle cell disease (SCD) and the donors needed to
cover a chosen share of that demand. Every output is a MODELLED estimate with uncertainty,
never a single point figure.

## Data sources

- `data/raw/burden.csv` — affected children per country (P50, 2.5th/97.5th percentile).
  Source: GBD 2021 / Lancet Child & Adolescent Health SCD burden estimates. Until real data
  is placed there, `burden_SAMPLE.csv` is used and the UI shows a SAMPLE DATA banner.
- `data/raw/who_blood.csv` — **real data**, replacing the sample. National whole-blood
  donation totals for 2018, from WHO, _Global status report on blood safety and
  availability 2021_ (Annex 3, "Blood donations 2014–2018"),
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
  of Sickle Haemoglobin in Neonates," _PLOS Medicine_ 10(7):e1001484, Table S2,
  https://doi.org/10.1371/journal.pmed.1001484.s003. Not yet wired into the backend —
  intended for the planned Africa hotspots page. Note: this paper's own population
  projections date from ~2013 (pre-dating UN WPP 2024), so for forward projections
  prefer combining its SCA _frequency_ (which is a biological/genetic rate, not
  time-sensitive) with current UN WPP birth projections below, rather than using its
  2050 birth figures directly.
- `data/raw/un_wpp_population_projections.csv` — population, births, under-5 deaths and
  under-5 mortality rate (Q5) per country, 2015–2050, medium-variant projection. Source:
  UN World Population Prospects 2024, https://population.un.org/wpp/. Intended for
  scaling future SCA case/mortality projections on the hotspots page.
- Untreated child mortality for the hotspots page: no file yet, but the citable estimate
  is Grosse SD et al. (2011), "Sickle Cell Disease in Africa: A Neglected Cause of Early
  Childhood Mortality," _Am J Prev Med_ 41(6 Suppl 4):S398-405 (free full text:
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

1. People living with SCD ~ lognormal matched to the latest (2023) value and its 95%
   interval.
2. Heat (map shading) = sqrt(people living with SCD / highest country), so mid-sized
   countries stay visible next to Nigeria. Five classes: Highest >= 0.4, High >= 0.2,
   Medium >= 0.1, Lower >= 0.03, Lowest below that.
3. Rank and "share of all people counted" use each country's median, out of the 54
   countries in the file.

There is deliberately no forecast on this page. The data counts all sickle cell
disorders, not only sickle cell anaemia.

## Use-case personas (`scripts/build_data.py`, writes `data/processed/usecases.json`)

100 likely sickle-cell patient personas per country: `age_group` and `sex` come from
the real GBD prevalence split (largest-remainder allocation, so the 100 personas mirror
who actually lives with the disease). `blood_group` comes from
`data/blood_groups_simple.json`, a single global ABO/RhD probability distribution (not
specific to this country, or to sickle cell disease, since no finer data exists) --
allocated the same way and interleaved so it does not cluster by age or sex. At 100
personas, AB- (0.4% global probability) rounds to zero. `blood_ml` is an ASSUMPTION:
red cells for one acute episode, by weight-based dosing per age group (`meta.blood_ml_assumption`
in the file has the min/mode/max).

## Pre-built data files (`scripts/build_data.py`)

Run `python scripts/build_data.py` to regenerate both files from the GBD exports in
`data/`. No dependencies beyond the standard library; the output is deterministic.

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

## Blood reservoir page (`backend/app/reservoir.py`, reads `data/blood_supply.csv` + `data/male_raw.csv` / `data/female_raw.csv`)

MODELLED stock levels, not live blood-bank figures. One row per country in
`data/blood_supply.csv` (all 54 hotspot countries), each value tagged with its source or
`ASSUMPTION`:

- **Whole-blood donations**: WHO *Global status report on blood safety and availability
  2021*, Annex 3 (total whole-blood donations, latest year reported, mostly 2018; Seychelles,
  Sudan and Zambia 2015). Each row was checked so total = voluntary + family/replacement +
  paid + other (Seychelles' parts don't add up; its printed total is used). Nigeria is
  flagged by WHO as partial national coverage. Djibouti, Equatorial Guinea, Guinea,
  Guinea-Bissau, Sierra Leone and Somalia reported nothing: ASSUMPTION 5.2 per 1000 (WHO
  AFRO 2022 survey regional average).
- **Population**: World Bank `SP.POP.TOTL` for the same year as the donations.
- **Blood-group mix (O+ ... AB-)**: Wikipedia, "Blood type distribution by country"
  (a compilation of national studies) for 22 countries. Others: ASSUMPTION, the average of
  the countries with data in the same sub-region (North Africa = UN M49 Northern Africa;
  Egypt's source has no RhD-negative split so it uses the North African average).
- **Reserve target (days)**: South Africa 5 days (SANBS: 5 days of stock per blood group).
  No other national target was found: ASSUMPTION 6 days, as used by UK services.

10,000 Monte Carlo draws (seed `20261107`), reported as P10/P50/P90:

1. Donor mix per draw ~ Dirichlet around the country's shares (concentration 400 if
   cited, 60 if assumed).
2. Usable units/day = donations/365 × (1 − discard), discard ~ triangular(0.08, 0.156,
   0.25). 15.6% = WHO AFRO 2022 survey (33 countries); the range is an ASSUMPTION.
3. General (non-SCD) need/day = population × triangular(min, mode, max) per 1000 / 365,
   **calibrated** (see below), currently about triangular(5.7, 7.3, 8.7).
4. SCD load/day = GBD prevalence by age (male + female, same year as the donations) ×
   share in care (slider, ASSUMPTION, default 30%) × transfusion events per patient-year
   ~ triangular(0.30, 0.432, 0.60) (REACH) × units per transfusion by age (the app's
   existing age bands; GBD 20+ uses the adult dose). Added to step 3; because step 3 is
   calibrated with SCD use taken out, the two do not double count.
5. Demand per group = total demand × donor share × pull weight (O- 2.2, AB 0.6-0.7, see
   `model.py`), renormalised.
6. Days of stock per group = target × min(usable ÷ demand, 1). ASSUMPTION: a service that
   collects x% of what it uses can hold x% of its target buffer. Status: ok at the target,
   low from 60% of it (SANBS: under 3 of 5 days is critical), critical below.
7. Extra donations/day per group = (demand − usable) / (1 − discard), when positive.

### Calibration of general need (`calibrate_need()`, `data/need_calibration.csv`, `GET /api/calibration`)

General blood need is fitted to published national annual requirements rather than
guessed. Each row of `data/need_calibration.csv` holds a country, year, stated requirement
(units a year), World Bank population for that year, and the source:

| Country | Year | Requirement | Source |
| --- | --- | --- | --- |
| Ghana | 2025 | 308,000 | Ghana National Blood Service (Graphic Online, 7 Apr 2026) |
| Nigeria | 2019 | 2,000,000 | Federal Ministry of Health (ThisDay, 14 Jun 2019) |
| Kenya | 2022 | 520,000 | Kenya Tissue and Transplant Authority minimum need (The Star, 21 Oct 2022) |
| Tanzania | 2015 | 6.2 per 1000 (322,530) | Drammeh et al. 2018, *Transfusion Medicine Reviews* 32(1):36-42 |

For each row: implied general need per 1000 = (requirement − modelled SCD use that year,
step 4 at the default 30% in care) ÷ population × 1000. The need distribution is
triangular(lowest, median, highest) of those implied rates. The calibrated model is then
re-run for each calibration country; the page shows the result next to the published
figure. Ghana and Nigeria land inside the model's P10–P90 range; Kenya is about 15% under
and Tanzania about 25% over, because they set the edges of the range.

Caveats: three of the four "requirements" are not independent measurements. Nigeria's is
stated as the WHO 10-per-1000 rule applied to population, Kenya's is about 1% of
population, and Ghana's is close to 9 per 1000. Only Tanzania's comes from a hospital
survey. With four points the range is narrow and does not capture uncertainty in the
targets themselves. Adding a country is one new row in the CSV; the fit updates on restart.
