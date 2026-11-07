"""Application service layer: everything the API does, without FastAPI (so it is unit-testable)."""
from __future__ import annotations

import json
import threading
from collections import OrderedDict

from . import montecarlo as M
from . import params as P
from .config import Settings
from .dataset import Dataset, build_dataset
from .loaders import DataFileError, file_status, load_geojson_admin0
from .planner import plan_drives, plan_to_csv
from .schemas import (CountryRequest, FacilityRequest, ModelRequest, PlanRequest, SensitivityRequest,
                      SimulateRequest)

SAMPLE_BANNER = "SAMPLE DATA: placeholder numbers for a demo, not estimates. Load the real files in data/raw/ to use."

FORMULAS = [
    "children ~ Lognormal(ln(point), (ln(upper) - ln(lower)) / (2 x 1.96))   [source point estimate and 95% interval]",
    "diagnosed = children x share_diagnosed",
    "events per child-year = (1 - hu) x rate_untreated + hu x rate_hydroxyurea",
    "demand_units = diagnosed x events per child-year x units_per_event",
    "national collections = donations_per_1000 / 1000 x population",
    "SCD paediatric demand as % of national collections = demand_units / collections",
    "gap_units = demand_units x target_coverage",
    "donors_needed = gap_units / (1 - donor_deferral_rate)",
    "universal scenario: share_diagnosed = 1, hu = universal_hydroxyurea_coverage",
    "units avoided by hydroxyurea = demand(universal diagnosis, hu = 0) - demand(universal diagnosis, hu = universal)",
]

LIMITATIONS = [
    "Everything about children, transfusion need and blood units is MODELLED, not observed.",
    "Transfusion rates come from the REACH trial in clinic-based children on study protocols; real-world rates may differ widely.",
    "Demand counts only diagnosed children (undiagnosed children may still be transfused, but not as known SCD patients).",
    "Expected events are used per child; Poisson noise is ignored because it is tiny at these counts.",
    "Shared parameters (rates, units, deferral, diagnosis share) are fully correlated across countries in each draw.",
    "No assumption is made about what share of national blood goes to SCD; demand is only compared with total collections.",
    "Summing GBD age-group and sub-cause intervals makes the country interval conservative (too wide).",
    "Admin1 split uses facility counts (or admin1 population if provided), not local SCD prevalence.",
    "The facility list has no blood bank or SCD clinic information.",
    "ML-imputed inputs use few covariates and ~40 countries; their intervals are wide on purpose.",
]


class AppState:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.params: dict | None = None
        self.ds: Dataset | None = None
        self.error: str | None = None
        self._sims: OrderedDict = OrderedDict()
        self._lock = threading.Lock()
        try:
            self.params = P.load_parameters(settings.params_path)
            self.ds = build_dataset(settings)
        except (DataFileError, P.ParameterError) as e:
            self.error = str(e)
            print("\n[SickleSupply] DATA NOT LOADED\n" + self.error + "\n")

    # ---------------------------------------------------------------- helpers
    def require(self) -> tuple[Dataset, dict]:
        if self.error or self.ds is None or self.params is None:
            raise DataFileError(self.error or "data not loaded")
        return self.ds, self.params

    def labels(self) -> dict:
        s = self.settings.is_sample
        return {"modelled": True, "sample_data": s, "banner": SAMPLE_BANNER if s else None}

    def _sim(self, req: ModelRequest) -> tuple[M.SimResult, dict]:
        ds, base = self.require()
        params = P.apply_overrides(base, req.overrides)
        seed = self.settings.mc_seed if req.seed is None else req.seed
        key = json.dumps([req.source, req.overrides, seed, self.settings.mc_draws], sort_keys=True)
        with self._lock:
            if key in self._sims:
                self._sims.move_to_end(key)
                return self._sims[key], params
        sim = M.simulate(ds, params, req.source, n=self.settings.mc_draws, seed=seed)
        with self._lock:
            self._sims[key] = sim
            while len(self._sims) > 24:
                self._sims.popitem(last=False)
        return sim, params

    # ---------------------------------------------------------------- endpoints
    def health(self) -> dict:
        return {"status": "ok" if not self.error else "data_error", "data_mode": self.settings.data_mode,
                "error": self.error, **self.labels()}

    def meta(self) -> dict:
        s = self.settings
        out = {"files": file_status(s.data_dir, s.raw_dir, s.is_sample), "error": self.error, **self.labels()}
        if self.ds is not None:
            c = self.ds.countries
            out.update({
                "sources": self.ds.sources, "warnings": self.ds.warnings, "excluded": self.ds.excluded,
                "facilities_error": self.ds.facilities_error, "admin1_basis": self.ds.admin1_share_basis,
                "countries": [{"iso3": i, "name": r["name"],
                               "admin1": sorted(self.ds.admin1_shares.loc[self.ds.admin1_shares["iso3"] == i, "admin1"].tolist())
                               if self.ds.admin1_shares is not None else []}
                              for i, r in c.iterrows()],
                "status_counts": {col: c[col].value_counts().to_dict()
                                  for col in ["donations_status"] + [f"{x}_status" for x in self.ds.sources]},
                "mc_draws": s.mc_draws, "mc_seed": s.mc_seed,
            })
        return out

    def parameters(self) -> dict:
        _, params = self.require()
        return {"parameters": P.public_view(params), **self.labels()}

    def simulate(self, req: SimulateRequest) -> dict:
        sim, params = self._sim(req)
        ds = self.ds
        return {
            "source": req.source, "rank_by": req.rank_by,
            "countries": M.summarise(sim, ds, top_k=req.top_k, rank_by=req.rank_by),
            "totals": M.totals(sim),
            "parameters": P.public_view(params),
            "n_draws": sim.n, "seed": sim.seed, **self.labels(),
        }

    def admin1(self, req: CountryRequest) -> dict:
        sim, _ = self._sim(req)
        return {**M.admin1_breakdown(sim, self.ds, req.iso3.upper()), **self.labels()}

    def facilities(self, req: FacilityRequest) -> dict:
        sim, _ = self._sim(req)
        return {**M.facilities_for(self.ds, sim, req.iso3.upper(), req.admin1), **self.labels()}

    def sensitivity(self, req: SensitivityRequest) -> dict:
        ds, base = self.require()
        params = P.apply_overrides(base, req.overrides)
        return {**M.sensitivity(ds, params, req.source, req.iso3), **self.labels()}

    def plan(self, req: PlanRequest) -> dict:
        sim, params = self._sim(req)
        p = plan_drives(sim, self.ds, params, iso3=req.iso3.upper(), admin1=req.admin1,
                        drives_per_month=req.drives_per_month, donors_per_drive=req.donors_per_drive,
                        horizon_months=req.horizon_months, partner_service=req.partner_service,
                        partner_confirmed_licensed=req.partner_confirmed_licensed,
                        seed=self.settings.mc_seed if req.seed is None else req.seed)
        p["country"] = self.ds.countries.loc[req.iso3.upper(), "name"]
        p["source"] = req.source
        p["assumptions"] = [x for x in P.public_view(params) if x["kind"] == "ASSUMPTION"]
        return {**p, **self.labels()}

    def plan_csv(self, req: PlanRequest) -> str:
        return plan_to_csv(self.plan(req), self.settings.is_sample)

    def method(self) -> dict:
        ds, params = self.require()
        return {
            "formulas": FORMULAS, "limitations": LIMITATIONS,
            "parameters": P.public_view(params),
            "imputation": {k: r.report() for k, r in ds.imputation.items()},
            "sources_loaded": ds.sources, "warnings": ds.warnings,
            "admin1_basis": ds.admin1_share_basis, "mc_draws": self.settings.mc_draws, "mc_seed": self.settings.mc_seed,
            **self.labels(),
        }

    def geo_admin0(self) -> dict:
        return load_geojson_admin0(self.settings.raw_dir)
