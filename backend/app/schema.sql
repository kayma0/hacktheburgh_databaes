-- SickleSignal's database: Postgres, hosted on Tiger Data (TimescaleDB). Safe to run more
-- than once. Auth0 keeps the logins (email and password, or Google); this keeps what each
-- charity does, keyed by its Auth0 user id.

-- One row per charity account, created the first time it signs in.
CREATE TABLE IF NOT EXISTS charities (
    id         text PRIMARY KEY,  -- Auth0 user id ("auth0|…", "google-oauth2|…"); 'local' without Auth0
    name       text,
    created_at timestamptz NOT NULL DEFAULT now(),
    last_seen  timestamptz NOT NULL DEFAULT now()
);

-- Donors who agreed to be contacted when their blood group is needed. Each belongs to the
-- charity that added them; demo donors (from app.seed) belong to no one and every charity
-- sees them.
CREATE TABLE IF NOT EXISTS donors (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    charity_id   text REFERENCES charities (id) ON DELETE CASCADE,  -- NULL: shared demo donor
    name         text NOT NULL,
    phone        text,
    email        text,
    blood_group  text NOT NULL
                 CHECK (blood_group IN ('O+', 'A+', 'B+', 'AB+', 'O-', 'A-', 'B-', 'AB-')),
    country      text NOT NULL,
    consent      boolean NOT NULL DEFAULT false,
    last_donated date,
    created_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (phone IS NOT NULL OR email IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS donors_by_group ON donors (country, blood_group) WHERE consent;

-- Every contact and every reply, in time order: each charity's appeal campaigns. On Tiger
-- Data it becomes a hypertable partitioned by time (see db.ensure_schema).
CREATE TABLE IF NOT EXISTS outreach (
    at          timestamptz NOT NULL DEFAULT now(),
    charity_id  text NOT NULL REFERENCES charities (id) ON DELETE CASCADE,
    donor_id    bigint NOT NULL REFERENCES donors (id) ON DELETE CASCADE,
    country     text NOT NULL,
    blood_group text NOT NULL,
    status      text NOT NULL CHECK (status IN ('contacted', 'pledged', 'declined')),
    channel     text CHECK (channel IN ('whatsapp', 'sms', 'email'))
);
CREATE INDEX IF NOT EXISTS outreach_by_donor ON outreach (charity_id, donor_id, at DESC);

-- Drive plans a charity saved: only the plan's settings (its URL query), never results.
CREATE TABLE IF NOT EXISTS saved_plans (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    charity_id text NOT NULL REFERENCES charities (id) ON DELETE CASCADE,
    name       text NOT NULL,
    country    text NOT NULL,
    query      text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_plans_by_charity ON saved_plans (charity_id, id DESC);
