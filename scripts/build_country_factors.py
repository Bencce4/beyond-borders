import pandas as pd
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]

flows_path = BASE / "data" / "flows_ua_agg.csv"
gdp_path   = BASE / "data" / "gdp_pc_clean.csv"
out_path   = BASE / "data" / "country_factors.csv"

print("Reading", flows_path)
flows = pd.read_csv(flows_path)

print("Reading", gdp_path)
gdp = pd.read_csv(gdp_path)

# Unique host countries from your flows file
countries = pd.DataFrame({
    "dest_iso3": sorted(flows["dest_iso3"].dropna().unique())
})

print("Host countries from flows:", countries["dest_iso3"].tolist())

# Keep only dest_iso3 + gdp_pc (drop year for now)
gdp = gdp[["dest_iso3", "gdp_pc"]].copy()

# Merge: all countries in flows, GDP when available
factors = countries.merge(gdp, on="dest_iso3", how="left")

# Stub columns for future metrics
factors["aid_per_refugee"] = pd.NA
factors["unemployment"] = pd.NA

print("\nPreview of country_factors:")
print(factors.head())

print("Rows:", len(factors))
print("Writing", out_path)
factors.to_csv(out_path, index=False)
