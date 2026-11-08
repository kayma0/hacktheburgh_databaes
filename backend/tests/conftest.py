"""Shared test setup: sign-in modes (tokens come from tokens.py) and a scratch Postgres for
the database tests (TEST_DATABASE_URL; they wipe its tables, so never point it at a real
database)."""
import os

import pytest
from fastapi.testclient import TestClient

from app import db
from app.main import app

from .tokens import AUD, DOMAIN, KEY

TEST_DB = os.environ.get("TEST_DATABASE_URL")


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def local_mode(monkeypatch):
    """No Auth0: everyone is the local charity."""
    monkeypatch.delenv("AUTH0_DOMAIN", raising=False)
    monkeypatch.delenv("AUTH0_AUDIENCE", raising=False)


@pytest.fixture
def signed_in(monkeypatch):
    """Auth0 configured, with our own key standing in for the tenant's."""
    from app import auth as auth_mod

    monkeypatch.setenv("AUTH0_DOMAIN", DOMAIN)
    monkeypatch.setenv("AUTH0_AUDIENCE", AUD)
    monkeypatch.setattr(auth_mod, "_signing_key", lambda tok, domain: KEY.public_key())


@pytest.fixture
def test_db(monkeypatch):
    """An empty scratch database; the test is skipped without TEST_DATABASE_URL."""
    if not TEST_DB:
        pytest.skip("TEST_DATABASE_URL not set")
    monkeypatch.setenv("DATABASE_URL", TEST_DB)
    db.close()
    with db.pool().connection() as conn:
        conn.execute("TRUNCATE charities, donors, outreach, saved_plans RESTART IDENTITY CASCADE")
    yield
    db.close()
