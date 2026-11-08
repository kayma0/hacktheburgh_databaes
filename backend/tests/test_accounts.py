"""Sign-in (Auth0) and what each charity keeps in the database: donors, outreach, saved plans."""
from .tokens import OTHER_KEY, auth_header

NEED = {"country": "Ghana", "donors": {"O+": 2}}
DONOR = {"name": "Ama Mensah", "phone": "+233 20 000 0000", "blood_group": "O+",
         "country": "Ghana", "consent": True}
PLAN = {"name": "Ghana spring drive", "country": "Ghana", "query": "c=Ghana&p=25&d=30"}


def matched(client, headers):
    """The O+ donors this charity sees in Ghana."""
    return client.post("/api/donors/match", json=NEED, headers=headers).json()["groups"][0]["donors"]


def test_local_mode_needs_no_sign_in(client, local_mode):
    assert client.get("/api/auth/config").json() == {"enabled": False}
    assert client.get("/api/hotspots").status_code == 200  # public endpoints are unaffected


def test_tokens_are_verified(client, signed_in):
    assert client.get("/api/auth/config").json() == {"enabled": True}
    assert client.get("/api/plans").status_code == 401
    assert client.get("/api/plans", headers={"Authorization": "Basic abc"}).status_code == 401
    for bad in (
        auth_header(key=OTHER_KEY),                 # signed by someone else (forged)
        auth_header(aud="https://other.api"),       # token for a different API
        auth_header(iss="https://evil.example.com/"),  # wrong issuer
        auth_header(exp_in=-10),                    # expired
    ):
        assert client.get("/api/plans", headers=bad).status_code == 401
    assert client.get("/api/plans", headers=auth_header()).status_code != 401


def test_first_request_creates_the_charity(client, signed_in, test_db):
    h = auth_header(sub="google-oauth2|123")
    assert client.put("/api/me", json={"name": "Sickle Cell Foundation"}, headers=h).json() == {
        "id": "google-oauth2|123", "name": "Sickle Cell Foundation"}
    from app import db
    with db.pool().connection() as conn:
        row = conn.execute("SELECT id, name FROM charities").fetchone()
    assert row == {"id": "google-oauth2|123", "name": "Sickle Cell Foundation"}


def test_each_charity_sees_its_own_donors_and_outreach(client, signed_in, test_db):
    alice, bob = auth_header(sub="auth0|alice"), auth_header(sub="auth0|bob")
    mine = client.post("/api/donors", json=DONOR, headers=alice).json()
    assert [d["name"] for d in matched(client, alice)] == ["Ama Mensah"]
    assert matched(client, bob) == []
    # Bob can't log outreach against Alice's donor.
    assert client.post("/api/outreach", json={"donor_ids": [mine["id"]], "status": "pledged"},
                       headers=bob).status_code == 404
    assert client.post("/api/outreach", json={"donor_ids": [mine["id"]], "status": "pledged"},
                       headers=alice).status_code == 200


def test_demo_donors_are_shared_but_replies_are_not(client, signed_in, test_db):
    from app import db
    with db.pool().connection() as conn:
        demo = conn.execute(
            "INSERT INTO donors (name, phone, blood_group, country, consent)"
            " VALUES ('Demo Donor', '+999123456789', 'O+', 'Ghana', true) RETURNING id").fetchone()["id"]
    alice, bob = auth_header(sub="auth0|alice"), auth_header(sub="auth0|bob")
    client.post("/api/outreach", json={"donor_ids": [demo], "status": "pledged"}, headers=alice)
    assert matched(client, alice)[0]["status"] == "pledged"
    assert matched(client, bob)[0]["status"] is None


def test_activity_counts_this_charitys_outreach_by_day(client, signed_in, test_db):
    h = auth_header()
    ids = [client.post("/api/donors", json={**DONOR, "phone": f"+23320000000{i}"}, headers=h).json()["id"]
           for i in range(3)]
    client.post("/api/outreach", json={"donor_ids": ids, "status": "contacted", "channel": "sms"}, headers=h)
    client.post("/api/outreach", json={"donor_ids": ids[:1], "status": "pledged"}, headers=h)
    a = client.get("/api/outreach/activity", params={"country": "Ghana"}, headers=h).json()
    assert (a["connected"], a["contacted"], a["pledged"], a["declined"]) == (True, 3, 1, 0)
    assert len(a["by_day"]) == 1 and a["by_day"][0]["contacted"] == 3
    other = client.get("/api/outreach/activity", params={"country": "Ghana"}, headers=auth_header(sub="auth0|bob"))
    assert other.json()["contacted"] == 0


def test_saved_plans_round_trip_and_isolation(client, signed_in, test_db):
    a, b = auth_header(sub="auth0|alice"), auth_header(sub="auth0|bob")
    saved = client.post("/api/plans", json={**PLAN, "query": PLAN["query"] + "&evil=<x>"}, headers=a)
    assert saved.status_code == 200
    s = saved.json()
    assert "evil" not in s["query"] and "c=Ghana" in s["query"]  # only known settings are kept
    assert [p["name"] for p in client.get("/api/plans", headers=a).json()] == ["Ghana spring drive"]
    # another charity sees nothing and can't delete it
    assert client.get("/api/plans", headers=b).json() == []
    assert client.delete(f"/api/plans/{s['id']}", headers=b).status_code == 404
    assert client.delete(f"/api/plans/{s['id']}", headers=a).status_code == 200
    assert client.get("/api/plans", headers=a).json() == []


def test_saved_plans_validation_and_limit(client, signed_in, test_db, monkeypatch):
    from app import plans_store
    h = auth_header()
    assert client.post("/api/plans", json={**PLAN, "country": "Nowhere"}, headers=h).status_code == 404
    assert client.post("/api/plans", json={**PLAN, "name": ""}, headers=h).status_code == 422
    assert client.post("/api/plans", json={**PLAN, "query": "evil=1"}, headers=h).status_code == 422
    assert client.post("/api/plans", json={**PLAN, "query": "c=Ghana" + "a" * 500}, headers=h).status_code == 422
    monkeypatch.setattr(plans_store, "MAX_PLANS_PER_CHARITY", 2)
    assert [client.post("/api/plans", json=PLAN, headers=h).status_code for _ in range(3)] == [200, 200, 409]


def test_local_mode_without_a_database(client, local_mode, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert client.get("/api/plans").status_code == 503
    assert client.get("/api/outreach/activity", params={"country": "Ghana"}).json()["connected"] is False
    assert client.post("/api/donors/match", json=NEED).json() == {"connected": False, "registered": 0, "groups": []}
