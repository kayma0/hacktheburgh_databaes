"""Fill the donor registry with fictional demo donors.

    cd backend
    python -m app.seed                 # 40 donors in every country
    python -m app.seed --reset         # remove earlier demo donors first

Demo donors belong to no charity (charity_id NULL), so every charity sees them next to its
own. Every demo donor is invented. Phone numbers use +999, a country code assigned to no
country, and emails use example.org, a domain reserved for examples, so no message can
reach a real person. Blood groups follow each country's donor mix (data/blood_supply.csv).
Real donors are added through the app ("Add a donor") or POST /api/donors.
"""
from __future__ import annotations

import argparse
from datetime import date, timedelta

import numpy as np
from dotenv import load_dotenv

from . import db
from .blood import BLOOD_TYPES
from .reservoir import load_supply

FIRST_NAMES = (
    "Ama", "Kwame", "Adaeze", "Chidi", "Fatou", "Moussa", "Amina", "Ibrahim", "Wanjiru",
    "Otieno", "Thandiwe", "Sipho", "Nadia", "Youssef", "Abebe", "Tigist", "Grace", "Emmanuel",
    "Aisha", "Kofi", "Zainab", "Tunde", "Esther", "Joseph", "Halima", "Samuel", "Mariam",
    "David", "Naledi", "Bongani", "Awa", "Mamadou", "Rehema", "Baraka", "Imani", "Daniel",
)
SURNAMES = (
    "Mensah", "Okafor", "Diallo", "Traore", "Kamau", "Odhiambo", "Ndlovu", "Dlamini", "Haile",
    "Bekele", "Mohammed", "Abubakar", "Banda", "Phiri", "Nkosi", "Sow", "Keita", "Owusu",
    "Adeyemi", "Mwangi", "Moyo", "Juma", "Sesay", "Kone", "Asante", "Eze", "Tesfaye", "Mutua",
)
SEED = 20261108


def demo_donors(country: str, shares: dict[str, float], n: int, rng: np.random.Generator) -> list[dict]:
    p = np.array([shares[t] for t in BLOOD_TYPES])
    groups = rng.choice(BLOOD_TYPES, size=n, p=p / p.sum())
    today = date.today()
    rows = []
    for i, group in enumerate(groups):
        first, last = rng.choice(FIRST_NAMES), rng.choice(SURNAMES)
        # About a third have never given; the rest last gave up to ~13 months ago.
        gave = None if rng.random() < 0.3 else today - timedelta(days=int(rng.integers(20, 400)))
        rows.append({
            "name": f"{first} {last}",
            "phone": f"+999{rng.integers(10**8, 10**9)}",
            "email": f"{first}.{last}.{i}@example.org".lower(),
            "blood_group": str(group),
            "country": country,
            "last_donated": gave,
        })
    return rows


def main() -> None:
    load_dotenv()
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--per-country", type=int, default=40)
    parser.add_argument("--reset", action="store_true", help="delete earlier demo donors first")
    args = parser.parse_args()

    if not db.is_configured():
        raise SystemExit("Set DATABASE_URL in .env first (see README).")
    rng = np.random.default_rng(SEED)
    rows = [r for supply in load_supply().values()
            for r in demo_donors(supply.country, supply.shares, args.per_country, rng)]
    with db.pool().connection() as conn:
        if args.reset:
            conn.execute("DELETE FROM donors WHERE charity_id IS NULL")
        with conn.cursor() as cur:
            cur.executemany(
                """INSERT INTO donors (name, phone, email, blood_group, country, last_donated, consent)
                   VALUES (%(name)s, %(phone)s, %(email)s, %(blood_group)s, %(country)s,
                           %(last_donated)s, true)""",
                rows,
            )
    print(f"Added {len(rows)} demo donors in {len(rows) // args.per_country} countries.")
    db.close()


if __name__ == "__main__":
    main()
