"""Drive plan: turns the reservoir and crisis models into a decision.

It adds no new demand model. For one country it composes

  * `reservoir.compute_reservoir`  -> everyday gap between what is collected and what is
    used, per blood group (`extra_donations_per_day`), plus days of stock; and
  * `crisis.simulate_crisis`       -> which groups run short if N sickle cell patients go
    into crisis within a time window (`units_short`, `p_short`, `lacking`, `at_risk`);

and converts them into donors to recruit:

  regular need   donors = SCD patients' units per year x coverage / (donations per donor
                          per year x (1 - deferral))      [from `scd_demand_per_day`]
  crisis surge   donors = units short x coverage / (1 - deferral)       (one unit each)

The country's whole everyday shortfall (`extra_donations_per_year`) is shown as context
only: closing a national shortage is not something one charity's drive can do, so it is
not the target. `coverage` is the share of the sickle cell need the drive aims to supply.

`deferral`, `donations_per_donor` and `coverage` are the user's choices (ASSUMPTION
defaults, see docs/METHOD.md). Scaling by a constant scales P10/P50/P90 exactly, so the
ranges stay honest. Everything is MODELLED, not live stock.
"""
from __future__ import annotations

from functools import lru_cache

from . import crisis as crisis_mod
from . import reservoir as reservoir_mod

DEFAULT_SEED = 20261107

# ASSUMPTION: share of volunteers turned away at screening (low haemoglobin, infection
# risk, medication). Typical figure in blood-service reports is 10-35%.
DEFERRAL_RANGE = (0.05, 0.5)
DEFAULT_DEFERRAL = 0.20
# ASSUMPTION: whole-blood donations one regular donor gives per year (services allow
# up to about 3-4; many repeat donors in Africa give 1-2).
DONATIONS_PER_DONOR_RANGE = (1.0, 4.0)
DEFAULT_DONATIONS_PER_DONOR = 2.0
DEFAULT_COVERAGE = 0.10

ACTION_ORDER = {"push": 0, "watch": 1, "ok": 2}
DISCLAIMER = (
    "Modelled estimates, not live stock counts. Donations must be voluntary and unpaid, "
    "and run through the country's licensed national blood service. Not a medical device; "
    "no clinical advice."
)


def _scale(p: dict, k: float) -> dict:
    return {key: float(v) * k for key, v in p.items()}


@lru_cache(maxsize=64)
def _reservoir(country: str, share_in_care: float) -> dict:
    return reservoir_mod.compute_reservoir(country, share_in_care)


@lru_cache(maxsize=64)
def _crisis(country: str, people: int, days: int, seed: int,
            o_neg_fallback: bool, crisis_first: bool) -> dict:
    return crisis_mod.simulate_crisis(country, people, days, seed, o_neg_fallback, crisis_first)


def _fmt(n: float) -> str:
    n = float(n)
    if n >= 10_000:
        return f"{round(n, -3):,.0f}"
    if n >= 1_000:
        return f"{round(n, -2):,.0f}"
    if n >= 100:
        return f"{round(n, -1):,.0f}"
    return f"{round(n):,.0f}"


def _label(g: str) -> str:
    return g.replace("-", "−")


def _join(xs: list[str]) -> str:
    if not xs:
        return ""
    if len(xs) == 1:
        return xs[0]
    return ", ".join(xs[:-1]) + " and " + xs[-1]


def build_plan(
    country: str,
    share_in_care: float = reservoir_mod.DEFAULT_SHARE_IN_CARE,
    people: int = 25,
    days: int = 30,
    seed: int = DEFAULT_SEED,
    deferral: float = DEFAULT_DEFERRAL,
    donations_per_donor: float = DEFAULT_DONATIONS_PER_DONOR,
    coverage: float = DEFAULT_COVERAGE,
    o_neg_fallback: bool = False,
    crisis_first: bool = False,
) -> dict:
    """Raises KeyError for an unknown country."""
    res = _reservoir(country, round(float(share_in_care), 4))
    cr = _crisis(country, int(people), int(days), int(seed), bool(o_neg_fallback), bool(crisis_first))

    deferral = min(max(float(deferral), DEFERRAL_RANGE[0]), DEFERRAL_RANGE[1])
    dpd = min(max(float(donations_per_donor), DONATIONS_PER_DONOR_RANGE[0]), DONATIONS_PER_DONOR_RANGE[1])
    coverage = min(max(float(coverage), 0.0), 1.0)
    keep = 1.0 - deferral

    by_crisis = {g["blood_group"]: g for g in cr["by_group"]}
    lacking, at_risk = set(cr["lacking"]), set(cr["at_risk"])

    groups = []
    for t in res["types"]:
        g = t["blood_type"]
        c = by_crisis[g]
        if t["status"] == "critical" or g in lacking:
            action = "push"
        elif t["status"] == "low" or g in at_risk:
            action = "watch"
        else:
            action = "ok"
        extra_year = _scale(t["extra_donations_per_day"], 365.0)
        scd_year = _scale(t["scd_demand_per_day"], 365.0)
        groups.append({
            "blood_group": g,
            "action": action,
            "status": t["status"],
            "days": t["days"],
            "fill": t["fill"],
            "p_short": c["p_short"],
            "runs_dry_after_days": c["runs_dry_after_days"],
            "units_short": c["units_short"],
            "scd_units_per_year": scd_year,
            "extra_donations_per_year": extra_year,
            # regular donors to supply this share of the SCD patients' everyday need
            "donors_ongoing": _scale(scd_year, coverage / (dpd * keep)),
            # one-off donors for the crisis window (one unit each)
            "donors_surge": _scale(c["units_short"], coverage / keep),
        })
    groups.sort(key=lambda x: (ACTION_ORDER[x["action"]], -x["p_short"], -x["donors_ongoing"]["p50"]))

    def total(key: str) -> dict:
        # Over the groups worth pushing or watching. Sum of per-group percentiles: the
        # range if every group moves together, so it is on the wide side. The UI says so.
        need = [g for g in groups if g["action"] != "ok"]
        return {k: sum(g[key][k] for g in need) for k in ("p10", "p50", "p90")}

    push = [g["blood_group"] for g in groups if g["action"] == "push"]
    watch = [g["blood_group"] for g in groups if g["action"] == "watch"]
    tot_on, tot_su = total("donors_ongoing"), total("donors_surge")

    focus = push or watch
    if focus:
        lead = (f"Modelled estimates (not live stock) suggest {_join([_label(g) for g in focus])} "
                f"{'is' if len(focus) == 1 else 'are'} the most pressed blood group"
                f"{'' if len(focus) == 1 else 's'} in {country}.")
    else:
        lead = (f"Modelled estimates (not live stock) suggest {country}'s blood supply "
                f"covers the scenario tested.")
    if not push and tot_on["p50"] < 1 and tot_su["p50"] < 1:
        extra = f" {_join([_label(g) for g in watch])} is worth watching." if len(watch) == 1 else (
            f" {_join([_label(g) for g in watch])} are worth watching." if watch else "")
        ask = (
            f"We are considering a voluntary, unpaid blood drive in {country}, run through the "
            f"national blood service. Modelled estimates (not live stock) suggest the blood supply "
            f"covers the scenario we tested ({cr['people']} people with sickle cell disease in "
            f"crisis within {cr['days']} days).{extra} We would like to confirm with you where "
            f"help would be most useful before we plan anything."
        )
    else:
        ask = (
            f"We are planning a voluntary, unpaid blood drive in {country}, run through the "
            f"national blood service. {lead} "
            f"To supply {round(coverage * 100)}% of the regular blood need of people living with "
            f"sickle cell disease we would need about {_fmt(tot_on['p50'])} regular donors "
            f"(likely {_fmt(tot_on['p10'])}\u2013{_fmt(tot_on['p90'])} if every group moves together). "
            f"If {cr['people']} people with the disease went into crisis within {cr['days']} days, "
            f"about {_fmt(tot_su['p50'])} one-off donors of the short groups would help close the "
            f"gap. We would like to agree targets, dates and venues with you before we start."
        )

    assumptions = [
        {"key": "deferral", "label": "Volunteers turned away at screening", "value": deferral,
         "is_assumption": True, "source": "ASSUMPTION: blood-service reports typically give 10–35%"},
        {"key": "donations_per_donor", "label": "Donations per regular donor per year", "value": dpd,
         "is_assumption": True, "source": "ASSUMPTION: services allow 3–4; many repeat donors give 1–2"},
        {"key": "coverage", "label": "Share of the sickle cell blood need the drive aims to supply", "value": coverage,
         "is_assumption": True, "source": "Your choice"},
        {"key": "share_in_care", "label": "Share of people with SCD in regular care", "value": res["share_in_care"],
         "is_assumption": True, "source": "ASSUMPTION (see docs/METHOD.md)"},
        {"key": "target_days", "label": "National reserve target (days)", "value": res["target_days"],
         "is_assumption": res["target_is_assumption"], "source": res["target_source"]},
        {"key": "blood_types", "label": "Blood-group mix", "value": None,
         "is_assumption": res["blood_type_is_assumption"], "source": res["blood_type_source"]},
        {"key": "donations", "label": "Blood collected per year", "value": res["donations_per_year"],
         "is_assumption": res["donations_is_assumption"], "source": res["donations_source"]},
    ]

    return {
        "country": country,
        "projection_year": cr["projection_year"],
        "params": {
            "share_in_care": res["share_in_care"], "people": cr["people"], "days": cr["days"],
            "seed": cr["seed"], "deferral": deferral, "donations_per_donor": dpd,
            "coverage": coverage, "o_neg_fallback": cr["o_neg_fallback"],
            "crisis_first": cr["crisis_first"],
        },
        "verdict": cr["verdict"],
        "p_all_served": cr["p_all_served"],
        "patients_unserved": cr["patients_unserved"],
        "units_needed": cr["units_needed"],
        "target_days": res["target_days"],
        "scd_patients": res["scd_patients"],
        "push": push,
        "watch": watch,
        "groups": groups,
        "totals": {"donors_ongoing": tot_on, "donors_surge": tot_su},
        "assumptions": assumptions,
        "ask": ask,
        "disclaimer": DISCLAIMER,
    }


def sensitivity(country: str, **base) -> dict:
    """Which assumption moves the regular-donor total most? Each is varied alone across a
    plausible range while the rest stay as chosen. Raises KeyError for an unknown country."""
    base_args = dict(
        share_in_care=reservoir_mod.DEFAULT_SHARE_IN_CARE, people=25, days=30, seed=DEFAULT_SEED,
        deferral=DEFAULT_DEFERRAL, donations_per_donor=DEFAULT_DONATIONS_PER_DONOR,
        coverage=DEFAULT_COVERAGE, o_neg_fallback=False, crisis_first=False)
    base_args.update(base)
    centre = build_plan(country, **base_args)["totals"]["donors_ongoing"]["p50"]

    tests = [
        ("deferral", "Volunteers turned away at screening", 0.10, 0.35, True),
        ("donations_per_donor", "Donations per regular donor per year", 1.0, 3.0, False),
        ("share_in_care", "Share of people with SCD in regular care", 0.15, 0.50, True),
    ]
    rows = []
    for key, label, lo, hi, as_pct in tests:
        lo_t = build_plan(country, **{**base_args, key: lo})["totals"]["donors_ongoing"]["p50"]
        hi_t = build_plan(country, **{**base_args, key: hi})["totals"]["donors_ongoing"]["p50"]
        rows.append({
            "key": key, "label": label, "as_percent": as_pct, "low_value": lo, "high_value": hi,
            "low_donors": lo_t, "high_donors": hi_t,
            "swing": abs(hi_t - lo_t),
        })
    rows.sort(key=lambda r: -r["swing"])
    return {"country": country, "base_donors": centre, "rows": rows}
