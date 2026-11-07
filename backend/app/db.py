"""Persistence: briefing cache and saved drive plans (aggregate numbers only, no personal data).

Uses SQLAlchemy with DATABASE_URL (Postgres, e.g. Tiger Data) and falls back to SQLite, so the app
runs with zero setup. If SQLAlchemy itself is not installed, an in-memory store is used instead.
"""
from __future__ import annotations

import json
import threading
import time
from typing import Any

try:  # pragma: no cover - exercised when sqlalchemy is installed
    from sqlalchemy import Column, Float, Integer, String, Text, create_engine, select
    from sqlalchemy.orm import Session, declarative_base

    Base = declarative_base()

    class BriefingCache(Base):
        __tablename__ = "briefing_cache"
        key = Column(String(64), primary_key=True)
        payload = Column(Text, nullable=False)
        created_at = Column(Float, nullable=False)

    class DrivePlan(Base):
        __tablename__ = "drive_plans"
        id = Column(Integer, primary_key=True, autoincrement=True)
        created_at = Column(Float, nullable=False)
        iso3 = Column(String(3), nullable=False)
        admin1 = Column(String(200))
        partner_service = Column(String(200), nullable=False)
        payload = Column(Text, nullable=False)

    HAVE_SQLA = True
except ImportError:  # pragma: no cover
    HAVE_SQLA = False


class Store:
    def __init__(self, url: str):
        self._mem: dict[str, tuple[float, str]] = {}
        self._plans: list[dict] = []
        self._lock = threading.Lock()
        self.backend = "memory"
        self.engine = None
        if HAVE_SQLA:
            try:
                kw = {"connect_args": {"check_same_thread": False}} if url.startswith("sqlite") else {"pool_pre_ping": True}
                self.engine = create_engine(url, **kw)
                Base.metadata.create_all(self.engine)
                self.backend = "sqlite" if url.startswith("sqlite") else "postgres"
            except Exception as e:  # noqa: BLE001 - fall back loudly in logs, keep the demo running
                print(f"[db] could not connect to {url.split('@')[-1]}: {e}. Using in-memory store.")
                self.engine = None

    def get_briefing(self, key: str, ttl_s: float) -> dict | None:
        now = time.time()
        if self.engine is not None:
            with Session(self.engine) as s:
                row = s.get(BriefingCache, key)
                if row and now - row.created_at < ttl_s:
                    return json.loads(row.payload)
            return None
        with self._lock:
            hit = self._mem.get(key)
        if hit and now - hit[0] < ttl_s:
            return json.loads(hit[1])
        return None

    def put_briefing(self, key: str, payload: dict) -> None:
        data = json.dumps(payload)
        if self.engine is not None:
            with Session(self.engine) as s:
                s.merge(BriefingCache(key=key, payload=data, created_at=time.time()))
                s.commit()
            return
        with self._lock:
            self._mem[key] = (time.time(), data)

    def save_plan(self, plan: dict[str, Any]) -> int:
        data = json.dumps(plan)
        if self.engine is not None:
            with Session(self.engine) as s:
                row = DrivePlan(created_at=time.time(), iso3=plan["iso3"], admin1=plan.get("admin1"),
                                partner_service=plan["partner_service"], payload=data)
                s.add(row)
                s.commit()
                return int(row.id)
        with self._lock:
            self._plans.append(plan)
            return len(self._plans)

    def list_plans(self, limit: int = 20) -> list[dict]:
        if self.engine is not None:
            with Session(self.engine) as s:
                rows = s.execute(select(DrivePlan).order_by(DrivePlan.id.desc()).limit(limit)).scalars().all()
                return [{"id": r.id, "created_at": r.created_at, **json.loads(r.payload)} for r in rows]
        with self._lock:
            return list(reversed(self._plans[-limit:]))
