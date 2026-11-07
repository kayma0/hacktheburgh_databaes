import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))


@pytest.fixture(scope="session")
def sample_settings():
    if not (ROOT / "data" / "sample" / "population_SAMPLE.csv").exists():
        subprocess.run([sys.executable, str(ROOT / "scripts" / "make_sample_data.py")], check=True)
    os.environ["DATA_MODE"] = "sample"
    from app.config import get_settings
    return get_settings()


@pytest.fixture(scope="session")
def ds(sample_settings):
    from app.dataset import build_dataset
    return build_dataset(sample_settings)


@pytest.fixture(scope="session")
def params(sample_settings):
    from app.params import load_parameters
    return load_parameters(sample_settings.params_path)
