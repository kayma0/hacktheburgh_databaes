"""Donor Drive Planner.

Safety rules enforced here (not just in the UI):
* Every plan must name a licensed partner service (national blood transfusion service or licensed blood bank)
  and the user must confirm it is licensed. The app never plans collection outside licensed services.
* Donors are voluntary and unpaid. No donor personal information is taken or stored.
"""
from __future__ import annotations

import numpy as np

from . import params as P
from .dataset import Dataset
from .montecarlo import PCTS, SimResult

SAFETY_NOTICE = (
    "Voluntary, unpaid donation only, collected and processed by the named licensed partner service. "
    "This plan is a MODELLED ESTIMATE for programme planning, not clinical advice."
)


class PlanError(ValueError):
    pass


def _q(a: np.ndarray) -> dict:
    q = np.percentile(a, PCTS)
    return {"p10": float(q[0]), "p50": float(q[1]), "p90": float(q[2])}


def plan_drives(sim: SimResult, ds: Dataset, params: dict, *, iso3: str, admin1: str | None,
                drives_per_month: float, donors_per_drive: float | None, horizon_months: int,
                partner_service: str, partner_confirmed_licensed: bool, seed: int = 0) -> dict:
    if not partner_service or len(partner_service.strip()) < 3:
        raise PlanError("Name the licensed partner service (e.g. the national blood transfusion service) that will run the drives.")
    if not partner_confirmed_licensed:
        raise PlanError("Confirm the partner is a national blood transfusion service or licensed blood bank. "
                        "Drives must only run through licensed services.")
    if drives_per_month <= 0 or horizon_months <= 0:
        raise PlanError("drives_per_month and horizon_months must be positive")
    if iso3 not in sim.iso3:
        raise PlanError(f"{iso3} has no complete model inputs")
    i = sim.iso3.index(iso3)
    share = 1.0
    if admin1:
        if ds.admin1_shares is None:
            raise PlanError(ds.facilities_error or "admin1 breakdown needs the facility file")
        m = ds.admin1_shares[(ds.admin1_shares["iso3"] == iso3) & (ds.admin1_shares["admin1"] == admin1)]
        if m.empty:
            raise PlanError(f"admin1 '{admin1}' not found for {iso3}")
        share = float(m["share"].iloc[0])

    n = sim.n
    rng = np.random.default_rng(seed + 1)
    donors_needed_year = sim.draws["donors_needed"][i] * share          # attendees per year
    gap_units_year = sim.draws["gap_units"][i] * share
    deferral = sim.shared["donor_deferral_rate"]
    if donors_per_drive is not None:
        if donors_per_drive <= 0:
            raise PlanError("donors_per_drive must be positive")
        dpd = np.full(n, float(donors_per_drive))
        dpd_kind = "charity input"
    else:
        dpd = P.sample(params["donors_per_drive"], n, rng)
        dpd_kind = "ASSUMPTION (parameters.yaml)"

    need_horizon = donors_needed_year * horizon_months / 12.0
    capacity = drives_per_month * horizon_months * dpd
    drives_needed = need_horizon / dpd
    months_to_cover_year = donors_needed_year / (drives_per_month * dpd)
    p_reach = float(np.mean(capacity >= need_horizon))

    timeline = []
    for mth in range(1, horizon_months + 1):
        cum_att = drives_per_month * mth * dpd
        cum_units = cum_att * (1 - deferral)
        need_m = gap_units_year * mth / 12.0
        timeline.append({
            "month": mth,
            "cumulative_attendees": _q(cum_att),
            "cumulative_units_collected": _q(cum_units),
            "cumulative_units_needed": _q(need_m),
            "p_on_track": float(np.mean(cum_units >= need_m)),
        })
    return {
        "iso3": iso3, "admin1": admin1, "partner_service": partner_service.strip(),
        "horizon_months": horizon_months, "drives_per_month": drives_per_month,
        "donors_per_drive_basis": dpd_kind,
        "gap_units_per_year": _q(gap_units_year),
        "donors_needed_in_horizon": _q(need_horizon),
        "drives_needed_in_horizon": _q(drives_needed),
        "months_of_drives_to_cover_one_year": _q(months_to_cover_year),
        "probability_reaching_target": p_reach,
        "timeline": timeline,
        "label": "MODELLED ESTIMATE",
        "safety_notice": SAFETY_NOTICE,
        "admin1_note": None if not admin1 else "ASSUMPTION: admin1 share of the country total (see Method page).",
    }


def plan_to_csv(plan: dict, is_sample: bool) -> str:
    lines = ["# SickleSignal Donor Drive Plan - MODELLED ESTIMATE" + (" - SAMPLE DATA, NOT REAL" if is_sample else ""),
             f"# {plan['safety_notice']}",
             f"# partner_service,{_csv(plan['partner_service'])}",
             "metric,p10,p50,p90"]
    for k in ["gap_units_per_year", "donors_needed_in_horizon", "drives_needed_in_horizon",
              "months_of_drives_to_cover_one_year"]:
        v = plan[k]
        lines.append(f"{k},{v['p10']:.1f},{v['p50']:.1f},{v['p90']:.1f}")
    lines.append(f"probability_reaching_target,,{plan['probability_reaching_target']:.3f},")
    lines.append("")
    lines.append("month,units_collected_p50,units_needed_p10,units_needed_p50,units_needed_p90,p_on_track")
    for t in plan["timeline"]:
        lines.append(f"{t['month']},{t['cumulative_units_collected']['p50']:.1f},{t['cumulative_units_needed']['p10']:.1f},"
                     f"{t['cumulative_units_needed']['p50']:.1f},{t['cumulative_units_needed']['p90']:.1f},{t['p_on_track']:.3f}")
    return "\n".join(lines) + "\n"


def _csv(s: str) -> str:
    return '"' + s.replace('"', '""') + '"'
