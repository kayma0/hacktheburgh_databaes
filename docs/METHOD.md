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
