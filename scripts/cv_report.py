"""Write docs/CV_REPORT.md with the leave-one-country-out results for the currently loaded data."""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
from app.config import get_settings  # noqa: E402
from app.dataset import build_dataset  # noqa: E402

s = get_settings()
ds = build_dataset(s)
lines = [f"# Cross-validation report ({'SAMPLE placeholder data' if s.is_sample else 'real data'})", "",
         "| Target | Train countries | Imputed | LOCO MAE | Baseline MAE (median) | Raw 80% coverage | Conformal 80% coverage |",
         "|---|---|---|---|---|---|---|"]
for r in ds.imputation.values():
    rep = r.report()
    f = lambda x, d=3: "–" if x is None else f"{x:.{d}f}"  # noqa: E731
    lines.append(f"| {rep['target']} | {rep['n_train']} | {rep['n_imputed']} | {f(rep['loco_mae'])} | "
                 f"{f(rep['baseline_mae_training_median'])} | {f(rep['raw_interval_coverage_80'], 2)} | {f(rep['conformal_interval_coverage_80'], 2)} |")
lines += ["", next(iter(ds.imputation.values())).note]
out = ROOT / "docs" / "CV_REPORT.md"
out.write_text("\n".join(lines) + "\n")
print(out.read_text())
