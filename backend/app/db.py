"""Postgres connection: charities, their donors, outreach log and saved plans.

Set DATABASE_URL in .env to a Tiger Data (Tiger Cloud) service string; any Postgres works too.
Without it the rest of the app works as before, and the donor and saved-plan endpoints say
no database is connected.
"""
from __future__ import annotations

import logging
import os
import threading
from pathlib import Path

log = logging.getLogger(__name__)

SCHEMA_SQL = Path(__file__).with_name("schema.sql")
_pool = None
_timescale = False
_lock = threading.Lock()


def is_configured() -> bool:
    return bool(os.environ.get("DATABASE_URL"))


def pool():
    """The shared connection pool, opened (and the schema created) on first use."""
    global _pool
    with _lock:
        if _pool is None:
            from psycopg.rows import dict_row
            from psycopg_pool import ConnectionPool

            _pool = ConnectionPool(
                os.environ["DATABASE_URL"],
                min_size=1,
                max_size=5,
                kwargs={"row_factory": dict_row},
                open=True,
            )
            _ensure_schema()
    return _pool


def has_timescale() -> bool:
    """True on Tiger Data / TimescaleDB, where the outreach log is a hypertable."""
    pool()
    return _timescale


def _ensure_schema() -> None:
    """Create the tables if missing. On TimescaleDB the outreach log becomes a hypertable
    partitioned by time; on plain Postgres it stays an ordinary table."""
    global _timescale
    with _pool.connection() as conn:
        conn.execute(SCHEMA_SQL.read_text(encoding="utf-8"))
        _timescale = bool(conn.execute(
            "SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb'"
        ).fetchone())
        if _timescale:
            conn.execute("CREATE EXTENSION IF NOT EXISTS timescaledb")
            conn.execute("SELECT create_hypertable('outreach', by_range('at'), if_not_exists => TRUE)")
    log.info("Database ready (TimescaleDB: %s)", _timescale)


def close() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None
