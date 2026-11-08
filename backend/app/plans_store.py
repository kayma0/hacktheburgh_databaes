"""Saved drive plans, one small SQLite table.

A saved plan is only the *settings* (the plan's query string), never results or personal
data: the server rebuilds the plan from them, so a saved plan can't go stale or be forged
into showing other numbers. Every query is scoped by the verified user id in SQL.

SQLite lives in a file (PLANS_DB, default backend/plans.db, git-ignored). On a host with a
disposable disk, mount a volume there or saved plans disappear on redeploy.
"""
from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qsl, urlencode

MAX_PLANS_PER_USER = 50
ALLOWED_KEYS = {"c", "p", "d", "df", "dpd", "cov", "on", "cf"}


def _path() -> Path:
    return Path(os.environ.get("PLANS_DB") or Path(__file__).resolve().parent.parent / "plans.db")


def _conn() -> sqlite3.Connection:
    con = sqlite3.connect(_path())
    con.row_factory = sqlite3.Row
    con.execute(
        "CREATE TABLE IF NOT EXISTS plans ("
        " id INTEGER PRIMARY KEY AUTOINCREMENT,"
        " user_sub TEXT NOT NULL,"
        " name TEXT NOT NULL,"
        " country TEXT NOT NULL,"
        " query TEXT NOT NULL,"
        " created_at TEXT NOT NULL)"
    )
    con.execute("CREATE INDEX IF NOT EXISTS plans_user ON plans(user_sub)")
    return con


def clean_query(query: str) -> str:
    """Keep only the known plan settings, so a saved plan can't carry anything else."""
    pairs = [(k, v[:40]) for k, v in parse_qsl(query.lstrip("#?"), keep_blank_values=False) if k in ALLOWED_KEYS]
    return urlencode(pairs)


def list_plans(user_sub: str) -> list[dict]:
    with _conn() as con:
        rows = con.execute(
            "SELECT id, name, country, query, created_at FROM plans WHERE user_sub = ? ORDER BY id DESC",
            (user_sub,)).fetchall()
    return [dict(r) for r in rows]


def add_plan(user_sub: str, name: str, country: str, query: str) -> dict:
    with _conn() as con:
        n = con.execute("SELECT COUNT(*) FROM plans WHERE user_sub = ?", (user_sub,)).fetchone()[0]
        if n >= MAX_PLANS_PER_USER:
            raise ValueError("too_many")
        created = datetime.now(timezone.utc).isoformat(timespec="seconds")
        cur = con.execute(
            "INSERT INTO plans (user_sub, name, country, query, created_at) VALUES (?, ?, ?, ?, ?)",
            (user_sub, name, country, query, created))
        return {"id": cur.lastrowid, "name": name, "country": country, "query": query, "created_at": created}


def delete_plan(user_sub: str, plan_id: int) -> bool:
    with _conn() as con:
        cur = con.execute("DELETE FROM plans WHERE id = ? AND user_sub = ?", (plan_id, user_sub))
        return cur.rowcount > 0
