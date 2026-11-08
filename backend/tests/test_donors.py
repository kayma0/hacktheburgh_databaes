"""Donor registry against a real Postgres, as the local charity (no Auth0). Runs only with
TEST_DATABASE_URL set; see conftest.py."""
from datetime import date

import pytest

pytestmark = pytest.mark.usefixtures("local_mode", "test_db")
COUNTRY = "Testland"


def add(client, **kw):
    donor = {"name": "Ama Mensah", "phone": "+233 20 000 0000", "blood_group": "O+",
             "country": COUNTRY, "consent": True, **kw}
    r = client.post("/api/donors", json=donor)
    assert r.status_code == 201, r.text
    return r.json()


def match(client, **needs):
    r = client.post("/api/donors/match", json={
        "country": COUNTRY, "donors": needs, "deadlines": {"O+": "by Sun 15 Nov"}})
    assert r.status_code == 200
    return {g["blood_group"]: g for g in r.json()["groups"]}


def test_register_validates(client):
    ama = add(client)
    assert ama["phone"] == "+233200000000"
    base = {"name": "X", "blood_group": "O+", "country": COUNTRY}
    assert client.post("/api/donors", json={**base, "phone": "0201", "consent": True}).status_code == 422
    assert client.post("/api/donors", json={**base, "consent": True}).status_code == 422  # no contact
    assert client.post("/api/donors", json={**base, "phone": "+233200000001", "consent": False}).status_code == 422


def test_match_lists_the_group_and_who_can_give_now(client):
    add(client)
    add(client, name="Kofi Owusu", last_donated="2000-01-01")
    add(client, name="Recent Giver", last_donated=date.today().isoformat())
    add(client, name="Bea Diallo", blood_group="B+")
    groups = match(client, **{"O+": 3, "A+": 1})
    o = groups["O+"]
    assert (o["needed"], o["on_file"], o["eligible"], o["pledged"]) == (3, 3, 2, 0)
    assert o["deadline"] == "by Sun 15 Nov"
    by_name = {d["name"]: d for d in o["donors"]}
    assert set(by_name) == {"Ama Mensah", "Kofi Owusu", "Recent Giver"}  # B+ is not listed
    assert by_name["Ama Mensah"]["can_donate"] and by_name["Kofi Owusu"]["can_donate"]
    recent = by_name["Recent Giver"]
    assert not recent["can_donate"] and recent["can_donate_from"] > date.today().isoformat()
    assert o["donors"][-1]["name"] == "Recent Giver"  # those who can give come first
    assert groups["A+"]["on_file"] == 0 and groups["A+"]["donors"] == []


def test_outreach_moves_donors_through_the_appeal(client):
    ama = add(client)
    kofi = add(client, name="Kofi Owusu")

    def log(ids, **body):
        return client.post("/api/outreach", json={"donor_ids": ids, **body})

    r = log([ama["id"], kofi["id"]], status="contacted", channel="email")  # a whole group
    assert r.status_code == 200 and r.json() == {"logged": 2}
    assert {d["status"] for d in match(client, **{"O+": 2})["O+"]["donors"]} == {"contacted"}
    assert log([ama["id"]], status="pledged").status_code == 200
    o = match(client, **{"O+": 2})["O+"]
    assert o["pledged"] == 1
    assert {d["name"]: d["status"] for d in o["donors"]}["Ama Mensah"] == "pledged"
    assert log([999999999], status="pledged").status_code == 404
    assert log([], status="pledged").status_code == 422
