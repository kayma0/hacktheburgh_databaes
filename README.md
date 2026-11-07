# SickleSignal

**For charity programme staff running voluntary blood-donation drives.** In sub-Saharan Africa many children with sickle
cell disease (SCD) are undiagnosed and blood is scarce. SickleSignal answers three questions, with honest uncertainty:

1. **Where** is the modelled paediatric SCD blood shortfall largest?
2. **How many** donors and drives would cover a chosen share of it?
3. **What** should the team look out for when they go there? (Gemini field briefing)

Every number about children, transfusion need and blood units is **MODELLED** and shown as **P50 (P10–P90)**.
Assumptions are flagged and adjustable. ML-filled gaps are badged **ML-IMPUTED**. See [`docs/METHOD.md`](docs/METHOD.md).

> Not a medical device. No clinical advice. Aggregate data only. Donation must be voluntary, unpaid and run through the
> national blood transfusion service or a licensed blood bank; the planner refuses to plan otherwise.

## Quick start

```bash
make setup          # Python venv + npm install, copies .env.example to .env
make test           # backend tests
make demo           # offline demo on PLACEHOLDER data (red SAMPLE DATA banner) -> http://localhost:5173
```

With real data:

1. Put the files listed in [`data/raw/README.md`](data/raw/README.md) into `data/raw/`.
2. Set `DATA_MODE=real` in `.env` (default). Add `GEMINI_API_KEY` and `GEMINI_MODEL` from AI Studio for the briefing.
3. `make dev` → API on :8000, app on :5173. If a file is missing, the API still starts but model endpoints return
   HTTP 503 with instructions, and the app shows them.
4. `make cv` writes `docs/CV_REPORT.md` (leave-one-country-out results) for the slides.

## Layout

```
backend/app/
  loaders.py      file loaders + validation (fail loudly, with instructions)
  dataset.py      assembles the country table; fills gaps with labelled ML imputation
  imputation.py   quantile gradient boosting + conformal intervals, leave-one-country-out CV
  params.py       parameters.yaml: validation, user overrides, sampling
  montecarlo.py   vectorised seeded Monte Carlo, scenarios, rank stability, admin1/facility split, tornado
  planner.py      Donor Drive Planner (+ CSV export); enforces the licensed-partner rule
  briefing.py     Gemini briefing: grounded -> ungrounded (schema) -> static fallback; cache + rate limit
  db.py           SQLAlchemy store (Postgres via DATABASE_URL, SQLite fallback, in-memory last resort)
  service.py      everything the API does, testable without FastAPI
  main.py         FastAPI routes
backend/tests/    pytest: reproducibility, monotonicity, interval ordering, loaders, ML calibration, planner rules, API
config/parameters.yaml   SOURCED vs ASSUMPTION parameters with ranges and citation TODOs
frontend/         React + Vite + TypeScript + Tailwind + React Query + Recharts + Leaflet
scripts/          sample-data generator, CV report
```

## API

| Method | Path | What |
|---|---|---|
| GET | `/api/health`, `/api/meta` | status, files present, sample flag, countries + regions |
| GET | `/api/parameters` | parameters with SOURCED / ASSUMPTION flags |
| POST | `/api/simulate` | per-country P10/P50/P90, totals, rank stability (`{source, overrides, rank_by}`) |
| POST | `/api/admin1`, `/api/facilities` | regional split and facility view (ASSUMPTION-labelled) |
| POST | `/api/sensitivity` | tornado data |
| POST | `/api/plan`, `/api/plan.csv` | drive plan and CSV export (MODELLED ESTIMATE) |
| POST | `/api/briefing` | Gemini field briefing (rate-limited, cached) |
| GET | `/api/method` | formulas, assumptions, limitations, CV results |
| GET | `/api/geo/admin0` | country boundaries for the map |

`overrides` example: `{"share_diagnosed": {"mean": 0.2}, "units_per_event": {"mode": 1.5}}`.

## Stretch (not built)

Auth0 login, ElevenLabs read-aloud of the briefing, Postgres on Tiger Data (just set `DATABASE_URL`).
