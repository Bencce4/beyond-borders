#!/usr/bin/env python3
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Countries you actually draw on the map (CNTR_ID list from mapshaper)
target_iso3 = [
    "ALB","AUT","BIH","BEL","BGR","CHE","CYP","CZE","DEU","DNK","EST","GRC","ESP",
    "FIN","FRA","HRV","HUN","IRL","ISL","ITA","LTU","LUX","LVA","MNE","MKD",
    "MLT","NLD","NOR","POL","PRT","ROU","SRB","SWE","SVN","SVK","MDA","UKR"
]

permits = pd.read_csv(ROOT / "data" / "respermits_ua_agg.csv")
have = set(permits["dest_iso3"])

missing = sorted(set(target_iso3) - have)
extra   = sorted(have - set(target_iso3))

print("Countries on map:", len(target_iso3))
print("Countries with permit data:", len(have))
print("Missing (on map but no permits data):", missing)
print("Extra (permits data but not on map):", extra)
