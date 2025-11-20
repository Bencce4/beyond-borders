import pandas as pd
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
src = BASE / "data" / "sdg_08_10_linear_2_0.csv"
out = BASE / "data" / "gdp_pc_clean.csv"

print("Reading", src)
df = pd.read_csv(src, comment="#", low_memory=False)

print("Original columns:")
for i, c in enumerate(df.columns):
    print(f"{i:2d}: {repr(c)}")

cols = df.columns

def pick(target):
    tgt = target.lower()
    for c in cols:
        if c.strip().lower() == tgt:
            return c
    raise SystemExit(f"Could not find column for {target!r}")

geo_col   = pick("geo")
time_col  = pick("time_period")   # should match 'TIME_PERIOD'
value_col = pick("obs_value")     # should match 'OBS_VALUE'
unit_col  = pick("unit")

print("\nUsing columns:")
print(" geo   :", geo_col)
print(" time  :", time_col)
print(" value :", value_col)
print(" unit  :", unit_col)

# Keep only what we need
df = df[[geo_col, time_col, value_col, unit_col]].copy()
df.columns = ["geo", "time_period", "obs_value", "unit"]

# Coerce to string where needed
df["geo"] = df["geo"].astype(str)
df["time_period"] = df["time_period"].astype(str)
df["unit"] = df["unit"].astype(str)

print("\nSample units:", df["unit"].dropna().unique().tolist()[:20])

# ---- Filter to per-capita units (codes usually contain 'HAB') ----
mask_pc = df["unit"].str.contains("HAB", case=False, na=False)
if mask_pc.any():
    df = df[mask_pc]
    print("Filtered to per-capita units (HAB). Remaining units:",
          df["unit"].dropna().unique().tolist())
else:
    print("WARNING: no unit containing 'HAB' found; using all units as-is.")

# ---- Keep numeric values only ----
df = df[pd.to_numeric(df["obs_value"], errors="coerce").notna()]
df["obs_value"] = df["obs_value"].astype(float)

# ---- Extract year from time_period ----
# Works for '2023' or '2023-01' or '2023-01-01' etc.
df["year"] = pd.to_numeric(df["time_period"].str.slice(0, 4), errors="coerce")
df = df[df["year"].notna()]
df["year"] = df["year"].astype(int)

print("Years present:", sorted(df["year"].unique())[-10:])

latest_year = df["year"].max()
print("Latest year:", latest_year)

# If latest year looks too futuristic (garbage), you can clamp it manually later
df = df[df["year"] == latest_year]

# ---- One value per geo: average in case of duplicates ----
gdp = (
    df.groupby(["geo", "year"], as_index=False)["obs_value"]
      .mean()
      .rename(columns={"obs_value": "gdp_pc"})
)

print("\nPreview (geo/year/gdp_pc):")
print(gdp.head())
print("Rows before ISO mapping:", len(gdp))

# ---- Map GEO (ISO2-ish) to ISO3 ----
iso2_to_iso3 = {
    "AT": "AUT", "BE": "BEL", "BG": "BGR", "HR": "HRV", "CY": "CYP",
    "CZ": "CZE", "DE": "DEU", "DK": "DNK", "EE": "EST", "ES": "ESP",
    "FI": "FIN", "FR": "FRA", "GR": "GRC", "HU": "HUN", "IE": "IRL",
    "IS": "ISL", "IT": "ITA", "LT": "LTU", "LU": "LUX", "LV": "LVA",
    "MT": "MLT", "NL": "NLD", "NO": "NOR", "PL": "POL", "PT": "PRT",
    "RO": "ROU", "SE": "SWE", "SI": "SVN", "SK": "SVK",
    "CH": "CHE", "UK": "GBR", "GB": "GBR",
    "AL": "ALB", "BA": "BIH", "RS": "SRB", "ME": "MNE", "MK": "MKD",
    "MD": "MDA", "UA": "UKR"
}

gdp["dest_iso3"] = gdp["geo"].map(iso2_to_iso3)
missing = gdp[gdp["dest_iso3"].isna()]["geo"].unique().tolist()
if missing:
    print("WARNING: missing ISO3 mapping for GEO codes:", missing)

gdp = gdp[gdp["dest_iso3"].notna()].copy()

# Final columns for merging later
gdp = gdp[["dest_iso3", "gdp_pc", "year"]]

print("\nClean GDP pc table:")
print(gdp.head())
print("Rows after ISO mapping:", len(gdp))

print("Writing", out)
gdp.to_csv(out, index=False)
