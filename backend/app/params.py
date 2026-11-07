"""Model parameters: loading, validation, user overrides and sampling."""
from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

import numpy as np
import yaml
from scipy import stats

VALID_KINDS = {"SOURCED", "ASSUMPTION"}
VALID_DISTS = {"fixed", "triangular", "beta_mean", "gamma_cv"}
REQUIRED = [
    "transfusion_rate_untreated", "transfusion_rate_hydroxyurea", "units_per_event",
    "donor_deferral_rate", "donors_per_drive", "share_diagnosed", "share_on_hydroxyurea",
    "target_coverage", "universal_hydroxyurea_coverage",
]
OVERRIDABLE_FIELDS = {"value", "mode", "mean", "min", "max", "cv", "concentration"}


class ParameterError(ValueError):
    pass


def load_parameters(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        raise ParameterError(f"parameters file not found at {path}. Copy config/parameters.yaml to data/raw/ or set PARAMS_PATH.")
    with open(path) as f:
        params = yaml.safe_load(f) or {}
    missing = [k for k in REQUIRED if k not in params]
    if missing:
        raise ParameterError(f"parameters.yaml is missing required keys: {missing}")
    for name, p in params.items():
        validate_param(name, p)
    return params


def validate_param(name: str, p: dict[str, Any]) -> None:
    if p.get("kind") not in VALID_KINDS:
        raise ParameterError(f"{name}: kind must be one of {VALID_KINDS}")
    d = p.get("dist")
    if d not in VALID_DISTS:
        raise ParameterError(f"{name}: dist must be one of {VALID_DISTS}")
    if p["kind"] == "ASSUMPTION" and not p.get("todo"):
        raise ParameterError(f"{name}: ASSUMPTION parameters need a 'todo' explaining what to cite")
    if d == "fixed" and "value" not in p:
        raise ParameterError(f"{name}: fixed dist needs 'value'")
    if d == "triangular":
        lo, mo, hi = p.get("min"), p.get("mode"), p.get("max")
        if None in (lo, mo, hi) or not (lo <= mo <= hi) or lo == hi:
            raise ParameterError(f"{name}: triangular needs min <= mode <= max with min < max (got {lo}, {mo}, {hi})")
    if d == "beta_mean":
        m, k = p.get("mean"), p.get("concentration")
        if m is None or not (0 <= m <= 1) or not k or k <= 0:
            raise ParameterError(f"{name}: beta_mean needs 0 <= mean <= 1 and concentration > 0")
    if d == "gamma_cv":
        if p.get("value") is None or p["value"] < 0 or not p.get("cv") or p["cv"] <= 0:
            raise ParameterError(f"{name}: gamma_cv needs value >= 0 and cv > 0")
    if "min" in p and "max" in p and p["min"] is not None and p["max"] is not None and p["min"] > p["max"]:
        raise ParameterError(f"{name}: min > max")


def apply_overrides(params: dict[str, dict[str, Any]], overrides: dict[str, dict[str, float]] | None) -> dict[str, dict[str, Any]]:
    """Return a copy of params with user overrides applied and re-validated."""
    out = copy.deepcopy(params)
    for name, ov in (overrides or {}).items():
        if name not in out:
            raise ParameterError(f"unknown parameter '{name}'")
        bad = set(ov) - OVERRIDABLE_FIELDS
        if bad:
            raise ParameterError(f"{name}: cannot override fields {sorted(bad)}")
        out[name].update({k: float(v) for k, v in ov.items()})
        out[name]["overridden"] = True
        # keep slider-style overrides inside the declared bounds
        p = out[name]
        if p["dist"] == "triangular":
            # moving only the mode: widen bounds if the user goes outside them
            p["min"] = min(p["min"], p["mode"])
            p["max"] = max(p["max"], p["mode"])
            if p["min"] == p["max"]:
                p["max"] = p["min"] + 1e-9
        validate_param(name, p)
    return out


def central(p: dict[str, Any]) -> float:
    d = p["dist"]
    if d == "triangular":
        return float(p["mode"])
    if d == "beta_mean":
        return float(p["mean"])
    return float(p["value"])


def _frozen(p: dict[str, Any]):
    d = p["dist"]
    if d == "triangular":
        lo, mo, hi = p["min"], p["mode"], p["max"]
        return stats.triang(c=(mo - lo) / (hi - lo), loc=lo, scale=hi - lo)
    if d == "beta_mean":
        m, k = p["mean"], p["concentration"]
        m = min(max(m, 1e-6), 1 - 1e-6)
        return stats.beta(m * k, (1 - m) * k)
    if d == "gamma_cv":
        shape = 1.0 / p["cv"] ** 2
        return stats.gamma(shape, scale=p["value"] / shape)
    return None


def quantile(p: dict[str, Any], q: float) -> float:
    fr = _frozen(p)
    if fr is None:
        return float(p["value"])
    if p["dist"] == "beta_mean" and p["mean"] in (0, 1):
        return float(p["mean"])
    return float(fr.ppf(q))


def sample(p: dict[str, Any], n: int, rng: np.random.Generator) -> np.ndarray:
    d = p["dist"]
    if d == "fixed":
        return np.full(n, float(p["value"]))
    if d == "triangular":
        if p["max"] - p["min"] < 1e-8:
            return np.full(n, float(p["mode"]))
        return rng.triangular(p["min"], p["mode"], p["max"], size=n)
    if d == "beta_mean":
        m, k = float(p["mean"]), float(p["concentration"])
        if m <= 0:
            return np.zeros(n)
        if m >= 1:
            return np.ones(n)
        return rng.beta(m * k, (1 - m) * k, size=n)
    if d == "gamma_cv":
        shape = 1.0 / p["cv"] ** 2
        return rng.gamma(shape, p["value"] / shape, size=n)
    raise ParameterError(f"unknown dist {d}")


def public_view(params: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """Parameters as shown in the UI and in exports."""
    rows = []
    for name, p in params.items():
        rows.append({
            "name": name,
            "label": p.get("label", name),
            "kind": p["kind"],
            "dist": p["dist"],
            "central": central(p),
            "p10": quantile(p, 0.10),
            "p90": quantile(p, 0.90),
            "min": p.get("min"),
            "max": p.get("max"),
            "unit": p.get("unit"),
            "source": p.get("source"),
            "todo": p.get("todo"),
            "caveat": p.get("caveat"),
            "overridden": bool(p.get("overridden", False)),
        })
    return rows
