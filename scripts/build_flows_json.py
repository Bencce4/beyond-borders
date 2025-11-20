import pandas as pd
import json
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
src = BASE / "data" / "flows_ua_agg.csv"
out = BASE / "data" / "flows_ua_agg.json"

print("Reading", src)
df = pd.read_csv(src)

# Rough country centroids (good enough for arrows)
iso3_to_latlon = {
    "AUT": (47.52, 14.55),
    "BEL": (50.50, 4.47),
    "BGR": (42.73, 25.49),
    "HRV": (45.10, 15.20),
    "CYP": (35.10, 33.40),
    "CZE": (49.82, 15.47),
    "DEU": (51.17, 10.45),
    "DNK": (56.26, 9.50),
    "EST": (58.60, 25.01),
    "ESP": (40.46, -3.75),
    "FIN": (61.92, 25.75),
    "FRA": (46.60, 2.21),
    "GRC": (39.07, 21.82),
    "HUN": (47.16, 19.50),
    "IRL": (53.14, -8.00),
    "ISL": (64.96, -19.02),
    "ITA": (41.87, 12.57),
    "LTU": (55.17, 23.88),
    "LUX": (49.81, 6.13),
    "LVA": (56.88, 24.60),
    "MLT": (35.94, 14.38),
    "NLD": (52.13, 5.29),
    "NOR": (60.47, 8.47),
    "POL": (51.92, 19.15),
    "PRT": (39.40, -8.22),
    "ROU": (45.94, 24.97),
    "SWE": (60.13, 18.64),
    "SVN": (46.15, 14.99),
    "SVK": (48.67, 19.70),
    "CHE": (46.82, 8.23),
    "GBR": (55.38, -3.44),
    "ALB": (41.15, 20.17),
    "BIH": (44.30, 17.60),
    "SRB": (44.02, 21.01),
    "MNE": (42.75, 19.27),
    "MKD": (41.60, 21.75),
    "MDA": (47.41, 28.37),
    "UKR": (49.00, 31.00),
}

def get_lat(iso3):
    pair = iso3_to_latlon.get(iso3)
    return None if pair is None else pair[0]

def get_lon(iso3):
    pair = iso3_to_latlon.get(iso3)
    return None if pair is None else pair[1]

df["lat"] = df["dest_iso3"].map(get_lat)
df["lon"] = df["dest_iso3"].map(get_lon)

# Drop any rows we don't have coords for (shouldn't happen for your 10 rows)
df = df[df["lat"].notna()].copy()

# Rename columns to what main.js expects
df = df.rename(columns={
    "dest_iso3": "dest_iso3",
    "total_refugees": "total_refugees",
    "pct_children": "pct_children",
    "pct_elderly": "pct_elderly",
    "pct_women_adult": "pct_women_adult",
    "pct_men_adult": "pct_men_adult",
    "pct_unknown_age": "pct_unknown_age",
})

records = df.to_dict(orient="records")

print("Preview record:")
print(records[0] if records else "NO RECORDS")
print("Rows:", len(records))
print("Writing", out)

with open(out, "w") as f:
    json.dump(records, f, indent=2)
