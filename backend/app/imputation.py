"""ML imputation of missing country inputs, with prediction intervals.

Method
------
* Target is modelled on the log scale (rates are positive and skewed).
* Three HistGradientBoostingRegressor models with quantile loss (0.1, 0.5, 0.9).
  HGB handles missing covariates natively, which matters because VNRD share is often missing.
* Leave-one-country-out (LOCO) cross-validation gives honest out-of-sample predictions.
* Conformalised quantile regression (CQR, Romano et al. 2019): the LOCO non-conformity scores
  widen the 80% interval so that it has (approximately) the advertised coverage.
* Imputed values are always returned with status 'ml_imputed' and never overwrite observed values.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor
from threadpoolctl import threadpool_limits

QUANTILES = (0.1, 0.5, 0.9)
Z90 = 1.2815515655446004  # standard normal 90th percentile


def _model(q: float) -> HistGradientBoostingRegressor:
    return HistGradientBoostingRegressor(
        loss="quantile", quantile=q, max_iter=60, learning_rate=0.1, max_depth=3,
        min_samples_leaf=3, l2_regularization=1.0, random_state=0,
    )


def build_features(df: pd.DataFrame, extra: list[str] | None = None) -> pd.DataFrame:
    """Covariates: sub-region, income group (one-hot), log population, VNRD share (+ extras)."""
    X = pd.DataFrame(index=df.index)
    X["log_population"] = np.log(df["population"].astype(float))
    X["vnrd_share"] = df.get("vnrd_share", pd.Series(np.nan, index=df.index)).astype(float)
    for col in ["subregion", "income_group"]:
        if col in df.columns:
            d = pd.get_dummies(df[col].fillna("Unknown"), prefix=col, dtype=float)
            X = X.join(d)
    for c in extra or []:
        X[c] = df[c].astype(float)
    return X


@dataclass
class ImputationResult:
    target: str
    n_train: int
    loco_mae: float | None = None
    baseline_mae: float | None = None
    raw_coverage_80: float | None = None
    conformal_correction: float | None = None
    conformal_coverage_80: float | None = None
    predictions: pd.DataFrame = field(default_factory=pd.DataFrame)  # iso3 -> p10, p50, p90 (natural units)
    loco: pd.DataFrame = field(default_factory=pd.DataFrame)          # per-country CV predictions
    note: str = ""

    def report(self) -> dict:
        return {
            "target": self.target, "n_train": self.n_train, "loco_mae": self.loco_mae,
            "baseline_mae_training_median": self.baseline_mae, "raw_interval_coverage_80": self.raw_coverage_80,
            "conformal_log_correction": self.conformal_correction,
            "conformal_interval_coverage_80": self.conformal_coverage_80,
            "n_imputed": int(len(self.predictions)), "note": self.note,
            "loco_predictions": self.loco.round(4).to_dict(orient="records"),
        }


def _fit_predict(Xtr: pd.DataFrame, ytr: np.ndarray, Xte: pd.DataFrame) -> np.ndarray:
    preds = np.column_stack([_model(q).fit(Xtr, ytr).predict(Xte) for q in QUANTILES])
    return np.sort(preds, axis=1)  # fix quantile crossing


def impute(df: pd.DataFrame, target_col: str, feature_extra: list[str] | None = None,
           min_train: int = 8) -> ImputationResult:
    # tiny data: OpenMP threading costs more than it saves
    with threadpool_limits(1):
        return _impute(df, target_col, feature_extra, min_train)


def _impute(df: pd.DataFrame, target_col: str, feature_extra: list[str] | None,
            min_train: int) -> ImputationResult:
    """Impute df[target_col] (positive) for rows where it is missing.

    df must be indexed by iso3 and have population, subregion, income_group, vnrd_share.
    """
    usable = df[df["population"].notna()].copy()
    X = build_features(usable, feature_extra)
    y_nat = usable[target_col].astype(float)
    obs = y_nat.notna() & (y_nat > 0)
    miss = ~obs
    res = ImputationResult(target=target_col, n_train=int(obs.sum()))
    if obs.sum() < min_train:
        res.note = f"Only {int(obs.sum())} observed countries; need {min_train}. No imputation performed."
        return res

    Xo, yo = X[obs], np.log(y_nat[obs].values)
    # Leave-one-country-out CV
    loco = np.zeros((len(yo), 3))
    for i in range(len(yo)):
        m = np.ones(len(yo), dtype=bool)
        m[i] = False
        loco[i] = _fit_predict(Xo[m], yo[m], Xo.iloc[[i]])[0]
    scores = np.maximum(loco[:, 0] - yo, yo - loco[:, 2])
    n = len(yo)
    level = min(1.0, np.ceil((n + 1) * 0.8) / n)
    qhat = float(np.quantile(scores, level, method="higher"))
    raw_cov = float(np.mean((yo >= loco[:, 0]) & (yo <= loco[:, 2])))
    conf_cov = float(np.mean((yo >= loco[:, 0] - qhat) & (yo <= loco[:, 2] + qhat)))
    y_true = np.exp(yo)
    res.loco_mae = float(np.mean(np.abs(np.exp(loco[:, 1]) - y_true)))
    # baseline: predict the median of the other countries
    base = np.array([np.median(np.delete(y_true, i)) for i in range(n)])
    res.baseline_mae = float(np.mean(np.abs(base - y_true)))
    res.raw_coverage_80 = raw_cov
    res.conformal_correction = qhat
    res.conformal_coverage_80 = conf_cov
    res.loco = pd.DataFrame({"iso3": Xo.index, "observed": y_true, "pred_p10": np.exp(loco[:, 0] - qhat),
                             "pred_p50": np.exp(loco[:, 1]), "pred_p90": np.exp(loco[:, 2] + qhat)})
    res.note = ("LOCO = leave-one-country-out. Coverage of the conformalised interval is computed on the same "
                "LOCO scores used to calibrate it, so treat it as a calibration check, not an independent test.")
    if miss.any():
        p = _fit_predict(Xo, yo, X[miss])
        res.predictions = pd.DataFrame({
            "p10": np.exp(p[:, 0] - qhat), "p50": np.exp(p[:, 1]), "p90": np.exp(p[:, 2] + qhat),
        }, index=X[miss].index)
    return res


def lognormal_from_quantiles(p10: float, p50: float, p90: float) -> tuple[float, float]:
    """(mu, sigma) of a lognormal with median p50 and spread matching P10-P90."""
    sigma = max((np.log(p90) - np.log(p10)) / (2 * Z90), 1e-6)
    return float(np.log(p50)), float(sigma)
