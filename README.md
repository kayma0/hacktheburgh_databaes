# SickleSignal

Models blood demand from sickle cell disease (SCD) and the donors needed to cover it, for
charity teams planning blood-donation drives. All figures are modelled with uncertainty
ranges (P10/P50/P90) — see [docs/METHOD.md](docs/METHOD.md) for sources and assumptions.

Not a medical device. No clinical advice. Aggregate data only.

## How the blood reservoir page works

The app has two pages: a heatmap of Africa and a blood reservoir page for one country,
linked by buttons on each page (there is no nav bar). The map zooms with the + / − buttons, a pinch, Ctrl (or
⌘) + scroll or a double-click, and pans by dragging once zoomed in; this works by changing
the SVG's `viewBox` (`useMapZoom` in `frontend/src/App.tsx`). When you tap a country on the map, the frontend stores
it as the selected country; the "{country}'s blood reservoir →" button opens the
reservoir page for that country, and "← Back to hotspots" returns to the map. That page calls
`GET /api/reservoir?country=<name>&share_in_care=<0-1>` on the FastAPI backend
(`backend/app/reservoir.py`). The backend looks the country up in
`data/blood_supply.csv` (WHO donations, population, blood-group mix, national reserve
target) and in the GBD sickle cell data by age, runs 10,000 random draws of the model,
and returns, for each of the 8 blood groups, the days of stock it could hold
(P10/P50/P90), donations per day, units used per day and extra donations needed. Each
blood bag is an SVG drawn in React (`BloodBag` in `frontend/src/App.tsx`): the red level
is a wavy path whose height is the median days divided by the country's target, so a full
bag means the target is met; a CSS transition slides the level to its new height and a
looping animation makes the surface ripple (the page uses the default 30% of people with
SCD in care). The bag levels are modelled
from what a country collects versus what it uses. They are not live stock counts; see
[docs/METHOD.md](docs/METHOD.md#blood-reservoir-page-backendappreservoirpy-reads-databloodsupplycsv--datamale_rawcsv--datafemale_rawcsv)
for every source and assumption.

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
the rate it collects blood. Short of O+, O−…", with a table by blood group and a donut of
who is in crisis by age. Each run covers sickle cell crises only and assumes nothing else
happens. Collections are trend-fitted to WHO
2014–2018 and newer national figures and projected to this year (`backend/app/trends.py`).

## Run locally

Backend:

```
cd backend
pip install -r requirements.txt
cp ../.env.example ../.env   # fill in GEMINI_API_KEY if you have one
uvicorn app.main:app --reload --port 8000
```

Frontend:

```
cd frontend
npm install
npm run dev
```

Open http://localhost:5173.

## Tests

```
cd backend
pytest
```

## Docker (single container, serves built frontend from FastAPI)

```
docker build -t sicklesignal .
docker run -p 8000:8000 --env-file .env sicklesignal
```
