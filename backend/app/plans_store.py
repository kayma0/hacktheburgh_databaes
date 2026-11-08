"""Saved drive plans, in the `saved_plans` table (Postgres on Tiger Data).

A saved plan is only the *settings* (the plan's query string), never results or personal
data: the server rebuilds the plan from them, so a saved plan can't go stale or be forged
into showing other numbers. Every query is scoped to the charity in SQL.
"""
from __future__ import annotations

from urllib.parse import parse_qsl, urlencode

from . import db

MAX_PLANS_PER_CHARITY = 50
ALLOWED_KEYS = {"c", "p", "d", "on", "s"}  # the plan page's settings (frontend/src/scenario.ts)


def clean_query(query: str) -> str:
    """Keep only the known plan settings, so a saved plan can't carry anything else."""
    pairs = [(k, v[:40]) for k, v in parse_qsl(query.lstrip("#?"), keep_blank_values=False) if k in ALLOWED_KEYS]
    return urlencode(pairs)


def _out(row: dict) -> dict:
    return {**row, "created_at": row["created_at"].isoformat(timespec="seconds")}


def list_plans(charity: str) -> list[dict]:
    with db.pool().connection() as conn:
        rows = conn.execute(
            "SELECT id, name, country, query, created_at FROM saved_plans"
            " WHERE charity_id = %s ORDER BY id DESC",
            (charity,),
        ).fetchall()
    return [_out(r) for r in rows]


def add_plan(charity: str, name: str, country: str, query: str) -> dict:
    """Raises ValueError when the charity already has MAX_PLANS_PER_CHARITY plans."""
    with db.pool().connection() as conn:
        n = conn.execute("SELECT count(*) AS n FROM saved_plans WHERE charity_id = %s", (charity,)).fetchone()["n"]
        if n >= MAX_PLANS_PER_CHARITY:
            raise ValueError("too_many")
        row = conn.execute(
            """INSERT INTO saved_plans (charity_id, name, country, query)
               VALUES (%s, %s, %s, %s)
               RETURNING id, name, country, query, created_at""",
            (charity, name, country, query),
        ).fetchone()
    return _out(row)


def delete_plan(charity: str, plan_id: int) -> bool:
    with db.pool().connection() as conn:
        cur = conn.execute("DELETE FROM saved_plans WHERE id = %s AND charity_id = %s", (plan_id, charity))
        return cur.rowcount > 0
