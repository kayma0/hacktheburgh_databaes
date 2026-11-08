"""Charity accounts: who is asking, as a row in the `charities` table.

Auth0 proves who someone is (the verified token's user id); this module makes sure that
charity has a row, so its donors, outreach and saved plans can point at it. Without Auth0
configured the app has one charity, LOCAL_ID, and needs no sign-in.
"""
from __future__ import annotations

from fastapi import Header

from . import auth as auth_mod
from . import db

LOCAL_ID = "local"


def touch(charity: str, name: str | None = None) -> None:
    """Create the charity's row on first sight; afterwards note when it was last seen and,
    if given, its name."""
    with db.pool().connection() as conn:
        conn.execute(
            """INSERT INTO charities (id, name) VALUES (%(id)s, %(name)s)
               ON CONFLICT (id) DO UPDATE
               SET last_seen = now(), name = COALESCE(EXCLUDED.name, charities.name)""",
            {"id": charity, "name": name},
        )


def current_charity(authorization: str | None = Header(default=None)) -> str:
    """FastAPI dependency: the charity behind this request. With Auth0 set up, a valid sign-in
    is required (401 otherwise); without it, everyone is the local charity."""
    if auth_mod.auth_config() is None:
        charity = LOCAL_ID
    else:
        charity = auth_mod.current_user(authorization)
    if db.is_configured():
        touch(charity)
    return charity
