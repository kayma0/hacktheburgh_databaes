# SickleSignal

**SickleSignal** is a web app that helps charity teams plan blood-donation drives for people
living with sickle cell disease (SCD). It estimates how much blood SCD needs, whether a
country's blood supply could cope if people go into crisis, and how many donors of which blood
group a charity should recruit to close the gap.

> **Every number is a modelled estimate with an uncertainty range (P10 / P50 / P90), never a
> single point figure, and never a live stock count.** Sources and assumptions are in
> [docs/METHOD.md](docs/METHOD.md). Not a medical device. No clinical advice. Aggregate data only.

## Live demo

You can access our live demo until 7.12.2026:
https://hacktheburghdatabaes-production.up.railway.app/

## The idea

Sickle cell disease is one of the most common in Africa, and people with it can need urgent blood
transfusions during a "crisis". Charities that run blood drives often don't know _where_ the
need is greatest, _whether_ a country's blood banks could cover a sudden rise in crises, or
_which blood groups_ to push for. SickleSignal follows a charity team through those questions:

1. **Where is the need?** A map of Africa shaded by how many people live with SCD.
2. **Could the blood supply cope?** The modelled days of stock for each blood group, and a
   crisis simulator: choose how many people might go into crisis, and see whether the country's
   supply could cover them. If not, it names the blood groups that run short.
3. **What should we do?** A drive plan: which groups to push for, how many donors to recruit,
   and a ready-to-send appeal to registered donors.
4. **What should we know before we travel?** A trip checklist for the country.

Gemini helps with _wording_ (the appeal and the travel checklist). It is never the source
of a number, and without a Gemini key the app falls back to plain templates.

## What a charity does with it

Five screens, linked by buttons. The crisis settings live in the address
bar, so Back and a copied link rebuild exactly what was on screen.

### 0. The landing page and sign-in

With Auth0 set up, a signed-out visitor sees the landing page
([frontend/src/Landing.tsx](frontend/src/Landing.tsx), styled by `landing.css`): the logo,
"Spot the need. Send the signal.", a heartbeat line, and a card to **log in to your charity** or
**register your charity**, by email and password or **with Google**.
A charity signs in to use the app. Once signed in, the header shows the account name and
"Sign out". Without the Auth0 values the app skips the landing page and runs as one local
charity (see "Run locally"). The page is built to fit phones, tablets and large monitors.

### 1. Hotspots map (`#/hotspots`)

Africa shaded by how many people live with sickle cell disease in 2026, in five buckets (very
low to very high), from `data/processed/heatmap.json`. Tap a country to see its estimate and
range, its rank among 54 countries and its share of all people counted, then open
"{country}'s blood reservoir →". The map zooms with + / −, a pinch, Ctrl (or ⌘) + scroll or a
double-click, and pans by dragging once zoomed in.

The 2026 figures are the GBD 2021 trend carried forward from 2023, so they are modelled, not
observed. The map deliberately has no further forecast.

### 2. Blood reservoir and crisis simulator (`#/reservoir`)

**Blood reservoir.** `GET /api/reservoir` ([backend/app/reservoir.py](backend/app/reservoir.py))
looks the country up in `data/blood_supply.csv` (WHO donations, population, blood-group mix,
national reserve target) and in the GBD sickle cell data by age, runs 10,000 random draws, and
returns for each of the 8 blood groups the days of stock it could hold, donations per day,
units used per day and extra donations needed. Each blood bag
([frontend/src/components/BloodBag.tsx](frontend/src/components/BloodBag.tsx)) fills to the
median days divided by the country's target, so a full bag means the target is met. These are
modelled from what a country collects versus what it uses.

**Crisis simulator.** Two sliders (people in crisis, 1 to 50, and a time frame, 1 day to a
year), a Run button and one switch, "Use O− when a group runs out". `GET /api/crisis`
([backend/app/crisis.py](backend/app/crisis.py)) draws a pool of 100 patients from the country's
age and sex mix, with blood groups from `data/blood_groups_simple.json`, then runs 5,000
Monte Carlo draws: pick N patients, give each a random crisis day and an age-based dose, and
serve them in order from the blood their group has left after normal hospital use. The answer
says whether the country has enough blood, in what share of simulations everyone was served,
which groups run short, and gives a dated plan and a table by blood group. The same `seed`
always gives the same run. Each run covers sickle cell crises only and assumes nothing else
happens.

"Plan the drive →" carries that exact run (including its seed) to the next screen.

### 3. Plan a blood drive (`#/plan`)

Opens on the crisis statement from the previous screen, then:

1. **What the crisis test says:** the verdict and the blood groups to **push** (short in most
   simulations) or **watch**, shown as chips.
2. **Reach donors:** write the urgent appeal, then send it to registered donors (below).
3. **What this rests on:** every assumption behind the plan, tagged **Assumption** or
   **Sourced**, with its source.
4. **How far to trust this:** a back-test of the case-trend method (fit to data up to 2018,
   predicted after) and a sensitivity view of which assumption moves the donor numbers most.

The plan turns shortfalls into donors to recruit using stated defaults: 20% of volunteers
turned away at screening, 2 donations per regular donor per year, and a drive that supplies
10% of the regular SCD blood need (`GET /api/plan` accepts other values). "← Back to the crisis
simulator" restores the same run, and "Before you travel →" opens the next screen.

**Reach donors** has two steps:

- **Write the urgent appeal** (`POST /api/appeal`, [backend/app/appeal.py](backend/app/appeal.py)).
  Gemini, or a template when there is no key or Gemini fails, drafts it for WhatsApp, SMS and
  email from the crisis facts only. The charity can edit it, rewrite it, and pick the channel.
- **Send it to your donors.** `POST /api/donors/match` lists the registered donors of each
  blood group the crisis needs, and the charity chooses who gets it:
  - _Only those who can give now_ (default): donors whose last donation was at least 12 weeks
    ago (84 days), or who have never given. Each gets a personal message with their name and a
    nudge in front.
  - _Everyone with these blood types_: the appeal as written. By email or SMS the whole group
    can go in one go (email recipients go in BCC); WhatsApp is one donor at a time.

Every send is logged as "contacted" (`POST /api/outreach`); the Pledged and Can't buttons log
the reply, and pledges fill each group's progress bar. "+ Add a donor" registers someone new
(`POST /api/donors`; consent and a phone or email are required). **Nothing is sent
automatically:** each link opens WhatsApp, SMS or email with the message ready, and the charity
sends it. "This week: N messages sent · N pledged" comes from `GET /api/outreach/activity`.

### 4. Before you travel (`#/briefing`)

`POST /api/briefing` ([backend/app/briefing.py](backend/app/briefing.py)) builds a trip checklist
for the country, with sections such as community and cultural considerations, logistics,
health and safety, travel documents and regulation. It opens with a **Current situation**
section built from the UK government's live advice, which
[backend/app/travel_advice.py](backend/app/travel_advice.py) fetches from the free gov.uk
Content API: the advisory status, the date gov.uk last changed the page, and the safety and
regional-risk text. Gemini is never asked what the advice is, so it cannot invent an advisory,
and if Gemini is unavailable the gov.uk facts still lead a fixed starter list. Entry and visa
rules are kept general on purpose: FCDO advice is written for British passport holders and we
do not know a visitor's nationality. A separate "Official advice comes first" box links to the
UK, US and WHO travel advice. The page can be printed or saved as a PDF.

## What it deliberately does not do

- **No live stock.** Bags show modelled days of stock from what a country collects versus uses.
- **No death or child-mortality forecast.** The hotspots map shows modelled numbers of people
  living with SCD, trend-projected from 2023 to 2026 and nothing further. The code does not
  estimate deaths.
- **No automatic messaging.** The app never sends a message or stores a donor's reply on its own.
- **No clinical advice.** Donation must be voluntary, unpaid and run through the country's
  licensed national blood service.

## How the numbers are made

Full detail, sources and every assumption: [docs/METHOD.md](docs/METHOD.md).

| Model                     | File                                 | What it does                                                                                                                                                  |
| ------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hotspots                  | `backend/app/hotspots.py`            | Serves the map from `data/processed/heatmap.json` (built by `scripts/build_data.py`); reads the raw GBD series for the back-test.                             |
| Trend fitting             | `backend/app/trends.py`              | Log-linear fits of SCD prevalence by sex and age (GBD) and of donations per 1,000 people (WHO 2014-2018 plus newer national figures), projected to this year. |
| Reservoir                 | `backend/app/reservoir.py`           | Days of stock per blood group, 10,000 draws, P10/P50/P90; calibrated against published national blood requirements (`GET /api/calibration`).                  |
| Crisis simulator          | `backend/app/crisis.py`              | Can supply cover N patients in a window? 5,000 draws, same seed gives the same run.                                                                           |
| Drive plan                | `backend/app/plan.py`                | Adds no new demand model: composes the reservoir and crisis models and converts shortfalls into donors to recruit.                                            |
| Back-test and sensitivity | `backend/app/backtest.py`, `plan.py` | How well the trend method predicts the past, and which assumption matters most.                                                                               |

## Data

All in [data/](data/); `scripts/build_data.py` builds `data/processed/heatmap.json` and
`usecases.json` from the GBD exports.

- `raw.csv`, `male_raw.csv`, `female_raw.csv`: GBD 2021 sickle cell disorders, people living
  with SCD (all ages, and by age band and sex) with 95% intervals.
- `blood_supply.csv`, `donations_history.csv`, `population.csv`: WHO whole-blood donations,
  World Bank population, blood-group mix and national reserve targets. Each value carries a
  source, or an `ASSUMPTION` tag where no published figure exists.
- `blood_groups_simple.json`: ABO/RhD probability distribution.
- `need_calibration.csv`: published national blood requirements used to calibrate general need.

## Accounts and database: Auth0 and Tiger Data

Auth0 and the database split the work:

- **Auth0** keeps the logins: each charity's email and (hashed) password in Auth0's own user
  database, or its Google account. The app never sees a password. Each account has a stable
  Auth0 user id, e.g. `auth0|65f…` or `google-oauth2|10…`.
- **Tiger Data** (Postgres with TimescaleDB, on Tiger Cloud; any Postgres works) keeps
  everything a charity does, keyed by that id. The server reads the id only from a verified
  Auth0 token (RS256 signature, issuer, audience, expiry), never from the browser, so one
  charity can never see or change another's data.

Tables (`backend/app/schema.sql`, created automatically on first use):

| Table         | What it holds                                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `charities`   | One row per charity account (its Auth0 user id and name), created on its first request.                                                                                                                                  |
| `donors`      | Name, phone, email, blood type, country, consent to be contacted, date they last gave blood, and the charity they belong to. Demo donors belong to no charity, and every charity sees them.                              |
| `outreach`    | Every contact and reply (contacted / pledged / declined), with time, channel and charity. On Tiger Data it is a **hypertable** partitioned by time, and the weekly activity line comes from a `time_bucket` query on it. |
| `saved_plans` | Drive plans a charity saved (settings only, never results). The API supports it (`/api/plans`); the current screens do not use it.                                                                                       |

Without Auth0 configured (local mode) the app has one charity, `local`, and needs no sign-in.
Without `DATABASE_URL` everything else works, and the donor card says no database is connected.

Set up the database:

1. Create a free service at https://console.cloud.timescale.com (Tiger Cloud) and copy its
   connection string.
2. Add it to `.env`: `DATABASE_URL=postgres://tsdbadmin:...@....tsdb.cloud.timescale.com:.../tsdb?sslmode=require`
3. Load the demo donors: `cd backend && python -m app.seed` (40 per country; `--reset`
   replaces them). They are fictional: phone numbers use +999, a code no country has, and
   emails use example.org, so no message reaches a real person. Add your own number with
   "+ Add a donor" to see a real message arrive.

## API

FastAPI serves everything under `/api` ([backend/app/main.py](backend/app/main.py)). Routes that
touch a charity's data need a signed-in token when Auth0 is configured, and `DATABASE_URL`.

| Route                                              | Purpose                                                          |
| -------------------------------------------------- | ---------------------------------------------------------------- |
| `GET /api/health`, `/api/countries`                | Liveness; the country list.                                      |
| `GET /api/hotspots`                                | The map data.                                                    |
| `GET /api/reservoir?country=`                      | Days of stock per blood group.                                   |
| `GET /api/calibration`                             | Reservoir model checked against published national requirements. |
| `GET /api/crisis?country=&people=&days=&seed=`     | The crisis simulation.                                           |
| `GET /api/plan?country=&…`                         | The drive plan (donors to recruit).                              |
| `GET /api/backtest`, `/api/sensitivity`            | "How far to trust this".                                         |
| `POST /api/appeal`                                 | The urgent appeal (Gemini or template).                          |
| `POST /api/briefing`                               | The travel checklist.                                            |
| `GET /api/auth/config`                             | Whether sign-in is set up on this server.                        |
| `PUT /api/me`                                      | Record the signed-in charity's name.                             |
| `POST /api/donors/match`, `POST /api/donors`       | Find or register donors.                                         |
| `POST /api/outreach`, `GET /api/outreach/activity` | Log contacts and replies; weekly activity.                       |
| `GET`/`POST /api/plans`, `DELETE /api/plans/{id}`  | Saved drive plans.                                               |

## Code layout

- `backend/app/`: `main.py` (API routes), `schemas.py` (request/response models),
  `hotspots.py`, `reservoir.py`, `trends.py`, `crisis.py`, `plan.py`, `backtest.py` (the
  models), `blood.py` (shared constants), `appeal.py` (the urgent appeal), `briefing.py` +
  `travel_advice.py` (travel checklist), `db.py` + `schema.sql` (the database), `auth.py` +
  `charities.py` (Auth0 sign-in, charity accounts), `donors.py` (donor registry),
  `plans_store.py` (saved plans), `seed.py` (demo donors), `timeout.py` (time limit for Gemini
  calls).
- `frontend/src/`: `main.tsx` and `App.tsx` (shell and routing), `Landing.tsx` +
  `landing.css` (landing page), `api.ts` (typed API client), `auth.tsx` (Auth0 sign-in),
  `format.ts` (number and date formatting), `scenario.ts` (the crisis run in the address bar),
  `pages/` (map, reservoir, plan, trust panel, travel brief), `components/` (blood bag,
  slider, switch, source tag, logo), `simulator/` (simulator, result, appeal and donor
  outreach).
- `data/`, `scripts/build_data.py`, `docs/METHOD.md`, `Dockerfile`.

## Run locally

Needs Python 3.11+ and Node 20+.

Backend:

```
cd backend
pip install -r requirements.txt
cp ../.env.example ../.env   # add GEMINI_API_KEY and DATABASE_URL if you have them
uvicorn app.main:app --port 8000
```

Frontend:

```
cd frontend
npm install
npm run dev -- --port 5173 --strictPort
```

Open http://localhost:5173 (use `localhost`, not `127.0.0.1`, when sign-in is on). The Vite dev
server proxies `/api` to port 8000. Without any keys the app works fully: no sign-in (one
local charity), the appeal and the travel checklist use their templates, and the donor card
says no database is connected.

**Gemini (optional).** Put `GEMINI_API_KEY` in `.env`. Appeals use `gemini-3.5-flash` (then
`gemini-3.5-flash-lite`, then the template; `GEMINI_APPEAL_MODEL` is tried first if set). The
travel checklist uses `GEMINI_BRIEFING_MODEL` (default `gemini-3.5-flash-lite`). If a call
fails or takes over 20 seconds, the app falls back to its templates and says so.

### Environment variables

| Variable                                                           | Used by  | Purpose                                                                 |
| ------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------- |
| `GEMINI_API_KEY`                                                   | backend  | Gemini for the appeal and travel checklist (optional).                  |
| `GEMINI_BRIEFING_MODEL`, `GEMINI_APPEAL_MODEL`                     | backend  | Model overrides (optional).                                             |
| `DATABASE_URL`                                                     | backend  | Postgres for donors, outreach and saved plans (optional).               |
| `CORS_ORIGINS`                                                     | backend  | Allowed browser origins (default `http://localhost:5173`).              |
| `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`                                   | backend  | Verify each request's login token.                                      |
| `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE` | frontend | Sign-in in the browser. Baked in when the frontend is built or started. |

None of the Auth0 values is a secret, and no Auth0 client secret is ever used. Never put an API
key in a `VITE_` variable.

### Sign-in with Auth0 (optional)

1. Create an Auth0 tenant (the free tier is enough).
2. **Applications → Create Application → Single Page Web Applications.** Set _Allowed Callback
   URLs_, _Allowed Logout URLs_ and _Allowed Web Origins_ to `http://localhost:5173` (and your
   deployed URL). Copy the **Domain** and **Client ID**. For "Continue with Google", enable the
   Google social connection for this application (Authentication → Social).
3. **APIs → Create API.** Choose any identifier; that is the **Audience** and it must match
   character for character everywhere it is used (including any trailing slash). In its
   settings, turn on **Allow Offline Access** (so people stay signed in) and keep the signing
   algorithm RS256.
4. Fill in `.env` (the frontend reads the `VITE_` lines from the same file):

```
AUTH0_DOMAIN=your-tenant.us.auth0.com
AUTH0_AUDIENCE=<your API identifier>
VITE_AUTH0_DOMAIN=your-tenant.us.auth0.com
VITE_AUTH0_CLIENT_ID=<the SPA's client id>
VITE_AUTH0_AUDIENCE=<your API identifier>
```

5. Restart both servers (Vite reads `VITE_` values when it starts). The landing page appears
   for signed-out visitors.

## Deploy (Docker, Railway)

One container: the `Dockerfile` builds the React frontend, then runs FastAPI, which also serves
the built frontend. It listens on `$PORT` (Railway sets it), defaulting to 8000.

```
docker build -t sicklesignal \
  --build-arg VITE_AUTH0_DOMAIN=your-tenant.us.auth0.com \
  --build-arg VITE_AUTH0_CLIENT_ID=<client id> \
  --build-arg VITE_AUTH0_AUDIENCE=<your API identifier> .   # build args are optional
docker run -p 8000:8000 --env-file .env sicklesignal
```

On Railway, add these service variables:

- **For sign-in:** `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`,
  `VITE_AUTH0_AUDIENCE`. The `VITE_` values are build arguments, so **redeploy (rebuild)**
  after adding or changing them; a restart is not enough.
- **Recommended:** `DATABASE_URL` (donors, outreach, saved plans) and `GEMINI_API_KEY`.
- **Optional:** `CORS_ORIGINS`, `GEMINI_BRIEFING_MODEL`, `GEMINI_APPEAL_MODEL`.

In your Auth0 application, add the deployed URL to Allowed Callback URLs, Allowed Logout URLs
and Allowed Web Origins, or sign-in fails with a callback mismatch.

## Tests

```
cd backend
pytest
```

The donor-registry tests need a scratch Postgres (they add rows), and are skipped without one:
`TEST_DATABASE_URL=postgres://... pytest`. The sign-in tests mint their own tokens with a
locally generated key pair, so they need no Auth0 account; they check that forged, expired,
wrong-audience and wrong-issuer tokens are refused. Frontend: `cd frontend && npx tsc --noEmit
&& npm run build`.
