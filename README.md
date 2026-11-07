# SickleSupply

Models blood demand from sickle cell disease (SCD) and the donors needed to cover it, for
charity teams planning blood-donation drives. All figures are modelled with uncertainty
ranges (P10/P50/P90) — see [docs/METHOD.md](docs/METHOD.md) for sources and assumptions.

Not a medical device. No clinical advice. Aggregate data only.

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
docker build -t sicklesupply .
docker run -p 8000:8000 --env-file .env sicklesupply
```
