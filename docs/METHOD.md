# Method

This app estimates blood demand from sickle cell disease (SCD) and the donors needed to
cover a chosen share of that demand. Every output is a MODELLED estimate with uncertainty,
never a single point figure.

## Data sources

- `data/raw/burden.csv` — affected children per country (P50, 2.5th/97.5th percentile).
  Source: GBD 2021 / Lancet Child & Adolescent Health SCD burden estimates. Until real data
  is placed there, `burden_SAMPLE.csv` is used and the UI shows a SAMPLE DATA banner.
- `data/raw/who_blood.csv` — national blood collections per year. Source: WHO Global
  Database on Blood Safety. Sample fallback: `who_blood_SAMPLE.csv`.
- `data/raw/parameters.yaml` — min/mode/max for each model parameter with a source, or
  `ASSUMPTION` if none was found.

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
