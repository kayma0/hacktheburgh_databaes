# Method

This app estimates blood demand from sickle cell disease (SCD) and the donors needed to
cover a chosen share of that demand. Every output is a MODELLED estimate with uncertainty,
never a single point figure.

## Data files the app reads

Each section below says which files it uses and what is an ASSUMPTION.

- `data/raw.csv`, `data/male_raw.csv`, `data/female_raw.csv` — GBD 2021 sickle cell
  disorders prevalence (all ages / by age and sex) for 54 African countries, 1996-2023.
- `data/processed/heatmap.json`, `data/processed/usecases.json` — pre-built from the
  files above by `scripts/build_data.py` (see below).
- `data/blood_supply.csv`, `data/donations_history.csv`, `data/population.csv`,
  `data/need_calibration.csv`, `data/blood_groups_simple.json` — blood supply, donation
  history, population, national need figures and ABO/RhD mix, each tagged with its source
  or `ASSUMPTION`.

Donations must be voluntary, unpaid, and go through a licensed national blood service.
This is an aggregate planning tool, not a medical device, and gives no clinical advice.

## Hotspots page (`backend/app/hotspots.py`, reads `data/processed/heatmap.json`)

The map is drawn from `data/processed/heatmap.json` (how that file is built is described
under "Pre-built data files" below), served by `/api/hotspots`. For each of 54 African
countries the page shows the file's estimate of people living with sickle cell disorders
in 2026, its low-high range, and its legend bucket (very low < 1,000; low < 10,000;
moderate < 100,000; high < 500,000; very high otherwise) as the fill colour. "Rank" and
"share of all people counted" use each country's `cases`. The 2026 figures are a trend
carried forward from 2023, so they are modelled, not observed. The data counts all
sickle cell disorders, not only sickle cell anaemia. There is deliberately no further
forecast on this page. `hotspots.load_series` still reads `data/raw.csv` for the
country list used by the blood-reservoir page.

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
- The donation and population columns above are the latest *reported* year. Since the
  crisis simulator was added, the page projects both to the current year instead (see
  "Trend fitting" below); the CSV's blood-group mix and reserve target are still used.
- **Blood-group mix (O+ ... AB-)**: Wikipedia, "Blood type distribution by country"
  (a compilation of national studies) for 22 countries. Others: ASSUMPTION, the average of
  the countries with data in the same sub-region (North Africa = UN M49 Northern Africa;
  Egypt's source has no RhD-negative split so it uses the North African average).
- **Reserve target (days)**: South Africa 5 days (SANBS: 5 days of stock per blood group).
  No other national target was found: ASSUMPTION 6 days, as used by UK services.

10,000 Monte Carlo draws (seed `20261107`), reported as P10/P50/P90:

1. Donor mix per draw ~ Dirichlet around the country's shares (concentration 400 if
   cited, 60 if assumed).
2. Usable units/day = this year's projected donations (trend fitting, below) / 365 × (1 − discard), discard ~ triangular(0.08, 0.156,
   0.25). 15.6% = WHO AFRO 2022 survey (33 countries); the range is an ASSUMPTION.
3. General (non-SCD) need/day = this year's projected population × triangular(min, mode, max) per 1000 / 365,
   **calibrated** (see below), currently about triangular(5.7, 7.3, 8.7).
4. SCD load/day = GBD prevalence by age (male + female, latest year, scaled to this year's
   trend projection) × share in care (ASSUMPTION, 30%) × transfusion events per patient-year
   ~ triangular(0.30, 0.432, 0.60) (REACH) × units per transfusion by age (the app's
   existing age bands; GBD 20+ uses the adult dose). Added to step 3; because step 3 is
   calibrated with SCD use taken out, the two do not double count.
5. Demand per group = total demand × donor share × pull weight (O- 2.2, AB 0.6-0.7, see
   `DEFAULT_DEMAND_WEIGHTS` in `reservoir.py`), renormalised.
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

## Trend fitting (`backend/app/trends.py`)

Both the reservoir bags and the crisis simulator use the current year (2026), not the last
year with data.

- **Donations per 1000 people**: `data/donations_history.csv` holds every year WHO reports
  for each country (GSR 2021 Annex 3: 2014, 2015, 2017, 2018; each row checked so the parts
  add up, or flagged where they don't), plus newer national figures: Ghana 2024 (187,280)
  and 2025 (204,000), Nigeria 2024 (371,827, NBSC via WHO Africa) and Kenya FY2021/22
  (384,000, KTTA). Divided by World Bank population for that year (`data/population.csv`,
  2014-2025). The slope is a weighted least-squares fit on log(rate), with each year's
  weight halving every 5 years back, then **shrunk toward zero** by a prior that national
  rates change by about 3% a year (normal prior, SD 0.03) and capped at ±8% a year. So a
  short, noisy series (Chad: 5.5, 1.6, 4.6) projects nearly flat, and only a clear trend
  carries forward. The projection starts from the **latest reported figure** and applies
  that slope to the current year; the scatter of the series around the fit is the level's
  uncertainty. Countries with no figures use 5.2 per 1000 (WHO AFRO 2022 average).
  ASSUMPTIONS: the prior, cap and half-life.
- **Population**: World Bank up to 2025, then the last five years' growth.
- **People with SCD by sex and age**: each of the 14 GBD groups (7 ages × 2 sexes) is fitted
  log-linearly over 2014-2023 and projected to the current year. This sets the age/sex mix
  of the simulator's patient pool and scales SCD hospital use.

## Crisis simulator (`backend/app/crisis.py`, `GET /api/crisis`)

The reservoir page's two sliders choose **N people in crisis** (1-50) and a **time frame**
(1-365 days). Each press of the button is a new run:

1. **Patient pool**: 100 patients drawn at random (new seed each run) from the country's
   projected age/sex mix above. Each gets a blood group drawn from
   `data/blood_groups_simple.json`, a single global ABO/RhD distribution (as in the team's
   `usecases.json`; not country-specific).
2. **5,000 Monte Carlo draws**. In each: N patients picked at random from the pool without
   replacement; each crisis starts on a uniformly random day in the window; each needs a
   red-cell dose for their age (`meta.blood_ml_assumption` in `usecases.json`,
   triangular min/mode/max mL, ×0.9 for women aged 15+, 250 mL per unit). Supply in the draw
   is the reservoir model's: donor mix, discard, calibrated general need and SCD use, all at
   this year's projection.
3. **Serving**: crises are handled in the order they happen. A patient is served if their
   group's blood available at that moment covers their dose: stock at the start of the
   window (target days × min(collections, normal use) per group) plus collections minus
   normal hospital use up to that day, minus what earlier crisis patients took. Groups
   where normal use exceeds collections drain over the window, so longer windows are harder
   for those countries and easier for those with spare collections. By default patients
   receive only their own blood group.

   Two switches change the serving rule (both off by default; "Reset to default blood
   rates" turns them off and puts the sliders back to 25 people, 30 days):
   - **Use O− when a group runs out**: a patient whose own group has nothing left gets O−
     (the universal red-cell donor) if O− has enough at that moment. Because hospitals
     already pull hardest on O− (demand weight 2.2), O− is usually the first group to run
     dry, so this mostly helps rare groups (AB−, B−) in countries with spare O−. The
     result says how often O− stepped in, or that it couldn't because it ran out first.
   - **Crisis patients first**: crisis patients draw on stock plus *all* usable
     collections, and normal hospital use waits. The result reports the units held back
     from other hospital patients: crisis use beyond what was spare after normal use over
     the window.
4. **Result**: the share of draws where everyone was served gives the verdict: enough
   (≥ 90%), might not have enough (50-90%), not enough (< 50%). A group is "short" if, in
   draws that picked someone with that group, that person went without at least half the
   time ("at risk" from 20%). The sentence describes one typical draw (median number left
   without blood, total need nearest the median) by age group, and the pool picture rings
   the patients picked in it.

5. **What to do**: for each blood group, donors to recruit before the window =
   ceil(90th percentile of that group's shortfall in units across all draws ÷ ((1 − 0.156
   discard) × (1 − 0.076 deferral))), using WHO AFRO 2022 averages and one unit per
   donation. Adding those units would cover the gap in about 9 of 10 runs (approximate:
   extra stock also lets later patients be served). Also reported: the median day the
   first patient goes without (in runs where anyone does).
   Each group also gets a deadline: the median day its first patient goes without (in
   runs where one does). The page asks for donors 2 days before that, to allow for testing
   and processing donated blood (ASSUMPTION: typically 1-2 days), lists groups most urgent
   first, and for windows of 2+ weeks also shows donors a week.
6. **Donor appeal** (`backend/app/appeal.py`, `POST /api/appeal`): the plan (groups,
   donor counts, deadlines, country, optional charity name) is turned into a WhatsApp
   message, an SMS (≤ 300 characters) and an email. With `GEMINI_API_KEY` set, Gemini
   writes them from those facts only (told not to invent statistics, places, dates,
   numbers or medical claims; donation voluntary, unpaid, via the national blood
   service); otherwise, or if Gemini fails or takes over 15 s, a fixed template is used.
   The page sends them through WhatsApp / SMS / email share links; the charity picks the
   recipients. Nothing is sent automatically.

The page states that each run covers sickle cell crises only and assumes nothing else
happens (no other emergencies, outbreaks or donation drives). The result shows a verdict, four headline
numbers (people without blood in a typical run, first shortage day, share of runs with
everyone covered, donors to recruit), the recruitment target by group, who is in crisis
by age, and a table by blood group.

Caveats: the global blood-group distribution gives more AB+, A- and B- patients than
African donor mixes, which pushes those groups toward shortage; everyone in crisis needs
one episode's worth of blood; O− is the only substitute modelled (not full ABO/Rh
compatibility). All MODELLED, not live stock.

## Drive plan (`backend/app/plan.py`, `GET /api/plan`)

Adds no new demand model: it composes `reservoir.compute_reservoir` (days of stock and the
everyday gap per blood group) and `crisis.simulate_crisis` (which groups run short if N people
with SCD go into crisis within a time window; a fixed seed so a shared link rebuilds the same
plan). A group is **push** if its everyday stock is critical or the crisis test says it is
lacking, **watch** if low or at risk, otherwise **ok**.

- **Regular donors** = the SCD patients' red-cell units a year (from `scd_demand_per_day`) ×
  the chosen *coverage* ÷ (donations per donor per year × (1 − deferral)).
- **One-off donors** (for the crisis window) = units short × coverage ÷ (1 − deferral).
- The country's whole everyday shortfall is shown as context only: closing a national shortage
  is not what one charity's drive can do, so it is not the target.
- Constants are multiplied through, so P10/P50/P90 scale exactly. Totals add the push/watch
  groups' percentiles, a wide range that assumes all groups move together.

ASSUMPTIONS (user-adjustable): volunteers turned away at screening 20% (range 5–50%; blood-service
reports typically give 10–35%); donations per regular donor per year 2 (range 1–4; services allow
3–4, many African repeat donors give 1–2); coverage 10% (the share of the SCD blood need the
drive aims to supply); share of people with SCD in regular care 30%. Verify these with the
national blood service.

### How far to trust this (`GET /api/backtest`, `GET /api/sensitivity`)

- **Back-test** (`backtest.py`): the same log-linear 10-year trend the heat map uses is fitted
  to `data/raw.csv` using only years up to 2018, predicts 2019–2023, and is compared with the
  GBD figures (countries with fewer than 1,000 cases left out). Typical error: about 1% a year
  ahead and 3% five years ahead; 87% of countries within 10% at five years; Sudan is the clear
  outlier (about 50%). Honest limit: GBD series are themselves modelled and smooth, so this checks
  the trend method, not counted patients.
- **Sensitivity** (`plan.sensitivity`): each assumption is varied alone across a plausible range
  (deferral 10–35%, donations per donor 1–3 a year, share in care 15–50%) and the regular-donor
  total re-computed. Donations per donor per year moves the answer most in the countries
  checked.

## Appeal writer (`backend/app/appeal.py`, `POST /api/appeal`)

Gemini turns the plan's numbers into a donor email, social post, SMS or poster, in one of six
languages. Gemini is a communication layer, not a source of facts:

- The prompt is built from the plan the server recomputes, never from browser-sent numbers; the
  user's venue/date/contact text is cleaned to one short line and marked as data.
- The reply must mention that donation is voluntary/unpaid and may not contain a number with
  three or more digits that was not given to it; otherwise a fixed English template is returned
  (`fallback_reason`: `no_api_key`, `gemini_unavailable` or `failed_checks`).
- Non-English output is machine-written and flagged for a native speaker to check.
- Nothing is sent and no donor details are stored.

## Travel checklist (`backend/app/briefing.py`, `POST /api/briefing`)

A starter list for a visiting charity team. It is written by Gemini without live sources (or a
fixed list when Gemini is unavailable) and says so; each item has a confidence and who to verify
with, and official government travel advice is linked first. Country and month are validated
against known values before they reach the prompt.

## Saved plans and sign-in (`backend/app/auth.py`, `plans_store.py`)

Auth0 provides the login. The server verifies the access token (RS256 signature against the
tenant's public keys, issuer, audience, expiry) and uses its `sub` as the user id; every query is
scoped by it in SQL. A saved plan stores only the plan's settings (an allow-listed query string),
which the server turns back into a plan, so it cannot go stale or be forged into other numbers.
Without Auth0 configured, saved plans stay in the browser and the protected endpoints answer 503.
