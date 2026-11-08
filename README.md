# SickleSignal

Models blood demand from sickle cell disease (SCD) and the donors needed to cover it, for
charity teams planning blood-donation drives. All figures are modelled with uncertainty
ranges (P10/P50/P90) — see [docs/METHOD.md](docs/METHOD.md) for sources and assumptions.

Not a medical device. No clinical advice. Aggregate data only.

## Live demo

You can access our live demo until 7.12.2026:
https://hacktheburghdatabaes-production.up.railway.app/

## What a charity does with it

SickleSignal follows a charity team from "where is the need?" to "who do we ask, and how?".
Four pages, linked by buttons on each page (no nav bar); each page's settings live in the
address bar, so Back and a copied link rebuild what was on screen.

1. **Hotspots map** (`#/hotspots`). Africa shaded by how many people live with sickle cell
   disease (`data/processed/heatmap.json`). Tap a country, then "{country}'s blood
   reservoir →". The map zooms with + / −, a pinch, Ctrl (or ⌘) + scroll or a double-click,
   and pans by dragging once zoomed in.
2. **Blood reservoir + crisis simulator** (`#/reservoir`). Modelled days of stock for each
   blood group, then a simulation of whether the country's supply could cover N people in a
   sickle cell crisis, with who is in crisis, what to do and a table by blood group.
   "Plan the drive →" carries that exact run (including its random seed) to page 3.
3. **Plan a blood drive** (`#/plan`). Opens on the crisis statement from page 2 (same
   simulation, rebuilt from its seed by `GET /api/crisis` and `GET /api/plan`), then:
   **Reach donors** (write the urgent appeal and send it to registered donors, below),
   **What this rests on** (every assumption, sourced or not) and **How far to trust this**
   (a back-test of the case-trend method, fit to data up to 2018 and predicted after, and
   which assumption moves the donor numbers most). It prints as one page, copies as plain
   text, and "← Back to the crisis simulator" restores the same run on page 2.
4. **Before you travel** (`#/briefing`, `POST /api/briefing`, `backend/app/briefing.py`). A
   trip checklist written by Gemini for the country in question. It opens with a "Current
   situation" section built from the UK government's live advice, which
   `backend/app/travel_advice.py` fetches from the free gov.uk Content API: the advisory
   status, the date gov.uk last changed the page, and the safety and regional-risk text.
   Gemini is never asked what the advice is, so it cannot invent an advisory, and if Gemini
   is unavailable the gov.uk facts still lead a fixed starter list. Built from the country
   alone, with no user input. Entry and visa rules are kept general on purpose: FCDO advice
   is written for British passport holders and we do not know a visitor's nationality.

### The blood reservoir page

It calls `GET /api/reservoir?country=<name>` (`backend/app/reservoir.py`), which looks the
country up in `data/blood_supply.csv` (WHO donations, population, blood-group mix, national
reserve target) and in the GBD sickle cell data by age, runs 10,000 random draws, and
returns, for each of the 8 blood groups, the days of stock it could hold, donations per
day, units used per day and extra donations needed. Each blood bag
(`frontend/src/components/BloodBag.tsx`) is filled to the median days divided by the
country's target, so a full bag means the target is met. These are modelled from what a
country collects versus what it uses, not live stock counts.

### Crisis simulator

Two sliders (people in crisis, 1–50, and a time frame, 1 day to a year) and a Run button
call `GET /api/crisis?country=<name>&people=<n>&days=<d>` (`backend/app/crisis.py`). It
draws a pool of 100 patients from the country's sickle cell age/sex mix (trend-projected to
this year from `data/male_raw.csv` / `data/female_raw.csv`) with blood groups from
`data/blood_groups_simple.json`, then runs 5,000 Monte Carlo draws: pick N patients, give
each a random crisis day and an age-based dose, and serve them in order from the blood their
group has left after normal hospital use, so the simulator models crisis treatment alone.
One switch changes the rule: "Use O− when a group runs out". The same `seed` always gives
the same run. Each run covers sickle cell crises only and assumes nothing else happens.
Collections are trend-fitted to WHO 2014–2018 and newer national figures and projected to
this year (`backend/app/trends.py`).

### Reach donors (plan page)

Two steps. **1. Write the urgent appeal** (`POST /api/appeal`, `backend/app/appeal.py`):
Gemini (or a template) drafts it for WhatsApp, SMS and email from the crisis facts only;
the charity can edit it or Rewrite it, and picks the channel. **2. Send it to your donors**:
`POST /api/donors/match` lists the registered donors of each blood type the crisis needs,
and the charity chooses who gets it:

- **Only those who can give now** (default): donors whose last donation was at least 12
  weeks ago (or who have never given). Each gets the appeal with their name and a nudge in
  front: "Dear Ama, the last time you gave blood was 14 March 2026, so you are able to
  donate again…". One link per donor, so each message is personal.
- **Everyone with these blood types**: the appeal as written, including donors who gave
  recently (they can share it). By email or SMS the whole group can be sent in one go
  (email recipients go in BCC); WhatsApp is one donor at a time.

Every send is logged as "contacted" (`POST /api/outreach`, one donor or a whole group); the
Pledged / Can't buttons log the reply, and pledges fill the group's progress bar.
"+ Add a donor" registers someone new (`POST /api/donors`; consent and a phone or email are
required). Nothing is sent automatically: each link opens WhatsApp, SMS or email with the
message ready, and the charity sends it.

## Database: Tiger Data, with Auth0 for sign-in

Auth0 and the database split the work:

- **Auth0** keeps the logins: each charity's email and (hashed) password in Auth0's own user
  database, or its Google account. The app never sees a password. Each account has a stable
  Auth0 user id, e.g. `auth0|65f…` or `google-oauth2|10…`.
- **Tiger Data** (Postgres with TimescaleDB, on Tiger Cloud) keeps everything a charity does,
  keyed by that id. The server reads the id only from a verified Auth0 token, never from the
  browser, so one charity can never see or change another's data.

Tables (`backend/app/schema.sql`, created automatically on first use):

| Table         | What it holds                                                                                                                                                                                                                                                                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `charities`   | One row per charity account (its Auth0 user id and name), created on its first request.                                                                                                                                                                                                     |
| `donors`      | Name, phone, email, blood type, country, consent to be contacted, date they last gave blood, and the charity they belong to. Demo donors belong to no charity, and every charity sees them.                                                                                                 |
| `outreach`    | Every contact and reply (contacted / pledged / declined), with time, channel and charity. On Tiger Data it is a **hypertable** partitioned by time, and "This week: 12 messages sent · 4 pledged" under Reach donors comes from a `time_bucket` query on it (`GET /api/outreach/activity`). |
| `saved_plans` | Drive plans a charity saved (settings only, never results).                                                                                                                                                                                                                                 |

Without Auth0 configured (local mode) the app has one charity, `local`, and needs no sign-in.

Set up:

1. Create a free service at https://console.cloud.timescale.com (Tiger Cloud) and copy its
   connection string.
2. Add it to `.env`: `DATABASE_URL=postgres://tsdbadmin:...@....tsdb.cloud.timescale.com:.../tsdb?sslmode=require`
3. Load the demo donors: `cd backend && python -m app.seed` (40 per country; `--reset`
   replaces them). They are fictional: phone numbers use +999, a code no country has, and
   emails use example.org, so no message reaches a real person. Add your own number with
   "+ Add a donor" to see a real message arrive.

Without `DATABASE_URL` everything else works and the donor card says no database is
connected.

## Code layout

- `backend/app/`: `main.py` (API routes), `schemas.py` (request/response models),
  `hotspots.py`, `reservoir.py`, `trends.py`, `crisis.py`, `plan.py`, `backtest.py` (the
  models), `blood.py` (shared constants), `appeal.py` (the urgent appeal, Gemini),
  `briefing.py` + `travel_advice.py` (travel checklist), `db.py` + `schema.sql` (the
  database), `auth.py` + `charities.py` (Auth0 sign-in, charity accounts), `donors.py`
  (donor registry), `plans_store.py` (saved plans), `seed.py` (demo donors), `timeout.py`
  (time limit for Gemini calls).
- `frontend/src/`: `App.tsx` (shell and routing), `api.ts` (typed API client), `format.ts`
  (number and date formatting), `scenario.ts` (the crisis run in the address bar), `auth.tsx`
  (Auth0 sign-in), `Landing.tsx` + `landing.css` (the landing page), `pages/`
  (map, reservoir, plan, trust panel, travel brief), `components/` (blood bag, slider,
  switch, source tag, logo), `simulator/` (simulator, result, appeal and donor outreach).

## Run locally

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
npm run dev
```

Open http://localhost:5173. Without any keys the app works fully: the appeal and the travel
checklist use their templates, and the donor card says no database is connected.

Gemini (optional): put `GEMINI_API_KEY` in `.env`. Appeals use `gemini-3.5-flash` (then
`-lite`, then the template); the travel checklist uses `GEMINI_BRIEFING_MODEL` (default
`gemini-3.5-flash-lite`). If a call fails the
app falls back to its templates and says so.

### Sign-in with Auth0 (optional)

Auth0 handles the login. With it set up, signed-out visitors land on the landing page
(`frontend/src/Landing.tsx`, styled by `landing.css`): "Spot the need. Send the signal.", with
a card to **log in** or **register your charity**, by email or **with Google**. There is no
guest mode: a charity signs in to use the app. Signed in, the header shows the user's name and
"Sign out". Without the Auth0 values the app skips the landing page and runs as normal (local
mode). The server only ever trusts the verified token, never the browser; see "Database"
above for what it keeps under each charity's Auth0 user id.

1. Create an Auth0 tenant (free tier is enough).
2. **Applications → Create Application → Single Page Web Applications.** Set _Allowed Callback
   URLs_, _Allowed Logout URLs_ and _Allowed Web Origins_ to `http://localhost:5173` (and your
   deployed URL). Copy the **Domain** and **Client ID**. For "Continue with Google", enable the
   Google social connection for this application (Authentication → Social).
3. **APIs → Create API.** Choose any identifier, e.g. `https://sicklesignal/api`; that is the
   **Audience**. In its settings, turn on **Allow Offline Access** (needed so people stay signed
   in) and keep the signing algorithm RS256.
4. Fill in `.env` (the frontend reads the `VITE_` lines from the same file):

```
AUTH0_DOMAIN=your-tenant.eu.auth0.com
AUTH0_AUDIENCE=https://sicklesignal/api
VITE_AUTH0_DOMAIN=your-tenant.eu.auth0.com
VITE_AUTH0_CLIENT_ID=<the SPA's client id>
VITE_AUTH0_AUDIENCE=https://sicklesignal/api
```

5. Restart both servers (Vite reads `VITE_` values when it starts). The landing page and the
   header's "Sign in" appear. None of these values is a secret, and no client secret is ever
   used.

## Tests

```
cd backend
pytest
```

The donor-registry tests need a scratch Postgres (they add rows):
`TEST_DATABASE_URL=postgres://... pytest`.

## Docker (single container, serves built frontend from FastAPI)

```
docker build -t sicklesignal \
  --build-arg VITE_AUTH0_DOMAIN=your-tenant.eu.auth0.com \
  --build-arg VITE_AUTH0_CLIENT_ID=<client id> \
  --build-arg VITE_AUTH0_AUDIENCE=https://sicklesignal/api .   # build args are optional
docker run -p 8000:8000 --env-file .env sicklesignal
```
