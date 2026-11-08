"""Blood-group constants shared by the reservoir model, the crisis simulator and the donor
registry. Every number marked ASSUMPTION is documented in docs/METHOD.md."""
from __future__ import annotations

BLOOD_TYPES = ["O+", "A+", "B+", "AB+", "O-", "A-", "B-", "AB-"]

# ASSUMPTION: how hard each group is pulled relative to its donor share.
# O- is the emergency "universal" red-cell group; AB is rarely requested.
DEFAULT_DEMAND_WEIGHTS = {
    "O+": 1.1, "A+": 0.95, "B+": 0.95, "AB+": 0.7,
    "O-": 2.2, "A-": 1.0, "B-": 1.0, "AB-": 0.6,
}

# ASSUMPTION: red-cell units per crisis transfusion by GBD age band. Children are dosed by
# weight (~10-15 mL/kg; one adult unit is ~250-300 mL), so a toddler needs a fraction of a
# unit and an adult 2-3. Exchange transfusions can need far more.
DEFAULT_UNITS_BY_AGE = {
    "under_5": {"min": 0.3, "mode": 0.6, "max": 1.0},
    "age_5_14": {"min": 0.8, "mode": 1.3, "max": 2.2},
    "age_15_24": {"min": 1.5, "mode": 2.2, "max": 3.5},
    "age_25_plus": {"min": 1.5, "mode": 2.5, "max": 4.0},
}
