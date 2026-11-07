"""Runtime configuration, read from environment variables (see .env.example)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def _env(name: str, default: str | None = None) -> str | None:
    v = os.environ.get(name)
    return v if v not in (None, "") else default


@dataclass(frozen=True)
class Settings:
    data_mode: str = field(default_factory=lambda: (_env("DATA_MODE", "real") or "real").lower())
    raw_dir: Path = field(default_factory=lambda: Path(_env("RAW_DATA_DIR", str(ROOT / "data" / "raw"))))
    sample_dir: Path = field(default_factory=lambda: Path(_env("SAMPLE_DATA_DIR", str(ROOT / "data" / "sample"))))
    params_path: Path = field(default_factory=lambda: Path(_env("PARAMS_PATH", "")) if _env("PARAMS_PATH") else (
        ROOT / "data" / "raw" / "parameters.yaml" if (ROOT / "data" / "raw" / "parameters.yaml").exists()
        else ROOT / "config" / "parameters.yaml"))
    database_url: str = field(default_factory=lambda: _env("DATABASE_URL", f"sqlite:///{ROOT / 'sicklesupply.db'}"))
    gemini_api_key: str | None = field(default_factory=lambda: _env("GEMINI_API_KEY"))
    gemini_model: str | None = field(default_factory=lambda: _env("GEMINI_MODEL"))
    gemini_timeout_s: float = field(default_factory=lambda: float(_env("GEMINI_TIMEOUT_S", "45")))
    briefing_rate_per_min: int = field(default_factory=lambda: int(_env("BRIEFING_RATE_PER_MIN", "6")))
    mc_draws: int = field(default_factory=lambda: int(_env("MC_DRAWS", "10000")))
    mc_seed: int = field(default_factory=lambda: int(_env("MC_SEED", "20261107")))
    reference_year: int | None = field(default_factory=lambda: int(_env("REFERENCE_YEAR")) if _env("REFERENCE_YEAR") else None)
    cors_origins: str = field(default_factory=lambda: _env("CORS_ORIGINS", "http://localhost:5173") or "")

    @property
    def is_sample(self) -> bool:
        return self.data_mode == "sample"

    @property
    def data_dir(self) -> Path:
        return self.sample_dir if self.is_sample else self.raw_dir


def get_settings() -> Settings:
    return Settings()
