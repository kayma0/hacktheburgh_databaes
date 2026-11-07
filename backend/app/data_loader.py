"""Loads burden, WHO blood supply, and parameter data from data/raw/.

Real files (burden.csv, who_blood.csv, parameters.yaml) are preferred.
If a real file is missing, the matching *_SAMPLE file is used instead and
`is_sample` is set so the UI can show a "SAMPLE DATA" banner. If neither the
real file nor the sample file exists, loading fails loudly.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import yaml

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "raw"


@dataclass
class LoadedData:
    burden: pd.DataFrame
    who_blood: pd.DataFrame
    parameters: dict
    is_sample: bool


def _resolve(name: str) -> tuple[Path, bool]:
    real = DATA_DIR / name
    if real.exists():
        return real, False
    sample = DATA_DIR / f"{real.stem}_SAMPLE{real.suffix}"
    if sample.exists():
        return sample, True
    raise FileNotFoundError(
        f"Missing data file: neither {real} nor {sample} exists. "
        f"Place real data at {real}, or a sample at {sample}."
    )


def load_data() -> LoadedData:
    burden_path, burden_sample = _resolve("burden.csv")
    who_path, who_sample = _resolve("who_blood.csv")
    params_path, params_sample = _resolve("parameters.yaml")

    burden = pd.read_csv(burden_path)
    who_blood = pd.read_csv(who_path)
    with open(params_path) as f:
        parameters = yaml.safe_load(f)

    return LoadedData(
        burden=burden,
        who_blood=who_blood,
        parameters=parameters,
        is_sample=burden_sample or who_sample or params_sample,
    )
