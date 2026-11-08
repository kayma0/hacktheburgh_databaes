"""Donor registry queries, always for one charity: register a donor, list the donors of each
blood group for an appeal, log each contact and reply, and summarise recent activity.

A charity sees its own donors plus the shared demo donors (charity_id NULL), and only its own
outreach. Only donors who consented to be contacted are listed. A donor `can_donate` once
ELIGIBLE_AFTER_DAYS have passed since they last gave blood (or if they never have). Their
status in the current appeal is their latest outreach event from this charity within
CAMPAIGN_DAYS (contacted, pledged or declined).
"""
from __future__ import annotations

from . import db
from .schemas import DonorIn

# Minimum gap between whole-blood donations. 12 weeks is the shortest interval in common
# use (many services use 12 weeks for men, 16 for women); national rules may be stricter.
ELIGIBLE_AFTER_DAYS = 84
# Replies older than this belong to an earlier appeal and no longer count.
CAMPAIGN_DAYS = 30
# Donors listed per blood group (the counts always cover everyone on file).
MAX_LISTED_PER_GROUP = 200

DONOR_COLUMNS = "id, name, phone, email, blood_group, country, last_donated"
VISIBLE = "(d.charity_id IS NULL OR d.charity_id = %(charity)s)"

MATCH_SQL = f"""
WITH matched AS (
    SELECT d.id, d.name, d.phone, d.email, d.blood_group, d.country, d.last_donated,
           (d.last_donated IS NULL OR d.last_donated <= current_date - %(gap_days)s) AS can_donate,
           d.last_donated + %(gap_days)s AS can_donate_from,
           o.status, o.at AS status_at
    FROM donors d
    LEFT JOIN LATERAL (
        SELECT status, at FROM outreach
        WHERE charity_id = %(charity)s AND donor_id = d.id
          AND at > now() - make_interval(days => %(campaign_days)s)
        ORDER BY at DESC
        LIMIT 1
    ) o ON true
    WHERE {VISIBLE}
      AND d.country = %(country)s
      AND d.blood_group = ANY(%(groups)s)
      AND d.consent
), ranked AS (
    SELECT *,
           count(*) OVER w_group AS on_file,
           count(*) FILTER (WHERE can_donate) OVER w_group AS eligible,
           count(*) FILTER (WHERE status = 'pledged') OVER w_group AS pledged,
           row_number() OVER (
               -- Those who can give first, longest since they last gave first. The order
               -- does not depend on status, so a donor stays in place as it changes.
               PARTITION BY blood_group
               ORDER BY can_donate DESC, last_donated NULLS FIRST, name, id
           ) AS rank
    FROM matched
    WINDOW w_group AS (PARTITION BY blood_group)
)
SELECT * FROM ranked WHERE rank <= {MAX_LISTED_PER_GROUP} ORDER BY blood_group, rank
"""

# Contacts and replies per day. On Tiger Data `time_bucket` runs on the outreach hypertable;
# plain Postgres gets the same answer from date_trunc.
ACTIVITY_SQL = """
SELECT {bucket} AS day,
       count(*) FILTER (WHERE status = 'contacted') AS contacted,
       count(*) FILTER (WHERE status = 'pledged') AS pledged,
       count(*) FILTER (WHERE status = 'declined') AS declined
FROM outreach
WHERE charity_id = %(charity)s AND country = %(country)s
  AND at > now() - make_interval(days => %(days)s)
GROUP BY day
ORDER BY day
"""


def registered(charity: str, country: str) -> int:
    """Consenting donors this charity can see in `country`."""
    with db.pool().connection() as conn:
        row = conn.execute(
            f"SELECT count(*) AS n FROM donors d WHERE {VISIBLE} AND d.consent AND d.country = %(country)s",
            {"charity": charity, "country": country},
        ).fetchone()
    return row["n"]


def register(charity: str, donor: DonorIn) -> dict:
    """Add a donor to this charity's list."""
    with db.pool().connection() as conn:
        return conn.execute(
            f"""INSERT INTO donors (charity_id, name, phone, email, blood_group, country,
                                    last_donated, consent)
                VALUES (%(charity)s, %(name)s, %(phone)s, %(email)s, %(blood_group)s,
                        %(country)s, %(last_donated)s, %(consent)s)
                RETURNING {DONOR_COLUMNS}""",
            {"charity": charity, **donor.model_dump()},
        ).fetchone()


def match(charity: str, country: str, groups: list[str]) -> list[dict]:
    """Consenting donors of these groups in `country` this charity can see, with whether
    they can give now, their status in this charity's appeal, and per-group `on_file` /
    `eligible` / `pledged` counts on every row."""
    with db.pool().connection() as conn:
        return conn.execute(
            MATCH_SQL,
            {
                "charity": charity,
                "country": country,
                "groups": groups,
                "campaign_days": CAMPAIGN_DAYS,
                "gap_days": ELIGIBLE_AFTER_DAYS,
            },
        ).fetchall()


def record_outreach(charity: str, donor_ids: list[int], status: str, channel: str | None) -> int:
    """Log a contact or a reply for each donor this charity can see. Returns how many were
    logged (other ids are skipped)."""
    with db.pool().connection() as conn:
        rows = conn.execute(
            f"""INSERT INTO outreach (charity_id, donor_id, country, blood_group, status, channel)
                SELECT %(charity)s, d.id, d.country, d.blood_group, %(status)s, %(channel)s
                FROM donors d WHERE d.id = ANY(%(ids)s) AND {VISIBLE}
                RETURNING donor_id""",
            {"charity": charity, "ids": donor_ids, "status": status, "channel": channel},
        ).fetchall()
    return len(rows)


def activity(charity: str, country: str, days: int) -> list[dict]:
    """This charity's contacts and replies in `country`, per day, for the last `days` days
    (days with nothing are left out)."""
    bucket = "time_bucket('1 day', at)" if db.has_timescale() else "date_trunc('day', at)"
    with db.pool().connection() as conn:
        return conn.execute(
            ACTIVITY_SQL.format(bucket=bucket),
            {"charity": charity, "country": country, "days": days},
        ).fetchall()
