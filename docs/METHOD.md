# SickleSupply: method, assumptions and limitations

Everything about undiagnosed children, transfusion need and blood units in this app is **MODELLED, not observed**.
Every modelled number is reported as **P50 (P10–P90)** from a seeded Monte Carlo (default 10,000 draws, seed 20261107).

## 1. Users and questions

Users are **charity programme staff** running voluntary blood-donation drives with a licensed partner service. They are not clinicians.

1. **Where** is the modelled shortfall largest? (map + ranked list + rank stability)
2. **How many** donors and drives would cover a chosen share of modelled paediatric SCD demand? (Drive Planner)
3. **What** should the team look out for in that area? (Gemini field briefing)

## 2. Inputs

| Input | Kind | File |
|---|---|---|
| Children living with SCD per country, with 95% interval | SOURCED (GBD 2021 or Lancet Child 2026, user-selectable) | `gbd_scd_2021.csv`, `lancet_child_2026_country.csv` |
| Whole-blood donations per 1,000 population, VNRD share | SOURCED (WHO) | `who_blood_donations_per_1000.csv` |
| Population | SOURCED (World Bank / UN WPP) | `population.csv` |
| Income group | SOURCED (World Bank) | `country_metadata.csv` |
| Public health facilities (admin1, coordinates) | SOURCED (HDX, Maina et al. 2019) | `sub-saharan_health_facilities.xlsx` |
| Transfusion rates, assumptions | see section 4 | `config/parameters.yaml` |

GBD handling: Prevalence, Number, Both sexes, ages `<5`, `5-9`, `10-14` years (configurable via `CHILD_AGE_GROUPS`).
Rows for **sickle cell trait are dropped**, and if only the aggregate cause "Sickle cell disorders" is present the loader refuses
to run, because that aggregate includes trait. Age-group and sub-cause intervals are summed, which makes the country interval
conservative (wider than the true one).

## 3. Model

For each country *c* and draw *i* (shared parameters are drawn once per draw and used for every country):

```
children[c,i]    ~ Lognormal( ln(point_c), (ln(upper_c) - ln(lower_c)) / (2 x 1.96) )
diagnosed        = children x share_diagnosed[i]
events/child-yr  = (1 - hu[i]) x rate_untreated[i] + hu[i] x rate_hydroxyurea[i]      (rates / 100)
demand_units     = diagnosed x events/child-yr x units_per_event[i]
collections      = donations_per_1000[c,i] / 1000 x population_c
pct_of_collections = demand_units / collections
gap_units        = demand_units x target_coverage
donors_needed    = gap_units / (1 - donor_deferral_rate[i])          (people attending, before deferral)
```

Scenarios shown side by side:

* **Baseline**: current `share_diagnosed` and `share_on_hydroxyurea`.
* **Universal diagnosis + hydroxyurea**: `share_diagnosed = 1`, `hu = universal_hydroxyurea_coverage`.
* **Units avoided by hydroxyurea** = demand(universal diagnosis, hu = 0) − demand(universal diagnosis, hu = universal).

We do **not** assume any share of national blood goes to SCD. Demand is only compared with total national collections.

**Region totals** are summed inside each draw, so uncertainty propagates correctly (not by adding P90s).

**Rank stability**: in each draw, countries are ranked by the chosen metric; `P(top 10)` is the share of draws in which a
country is in the top 10.

**Sensitivity (tornado)**: one input at a time is moved to its own P10 and P90 while the others stay at their central value.
Output: donors needed per year across the selected countries.

**Drive planner**: attendees needed over the horizon = annual donors needed x horizon / 12. Capacity = drives/month x horizon x
donors per drive. *Probability of reaching the target* = share of draws in which capacity ≥ need. Donors per drive is the
charity's own figure if given, otherwise the ASSUMPTION range.

## 4. Parameters and assumptions

Every value not from a cited source is an **ASSUMPTION**: flagged in the UI, listed here, and adjustable (Scenario Lab sliders,
Method page, or the API `overrides` field).

| Parameter | Kind | Central | Range / distribution | Source or TODO |
|---|---|---|---|---|
| Transfusion events / 100 person-years, untreated | SOURCED | 43.2 | Gamma, CV 0.25 (**CV is an ASSUMPTION**) | REACH trial (Tshilolo et al., NEJM 2019). Clinic-based children: **not generalisable**. TODO verify figure + CI |
| Transfusion events / 100 person-years, max-dose hydroxyurea | SOURCED | 10.8 | Gamma, CV 0.25 (**ASSUMPTION**) | as above |
| Units per transfusion event | ASSUMPTION | 1.0 | Triangular 0.5 / 1.0 / 2.0 | TODO: paediatric ml/kg and unit size |
| Donor deferral rate | ASSUMPTION | 20% | Triangular 10% / 20% / 35% | TODO: national blood service statistics |
| Donors (attendees) per drive | ASSUMPTION | 60 | Triangular 30 / 60 / 120 | TODO: the charity's own history |
| Share of affected children diagnosed | ASSUMPTION | 10% | Beta, mean 0.10, concentration 40 | TODO: newborn screening coverage |
| Share of diagnosed children on hydroxyurea | ASSUMPTION | 5% | Beta, mean 0.05, concentration 40 | TODO: hydroxyurea access estimates |
| Target coverage | ASSUMPTION (programme choice) | 25% | fixed | programme decision |
| HU coverage in universal scenario | ASSUMPTION | 80% | fixed | scenario setting |

Structural assumptions:

* Source point estimates are treated as the **median** of a lognormal; asymmetric 95% intervals are averaged on the log scale.
* Demand counts **diagnosed children only**.
* Expected events per child are used (Poisson noise is negligible at these counts).
* Shared parameters are **fully correlated across countries** within a draw.
* **Admin1 split** is proportional to the number of public health facilities (or to admin1 population if `admin1_population.csv` is supplied).
* **Facility view**: each admin1 region's demand is spread **equally** across its facilities. The facility list has no blood-bank
  or SCD-clinic information, so it is not a list of places that transfuse.

## 5. ML imputation

Used only where a country lacks a donations figure or a burden estimate.

* Target on the log scale: donations per 1,000, or children with SCD per 1,000 population.
* Features: UN sub-region, income group (one-hot), log population, VNRD share (missing allowed), and the other burden
  source's rate when available.
* Model: `HistGradientBoostingRegressor`, quantile loss at 0.1 / 0.5 / 0.9.
* **Leave-one-country-out CV** gives out-of-sample predictions; we report MAE, MAE of a naive baseline (median of the other
  countries), and the coverage of the 80% interval.
* **Conformalised quantile regression**: LOCO non-conformity scores widen the interval to target 80% coverage.
  The conformal coverage is computed on the same scores used to calibrate it, so it is a calibration check, not an independent test.
* Imputed values carry an **ML-IMPUTED** badge in the UI and exports, sample from their own predictive lognormal in the Monte Carlo,
  and never overwrite observed values.

Results are on the Method page (`GET /api/method`) and in `docs/CV_REPORT.md` (`make cv`).

## 6. Safety rules (enforced in code)

* No patient data and no donor personal data; only aggregates are stored (briefing cache, drive plans).
* Not a medical device; no clinical advice.
* Donation is voluntary and unpaid and goes through the national blood transfusion service or a licensed blood bank.
  The planner **refuses** to build a plan without a named partner and a confirmation that it is licensed.
* The Gemini briefing is told never to suggest paying donors or collecting outside licensed services, to point to official
  government travel advice and never describe current incidents, and to avoid stereotypes. Every item has a confidence level
  and a "verify with". If grounding is unavailable the briefing is marked **UNGROUNDED, verify before use**; if Gemini fails,
  a static generic checklist (**FALLBACK**) is shown.

## 7. Limitations

* REACH rates come from clinic-based trial children and may be far from real-world rates in any given country.
* Diagnosis and hydroxyurea shares are placeholders until cited per country, and the tornado chart shows they dominate the answer.
* Burden estimates themselves have very wide intervals; the app shows them rather than hiding them.
* Admin1 and facility figures inherit a crude proportional split.
* ML imputation uses ~40 countries and few covariates.
