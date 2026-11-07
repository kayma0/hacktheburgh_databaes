"""Reference list of sub-Saharan African countries (World Bank SSA region, 48 countries).

ISO3 codes and UN M49 sub-regions are reference metadata, not model inputs to estimate.
Name aliases cover the spellings used by GBD, WHO, World Bank, HDX and Natural Earth.
"""
from __future__ import annotations

import re
import unicodedata

# iso3: (display name, UN M49 sub-region)
SSA_COUNTRIES: dict[str, tuple[str, str]] = {
    "AGO": ("Angola", "Middle Africa"),
    "BEN": ("Benin", "Western Africa"),
    "BWA": ("Botswana", "Southern Africa"),
    "BFA": ("Burkina Faso", "Western Africa"),
    "BDI": ("Burundi", "Eastern Africa"),
    "CPV": ("Cabo Verde", "Western Africa"),
    "CMR": ("Cameroon", "Middle Africa"),
    "CAF": ("Central African Republic", "Middle Africa"),
    "TCD": ("Chad", "Middle Africa"),
    "COM": ("Comoros", "Eastern Africa"),
    "COD": ("Democratic Republic of the Congo", "Middle Africa"),
    "COG": ("Republic of the Congo", "Middle Africa"),
    "CIV": ("Côte d'Ivoire", "Western Africa"),
    "GNQ": ("Equatorial Guinea", "Middle Africa"),
    "ERI": ("Eritrea", "Eastern Africa"),
    "SWZ": ("Eswatini", "Southern Africa"),
    "ETH": ("Ethiopia", "Eastern Africa"),
    "GAB": ("Gabon", "Middle Africa"),
    "GMB": ("The Gambia", "Western Africa"),
    "GHA": ("Ghana", "Western Africa"),
    "GIN": ("Guinea", "Western Africa"),
    "GNB": ("Guinea-Bissau", "Western Africa"),
    "KEN": ("Kenya", "Eastern Africa"),
    "LSO": ("Lesotho", "Southern Africa"),
    "LBR": ("Liberia", "Western Africa"),
    "MDG": ("Madagascar", "Eastern Africa"),
    "MWI": ("Malawi", "Eastern Africa"),
    "MLI": ("Mali", "Western Africa"),
    "MRT": ("Mauritania", "Western Africa"),
    "MUS": ("Mauritius", "Eastern Africa"),
    "MOZ": ("Mozambique", "Eastern Africa"),
    "NAM": ("Namibia", "Southern Africa"),
    "NER": ("Niger", "Western Africa"),
    "NGA": ("Nigeria", "Western Africa"),
    "RWA": ("Rwanda", "Eastern Africa"),
    "STP": ("São Tomé and Príncipe", "Middle Africa"),
    "SEN": ("Senegal", "Western Africa"),
    "SYC": ("Seychelles", "Eastern Africa"),
    "SLE": ("Sierra Leone", "Western Africa"),
    "SOM": ("Somalia", "Eastern Africa"),
    "ZAF": ("South Africa", "Southern Africa"),
    "SSD": ("South Sudan", "Eastern Africa"),
    "SDN": ("Sudan", "Northern Africa"),
    "TZA": ("Tanzania", "Eastern Africa"),
    "TGO": ("Togo", "Western Africa"),
    "UGA": ("Uganda", "Eastern Africa"),
    "ZMB": ("Zambia", "Eastern Africa"),
    "ZWE": ("Zimbabwe", "Eastern Africa"),
}

_EXTRA_ALIASES: dict[str, list[str]] = {
    "CPV": ["Cape Verde"],
    "CAF": ["CAR"],
    "COD": ["DR Congo", "DRC", "Congo, Dem. Rep.", "Congo (Kinshasa)", "Congo DR",
            "Democratic Republic of Congo", "Congo, The Democratic Republic of the", "Dem. Rep. Congo"],
    "COG": ["Congo", "Congo, Rep.", "Congo (Brazzaville)", "Congo Republic", "Rep. of the Congo"],
    "CIV": ["Cote d'Ivoire", "Ivory Coast", "Côte d’Ivoire"],
    "SWZ": ["Swaziland", "Kingdom of Eswatini"],
    "GMB": ["Gambia", "Gambia, The"],
    "STP": ["Sao Tome and Principe", "São Tomé & Príncipe", "Sao Tome & Principe"],
    "TZA": ["United Republic of Tanzania", "Tanzania, United Republic of", "Tanzania (United Republic of)"],
    "SSD": ["Republic of South Sudan"],
}


def _norm(name: str) -> str:
    s = unicodedata.normalize("NFKD", str(name)).encode("ascii", "ignore").decode()
    s = s.lower().replace("&", "and")
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return s


_LOOKUP: dict[str, str] = {}
for _iso, (_name, _) in SSA_COUNTRIES.items():
    _LOOKUP[_norm(_name)] = _iso
    _LOOKUP[_iso.lower()] = _iso
for _iso, _aliases in _EXTRA_ALIASES.items():
    for _a in _aliases:
        _LOOKUP[_norm(_a)] = _iso


def to_iso3(name_or_code: str | None) -> str | None:
    """Map a country name or ISO3 code to ISO3. Returns None if not a SSA country."""
    if name_or_code is None or (isinstance(name_or_code, float)):
        return None
    return _LOOKUP.get(_norm(name_or_code))


def country_name(iso3: str) -> str:
    return SSA_COUNTRIES[iso3][0]


def subregion(iso3: str) -> str:
    return SSA_COUNTRIES[iso3][1]
