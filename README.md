# SickleSignal

Models blood demand from sickle cell disease (SCD) and the donors needed to cover it, for
charity teams planning blood-donation drives. All figures are modelled with uncertainty
ranges (P10/P50/P90) — see [docs/METHOD.md](docs/METHOD.md) for sources and assumptions.

Not a medical device. No clinical advice. Aggregate data only.

## How the blood reservoir page works

The app has two pages: a heatmap of Africa (01 Hotspots) and a blood reservoir page for
one country (02 Blood reservoir). The map zooms with the + / − buttons, a pinch, Ctrl (or
⌘) + scroll or a double-click, and pans by dragging once zoomed in; this works by changing
the SVG's `viewBox` (`useMapZoom` in `frontend/src/App.tsx`). When you tap a country on the map, the frontend stores
it as the selected country; the "{country}'s blood reservoir →" button and the 02 tab
both open the reservoir page for that country. That page calls
`GET /api/reservoir?country=<name>&share_in_care=<0-1>` on the FastAPI backend
(`backend/app/reservoir.py`). The backend looks the country up in
`data/blood_supply.csv` (WHO donations, population, blood-group mix, national reserve
target) and in the GBD sickle cell data by age, runs 10,000 random draws of the model,
and returns, for each of the 8 blood groups, the days of stock it could hold
(P10/P50/P90), donations per day, units used per day and extra donations needed. Each
blood bag is an SVG drawn in React (`BloodBag` in `frontend/src/App.tsx`): the red level
is a wavy path whose height is the median days divided by the country's target, so a full
bag means the target is met; a CSS transition slides the level to its new height and a
looping animation makes the surface ripple. The "People with SCD in care" slider changes
`share_in_care`; the page waits 200 ms after you stop dragging, asks the backend again
and the bags animate to their new levels while the table updates. The bag levels are modelled
from what a country collects versus what it uses. They are not live stock counts; see
[docs/METHOD.md](docs/METHOD.md#blood-reservoir-page-backendappreservoirpy-reads-databloodsupplycsv--datamale_rawcsv--datafemale_rawcsv)
for every source and assumption.

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
