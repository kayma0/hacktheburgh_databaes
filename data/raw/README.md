# data/raw/ : put the REAL input files here (not committed to git)

| File | Required? | Where to get it |
|---|---|---|
| `gbd_scd_2021.csv` | one burden source required | GBD Results Tool: GBD 2021, Prevalence, Number, sickle cell sub-causes **excluding trait**, Both sexes, ages `<5`, `5-9`, `10-14` years, sub-Saharan countries |
| `lancet_child_2026_country.csv` | one burden source required | Extract the country table: `country, value, lower, upper` (children living with SCD, 95% interval). Optional `iso3, metric, age_group, year` |
| `who_blood_donations_per_1000.csv` | yes | WHO GSRBS / GHO: `country, year, donations_per_1000, vnrd_share` |
| `population.csv` | yes | World Bank SP.POP.TOTL CSV (wide format OK) or UN WPP long format `country, year, population` |
| `country_metadata.csv` | yes | World Bank `Metadata_Country_*.csv` (in the SP.POP.TOTL zip): `Country Code, IncomeGroup` |
| `sub-saharan_health_facilities.xlsx` | for admin1 + facilities | HDX, Maina et al. 2019 public health facilities in sub-Saharan Africa |
| `africa_admin0.geojson` | for the map | Natural Earth admin-0 (Africa) or geoBoundaries ADM0, with an ISO3 property |
| `admin1_population.csv` | optional | `country (or iso3), admin1, population`; replaces the facility-count split |
| `parameters.yaml` | optional | copy of `config/parameters.yaml` if you want a data-specific version |

If a required file is missing, the API starts but every model endpoint returns HTTP 503 with these
instructions. To demo without real files: `make demo` (placeholder data + SAMPLE DATA banner).
