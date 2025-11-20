#!/usr/bin/env python3
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC  = ROOT / "data" / "migr_resvalid__custom_18711207_linear_2_0.csv"
FLOWS_CSV  = ROOT / "data" / "flows_ua_agg.csv"
FLOWS_JSON = ROOT / "data" / "flows_ua_agg.json"
DST_CSV  = ROOT / "data" / "respermits_ua_agg.csv"
DST_JSON = ROOT / "data" / "respermits_ua_agg.json"

print(f"Reading {SRC}")

df_raw = pd.read_csv(SRC, comment="#", low_memory=False)

print("Original columns:")
for i, c in enumerate(df_raw.columns):
    print(f"{i:2d}: {c!r}")

# ---------- helpers ----------
def pick(aliases):
    for a in aliases:
        if a in df_raw.columns:
            return a
    raise KeyError(f"None of {aliases} found in columns")

def pick_optional(aliases):
    for a in aliases:
        if a in df_raw.columns:
            return a
    return None

# mandatory cols
citizen_col = pick(["citizen", "CITIZEN"])
geo_col     = pick(["geo", "GEO"])
time_col    = pick(["TIME_PERIOD", "time_period", "time", "TIME"])
value_col   = pick(["OBS_VALUE", "obs_value"])
unit_col    = pick(["unit", "UNIT"])

# optional
duration_col = pick_optional(["duration", "DURATION"])
reason_col   = pick_optional(["reason", "REASON"])
sex_col      = pick_optional(["sex", "SEX"])
age_col      = pick_optional(["age", "AGE"])

col_map = {
    "citizen": citizen_col,
    "geo":     geo_col,
    "time":    time_col,
    "value":   value_col,
    "unit":    unit_col,
}
if duration_col: col_map["duration"] = duration_col
if reason_col:   col_map["reason"]   = reason_col
if sex_col:      col_map["sex"]      = sex_col
if age_col:      col_map["age"]      = age_col

print("\nUsing columns:")
for k, v in col_map.items():
    print(f" {k:9s}: {v}")

df = df_raw[list(col_map.values())].rename(columns={v: k for k, v in col_map.items()})

print("\nSample citizen codes:", sorted(df["citizen"].dropna().astype(str).unique())[:20])

# ---------- 1) Ukrainian citizens only ----------
df = df[df["citizen"].isin(["UA", "UKR"])].copy()
print(f"Rows with UA/UKR: {len(df)}")

# Debug info on duration / reason
if "duration" in df.columns:
    print("Unique duration codes (UA subset):",
          sorted(df["duration"].dropna().astype(str).unique())[:20])
if "reason" in df.columns:
    print("Unique reason codes (UA subset):",
          sorted(df["reason"].dropna().astype(str).unique())[:20])

# If sex/age exist, compress to TOTAL/T
if "sex" in df.columns:
    print("Unique sex codes (UA subset):",
          sorted(df["sex"].dropna().astype(str).unique()))
    df = df[df["sex"].astype(str).isin(["T", "TOTAL"])]

if "age" in df.columns:
    print("Unique age codes (UA subset):",
          sorted(df["age"].dropna().astype(str).unique()))
    df = df[df["age"].astype(str).isin(["TOTAL"])]

print(f"Rows after optional sex/age filter: {len(df)}")

# ---------- 2) latest year ----------
t = df["time"].astype(str)
df["year"] = pd.to_numeric(t.str.slice(0, 4), errors="coerce")
years = sorted(df["year"].dropna().unique())
print("Years present:", years)
latest_year = df["year"].max()
print("Latest year:", latest_year)
df = df[df["year"] == latest_year].copy()
print(f"Rows in latest year {latest_year}: {len(df)}")

# ---------- 3) aggregate per geo ----------
agg = (
    df.groupby("geo", as_index=False)["value"]
      .sum()
      .rename(columns={"value": "permits_total"})
)

print("\nPreview (geo / permits_total):")
print(agg.head())

# ---------- 4) map GEO -> ISO3 ----------
GEO_TO_ISO3 = {
    "AL": "ALB", "AT": "AUT", "BA": "BIH", "BE": "BEL", "BG": "BGR", "CH": "CHE",
    "CY": "CYP", "CZ": "CZE", "DE": "DEU", "DK": "DNK", "EE": "EST", "EL": "GRC",
    "ES": "ESP", "FI": "FIN", "FR": "FRA", "HR": "HRV", "HU": "HUN", "IE": "IRL",
    "IS": "ISL", "IT": "ITA", "LT": "LTU", "LU": "LUX", "LV": "LVA", "ME": "MNE",
    "MK": "MKD", "MT": "MLT", "NL": "NLD", "NO": "NOR", "PL": "POL", "PT": "PRT",
    "RO": "ROU", "RS": "SRB", "SE": "SWE", "SI": "SVN", "SK": "SVK",
    "MD": "MDA", "UA": "UKR", "GB": "GBR", "LI": "LIE"
}

missing_geo = sorted(set(agg["geo"]) - set(GEO_TO_ISO3.keys()))
if missing_geo:
    print("\nWARNING: missing ISO3 mapping for GEO codes:", missing_geo)

agg["dest_iso3"] = agg["geo"].map(GEO_TO_ISO3)
agg = agg[agg["dest_iso3"].notna()].copy()

# ---------- 5) attach lat/lon from flows (prefer JSON) ----------
def load_flows_pos():
    # try CSV first
    if FLOWS_CSV.exists():
        f = pd.read_csv(FLOWS_CSV)
        if {"dest_iso3", "lat", "lon"}.issubset(f.columns):
            print("Using positions from flows_ua_agg.csv")
            return f[["dest_iso3", "lat", "lon"]].drop_duplicates()

    # fallback: JSON (this is what you actually have with lat/lon)
    if FLOWS_JSON.exists():
        print("Using positions from flows_ua_agg.json")
        f = pd.read_json(FLOWS_JSON)
        if {"dest_iso3", "lat", "lon"}.issubset(f.columns):
            return f[["dest_iso3", "lat", "lon"]].drop_duplicates()

    raise RuntimeError("Could not find lat/lon in flows_ua_agg.{csv,json}")

pos = load_flows_pos()
agg = agg.merge(pos, on="dest_iso3", how="left")

agg = agg[["dest_iso3", "permits_total", "lat", "lon"]].sort_values(
    "permits_total", ascending=False
)

print("\nClean residence-permit table:")
print(agg.head(10))
print("Rows:", len(agg))

print(f"Writing {DST_CSV}")
agg.to_csv(DST_CSV, index=False)

print(f"Writing {DST_JSON}")
agg.to_json(DST_JSON, orient="records", indent=2)
