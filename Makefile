# SickleSignal: one-command dev workflow
PY ?= python3
VENV = backend/.venv
BIN = $(VENV)/bin

.PHONY: setup lock sample test cv dev demo api web clean

setup:            ## install backend + frontend dependencies
	$(PY) -m venv $(VENV)
	$(BIN)/pip install -U pip
	$(BIN)/pip install -r backend/requirements.txt
	cd frontend && npm install
	@test -f .env || cp .env.example .env

lock:             ## write pinned lockfiles
	$(BIN)/pip freeze > backend/requirements.lock
	@echo "frontend lockfile: frontend/package-lock.json (created by npm install)"

sample:           ## (re)generate placeholder SAMPLE data
	$(BIN)/python scripts/make_sample_data.py

test:             ## run backend tests
	cd backend && .venv/bin/python -m pytest -q

cv:               ## write docs/CV_REPORT.md for the loaded data
	set -a; [ -f .env ] && . ./.env; set +a; $(BIN)/python scripts/cv_report.py

api:
	set -a; [ -f .env ] && . ./.env; set +a; \
	if [ -n "$(DEMO_MODE)" ]; then export DATA_MODE=$(DEMO_MODE); fi; \
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8000

web:
	cd frontend && npm run dev

dev:              ## API + frontend with REAL data (fails loudly if files are missing)
	$(MAKE) -j2 api web

demo:             ## offline demo with placeholder SAMPLE data
	$(MAKE) sample
	$(MAKE) -j2 api web DEMO_MODE=sample

clean:
	rm -rf backend/.venv frontend/node_modules sicklesignal.db
