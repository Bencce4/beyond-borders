#!/usr/bin/env python3
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

SRC_RES = ROOT / "data" / "migr_resvalid__custom_18711207_linear_2_0.csv"
FLOWS_CSV = ROOT / "data" / "flows_ua_agg.csv"
FLOWS_JSON = ROOT / "data" / "flows_ua_agg.json"

OUT_AGG_CSV   = ROOT / "data" / "respermits_ua_agg.csv"
OUT_AGG_JSON  = ROOT / "data" / "respermits_ua_agg.json"
OUT_METRICS_CSV  = ROOT / "data" / "respermits_ua_metrics.csv"
OUT_METRICS_JSON = ROOT / "data" / "respermits_ua_metrics.json"

PREWAR_CUTOFF = 2021  # latest year <= this is treated as "pre-war"

print(f"Reading {SRC_RES}")
df_raw = pd.read_csv(SRC_RES, comment="#", low_memory=False)

print("Original columns:")
for i, c in enumerate(df_raw.columns):
    print(f"{i:2d}: {c!r}")

# ---------------- helpers ----------------
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

citizen_col = pick(["citizen", "CITIZEN"])
geo_col     = pick(["geo", "GEO"])
time_col    = pick(["TIME_PERIOD", "time_period", "time", "TIME"])
value_col   = pick(["OBS_VALUE", "obs_value"])
unit_col    = pick(["unit", "UNIT"])
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

# ---------- UA citizens only ----------
df = df[df["citizen"].isin(["UA", "UKR"])].copy()
print(f"Rows with UA/UKR: {len(df)}")

# Optional filters
if "duration" in df.columns:
    print("Unique duration codes (UA subset):",
          sorted(df["duration"].dropna().astype(str).unique())[:20])

if "reason" in df.columns:
    print("Unique reason codes (UA subset):",
          sorted(df["reason"].dropna().astype(str).unique())[:20])

if "sex" in df.columns:
    print("Unique sex codes (UA subset):",
          sorted(df["sex"].dropna().astype(str).unique()))
    df = df[df["sex"].astype(str).isin(["T", "TOTAL"]) | df["sex"].isna()]

if "age" in df.columns:
    print("Unique age codes (UA subset):",
          sorted(df["age"].dropna().astype(str).unique()))
    df = df[df["age"].astype(str).isin(["TOTAL"]) | df["age"].isna()]

print(f"Rows after optional sex/age filter: {len(df)}")

# ---------- aggregate per GEO, per year ----------
t = df["time"].astype(str)
df["year"] = pd.to_numeric(t.str.slice(0, 4), errors="coerce")
years = sorted(df["year"].dropna().unique())
print("Years present:", years)

g = (
    df.dropna(subset=["year"])
      .groupby(["geo", "year"], as_index=False)["value"]
      .sum()
      .rename(columns={"value": "permits_total"})
)

latest_year = int(g["year"].max())
print("Latest year:", latest_year)

# latest snapshot
now_df = g[g["year"] == latest_year].copy()

# pre-war: latest year <= PREWAR_CUTOFF per GEO
pre_df = (
    g[g["year"] <= PREWAR_CUTOFF]
    .sort_values(["geo", "year"])
    .groupby("geo", as_index=False)
    .tail(1)
    .rename(columns={"year": "prewar_year", "permits_total": "permits_prewar"})
)

print("\nPreview latest permits (geo / year / permits_total):")
print(now_df.head())

print("\nPreview pre-war permits (geo / prewar_year / permits_prewar):")
print(pre_df.head())

# ---------- merge now + pre-war ----------
merged = now_df[["geo", "permits_total"]].rename(columns={"permits_total": "permits_now"})
merged = merged.merge(pre_df[["geo", "permits_prewar"]], on="geo", how="left")
merged["permits_prewar"] = merged["permits_prewar"].fillna(0.0)

merged["ua_perm_delta"] = (merged["permits_now"] - merged["permits_prewar"]).clip(lower=0.0)

print("\nMerged permits (geo / prewar / now / delta):")
print(merged.head())

# ---------- GEO -> ISO3 ----------
GEO_TO_ISO3 = {
    "AL": "ALB", "AT": "AUT", "BA": "BIH", "BE": "BEL", "BG": "BGR", "CH": "CHE",
    "CY": "CYP", "CZ": "CZE", "DE": "DEU", "DK": "DNK", "EE": "EST", "EL": "GRC",
    "ES": "ESP", "FI": "FIN", "FR": "FRA", "HR": "HRV", "HU": "HUN", "IE": "IRL",
    "IS": "ISL", "IT": "ITA", "LT": "LTU", "LU": "LUX", "LV": "LVA", "ME": "MNE",
    "MK": "MKD", "MT": "MLT", "NL": "NLD", "NO": "NOR", "PL": "POL", "PT": "PRT",
    "RO": "ROU", "RS": "SRB", "SE": "SWE", "SI": "SVN", "SK": "SVK",
    "MD": "MDA", "UA": "UKR", "GB": "GBR", "LI": "LIE"
}

merged["dest_iso3"] = merged["geo"].map(GEO_TO_ISO3)
missing_geo = sorted(set(merged["geo"]) - set(GEO_TO_ISO3.keys()))
if missing_geo:
    print("\nWARNING: missing ISO3 mapping for GEO codes:", missing_geo)

merged = merged[merged["dest_iso3"].notna()].copy()

# ---------- attach refugees from flows ----------
def load_flows():
    if FLOWS_CSV.exists():
        f = pd.read_csv(FLOWS_CSV)
        print("Using flows_ua_agg.csv for refugees")
        return f
    if FLOWS_JSON.exists():
        f = pd.read_json(FLOWS_JSON)
        print("Using flows_ua_agg.json for refugees")
        return f
    raise RuntimeError("Could not find flows_ua_agg with dest_iso3 + total_refugees")

flows = load_flows()
print("Flows columns:", list(flows.columns))

# refugees
if not {"dest_iso3", "total_refugees"}.issubset(flows.columns):
    raise RuntimeError("flows_ua_agg is missing dest_iso3 or total_refugees columns")

# positions (lat/lon) are optional
if {"lat", "lon"}.issubset(flows.columns):
    pos = flows[["dest_iso3", "lat", "lon"]].drop_duplicates()
else:
    print("WARNING: flows has no lat/lon; using NaN for positions")
    pos = flows[["dest_iso3"]].drop_duplicates()
    pos["lat"] = pd.NA
    pos["lon"] = pd.NA

# join refugees
merged = merged.merge(
    flows[["dest_iso3", "total_refugees"]],
    on="dest_iso3",
    how="left"
)

# ---------- compute ratios ----------
merged["ua_perm_per_refugee"] = pd.NA
mask = (merged["total_refugees"] > 0) & (merged["ua_perm_delta"] > 0)
merged.loc[mask, "ua_perm_per_refugee"] = (
    merged.loc[mask, "ua_perm_delta"] / merged.loc[mask, "total_refugees"]
)

merged["ua_perm_share_war"] = pd.NA
ratio = merged["ua_perm_per_refugee"]
share_mask = ratio.notna() & (ratio >= 0)
merged.loc[share_mask, "ua_perm_share_war"] = ratio[share_mask] / (1.0 + ratio[share_mask])

# ---------- write outputs ----------
agg_latest = merged.merge(pos, on="dest_iso3", how="left")

agg_latest_out = agg_latest[["dest_iso3", "permits_now", "lat", "lon"]].rename(
    columns={"permits_now": "permits_total"}
).sort_values("permits_total", ascending=False)

print("\nClean latest-permits table:")
print(agg_latest_out.head(10))
print("Rows:", len(agg_latest_out))

print(f"Writing {OUT_AGG_CSV}")
agg_latest_out.to_csv(OUT_AGG_CSV, index=False)

print(f"Writing {OUT_AGG_JSON}")
agg_latest_out.to_json(OUT_AGG_JSON, orient="records", indent=2)

metrics = merged.merge(pos, on="dest_iso3", how="left")

metrics_out = metrics[
    [
        "dest_iso3",
        "permits_prewar",
        "permits_now",
        "ua_perm_delta",
        "total_refugees",
        "ua_perm_per_refugee",
        "ua_perm_share_war",
        "lat",
        "lon",
    ]
].sort_values("dest_iso3")

print("\nPermit metrics table:")
print(metrics_out.head(10))
print("Rows:", len(metrics_out))

print(f"Writing {OUT_METRICS_CSV}")
metrics_out.to_csv(OUT_METRICS_CSV, index=False)

print(f"Writing {OUT_METRICS_JSON}")
metrics_out.to_json(OUT_METRICS_JSON, orient="records", indent=2)
