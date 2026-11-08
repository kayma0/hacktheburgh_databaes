# SickleSignal

Models blood demand from sickle cell disease (SCD) and the donors needed to cover it, for
charity teams planning blood-donation drives. All figures are modelled with uncertainty
ranges (P10/P50/P90) — see [docs/METHOD.md](docs/METHOD.md) for sources and assumptions.

Not a medical device. No clinical advice. Aggregate data only.

##Live demo

You can access our live demo until 7.12.2026:
https://hacktheburghdatabaes-production.up.railway.app/

## What a charity does with it

SickleSignal follows a charity team from "where is the need?" to "what do we ask for?":

1. **Hotspots map.** Africa shaded by how many people live with sickle cell disease
   (`data/processed/heatmap.json`). Tap a country, then "{country}'s blood reservoir →".
2. **Blood reservoir + crisis simulator.** Modelled days of stock for each blood group, and a
   simulation of whether the country's supply could cover N people in a sickle cell crisis.
3. **Drive plan** (`GET /api/plan`, `backend/app/plan.py`). Turns those two models into a
   decision: which blood groups to push for, and about how many regular and one-off donors to
   recruit, for a share of the sickle cell blood need you choose. It prints as one page
   ("Print / save as PDF"), copies as plain text, and its settings live in the URL, so a
   copied link rebuilds the same plan. A "How far to trust this" panel shows a back-test of
   the case-trend method (fit to data up to 2018, predict after) and which assumption moves
   the donor numbers most.
4. **Appeal writer** (`POST /api/appeal`, `backend/app/appeal.py`). Gemini writes a donor email,
   social post, SMS or poster from the plan's numbers. The server recomputes the plan itself,
   the reply must say donation is voluntary and unpaid and may not contain a number it wasn't
   given, and a fixed template is used if Gemini is missing, slow or breaks a rule. The app
   only writes text: it never sends a message and never stores donor details.
5. **Before you travel** (`POST /api/briefing`). A starter checklist for a visiting team
   (Gemini, or a fixed list), with official government travel advice linked first.
6. **Saved plans.** Sign in with Auth0 to keep plans in your account; without Auth0 they stay
   in the browser.

Everything is modelled, not live stock; see [docs/METHOD.md](docs/METHOD.md) for every source
and assumption. The map zooms with + / −, a pinch, Ctrl (or ⌘) + scroll or a double-click, and
pans by dragging once zoomed in.

### Crisis simulator

Under the bags, the **crisis simulator** has two sliders (people in crisis, 1-50, and a
time frame, 1 day to a year) and a Run button. It calls
`GET /api/crisis?country=<name>&people=<n>&days=<d>` (`backend/app/crisis.py`), which
draws a fresh pool of 100 patients from the country's sickle cell age/sex mix
(trend-projected to this year from `data/male_raw.csv` / `data/female_raw.csv`) with blood
groups from `data/blood_groups_simple.json`, then runs 5,000 Monte Carlo draws: pick N
patients at random, give each a random crisis day and an age-based dose, and serve them in
order from the blood their group has left after normal hospital use. Two switches change the
rules: "Use O− when a group runs out" (the universal donor covers patients whose group is
empty) and "Crisis patients first" (other hospital patients wait); "Reset to default blood
rates" restores the defaults. The answer reads like "For 25 people (8 under-5s, 4 children
aged 5–9, 9 teens and 4 adults) over 30 days, Ghana does not have enough blood because of
the rate it collects blood. Short of O+, O−…", with headline numbers, a dated plan of how many
donors of each blood group to recruit and by when, and a table by blood group. "Draft
donor appeal" (`POST /api/crisis-appeal`) turns the plan into a WhatsApp, SMS or email message (written by Gemini when
`GEMINI_API_KEY` is set in `.env`, otherwise a template) that opens ready to send. Each run covers sickle cell crises only and assumes nothing else
happens. Collections are trend-fitted to WHO
2014–2018 and newer national figures and projected to this year (`backend/app/trends.py`).

## Run locally

Backend:

```
python -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
cp .env.example .env          # all optional; see below
cd backend && uvicorn app.main:app --reload --port 8000
```

Frontend:

```
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Without any keys the app works fully: the appeal writer uses its
template, the travel brief uses its fixed checklist, and saved plans stay in the browser.

### Gemini (optional)

Put `GEMINI_API_KEY` in `.env`. Check `GEMINI_MODEL` is a model your key can use; if a call fails
or breaks a rule the app silently falls back to its templates and says so under the text.

### Sign-in with Auth0 (optional)

Auth0 handles the login screen. Our server stores saved plans (SQLite) keyed by the verified
Auth0 user id, and only ever trusts the token, never the browser.

1. Create an Auth0 tenant (free tier is enough).
2. **Applications → Create Application → Single Page Web Applications.** Set *Allowed Callback
   URLs*, *Allowed Logout URLs* and *Allowed Web Origins* to `http://localhost:5173` (and your
   deployed URL). Copy the **Domain** and **Client ID**.
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

5. Restart both servers. A "Sign in" button appears in the header, and "Saved plans" now
   needs sign-in. None of these values is a secret, and no client secret is ever used.

Saved plans live in `backend/plans.db` (git-ignored; change it with `PLANS_DB`). On Railway or any
host with a disposable disk, mount a volume and point `PLANS_DB` at it, or plans disappear on
redeploy.

## Tests

```
cd backend
pytest
```

The sign-in tests mint their own tokens with a locally generated key pair, so they need no Auth0
account; they check that forged, expired, wrong-audience and wrong-issuer tokens are refused and
that one user can never read or delete another's plans.

## Docker (single container, serves built frontend from FastAPI)

```
docker build -t sicklesignal \
  --build-arg VITE_AUTH0_DOMAIN=your-tenant.eu.auth0.com \
  --build-arg VITE_AUTH0_CLIENT_ID=<client id> \
  --build-arg VITE_AUTH0_AUDIENCE=https://sicklesignal/api .   # build args are optional
docker run -p 8000:8000 --env-file .env -v sicklesignal-data:/data -e PLANS_DB=/data/plans.db sicklesignal
```
