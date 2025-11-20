import pandas as pd
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]
src = BASE / "data" / "migr_asytpsm_linear_2_0.csv"
out = BASE / "data" / "flows_ua_agg.csv"

print("Reading", src)

# Read everything, ignore Eurostat comment lines
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

cit_col   = pick("citizen")
sex_col   = pick("sex")
age_col   = pick("age")
geo_col   = pick("geo")
time_col  = pick("time_period")
value_col = pick("obs_value")
unit_col  = pick("unit")

print("\nUsing columns:")
print(" citizen :", cit_col)
print(" sex     :", sex_col)
print(" age     :", age_col)
print(" geo     :", geo_col)
print(" time    :", time_col)
print(" value   :", value_col)
print(" unit    :", unit_col)

# Keep only what we need, rename to clean names
df = df[[cit_col, sex_col, age_col, geo_col, time_col, value_col, unit_col]].copy()
df.columns = ["citizen", "sex", "age", "geo", "time_period", "obs_value", "unit"]

# Coerce key dimensions to string
for col in ["citizen", "sex", "age", "geo", "time_period", "unit"]:
    df[col] = df[col].astype(str)

print("\nSample citizen codes:", df["citizen"].dropna().unique().tolist()[:20])

# ---- Filter to Ukrainians, unit = NR (number of persons) ----
df = df[df["citizen"] == "UA"]
if df.empty:
    raise SystemExit("No rows with citizen == 'UA' – check citizen codes above.")

if "NR" in df["unit"].unique():
    df = df[df["unit"] == "NR"]

# Keep numeric values only
df = df[pd.to_numeric(df["obs_value"], errors="coerce").notna()]
df["obs_value"] = df["obs_value"].astype(float)

# ---- Latest time period ----
# ---- Use latest per-geo within last 6 months ----
print("Sample time_period values:", df["time_period"].dropna().unique().tolist()[-10:])

# Convert to datetime (monthly)
df["date"] = pd.to_datetime(df["time_period"], format="%Y-%m", errors="coerce")
df = df[df["date"].notna()]

max_date = df["date"].max()
cutoff = max_date - pd.DateOffset(months=5)  # last 6 months inclusive

print("Global latest date:", max_date)
print("Cutoff date (6-month window):", cutoff)

# Keep only rows within the 6-month window
df = df[(df["date"] >= cutoff) & (df["date"] <= max_date)]

# For each geo, keep its latest available month in that window
latest_by_geo = df.groupby("geo")["date"].transform("max")
df = df[df["date"] == latest_by_geo]

geos = sorted(df["geo"].dropna().unique().tolist())
print("Number of host geos (UA, last 6 months):", len(geos))
print("Host geos (UA, last 6 months):", geos)
print("Unique sex codes (UA, window):", df["sex"].dropna().unique().tolist())
print("Unique age codes (UA, window):", df["age"].dropna().unique().tolist()[:50])


print("Unique sex codes (UA, latest):", df["sex"].dropna().unique().tolist())
print("Unique age codes (UA, latest):", df["age"].dropna().unique().tolist()[:50])

# ---- Age groups (tweak if codes differ) ----
CHILD_AGES = {"Y_LT18", "Y0-14", "Y15-17", "Y14-17", "Y_LT14"}
ELDER_AGES = {"Y_GE65", "Y65-79", "Y_GE80", "Y80-84", "Y85-89", "Y_GE90"}

# --- Disjoint bins ---
core = df[df["age"] != "UNK"]

# Total refugees per host (sex=T, any age except UNK)
total = (
    core[core["sex"] == "T"]
    .groupby("geo", as_index=False)["obs_value"]
    .sum()
    .rename(columns={"obs_value": "total_refugees"})
)

# Children (all sexes, <18)
children = (
    core[(core["sex"] == "T") & (core["age"].isin(CHILD_AGES))]
    .groupby("geo", as_index=False)["obs_value"]
    .sum()
    .rename(columns={"obs_value": "children"})
)

# Elderly (all sexes, 65+)
elderly = (
    core[(core["sex"] == "T") & (core["age"].isin(ELDER_AGES))]
    .groupby("geo", as_index=False)["obs_value"]
    .sum()
    .rename(columns={"obs_value": "elderly"})
)

# Women, adult 18–64 (sex=F, ages not child/elder)
women_adult = (
    core[(core["sex"] == "F") & (~core["age"].isin(CHILD_AGES | ELDER_AGES))]
    .groupby("geo", as_index=False)["obs_value"]
    .sum()
    .rename(columns={"obs_value": "women_adult"})
)

# Men, adult 18–64 (sex=M, ages not child/elder)
men_adult = (
    core[(core["sex"] == "M") & (~core["age"].isin(CHILD_AGES | ELDER_AGES))]
    .groupby("geo", as_index=False)["obs_value"]
    .sum()
    .rename(columns={"obs_value": "men_adult"})
)

# Unknown ages (sex=T, age=UNK) — tracked separately
unknown_age = (
    df[(df["sex"] == "T") & (df["age"] == "UNK")]
    .groupby("geo", as_index=False)["obs_value"]
    .sum()
    .rename(columns={"obs_value": "unknown_age"})
)

# Merge
flow = (
    total.merge(children, on="geo", how="left")
         .merge(elderly, on="geo", how="left")
         .merge(women_adult, on="geo", how="left")
         .merge(men_adult, on="geo", how="left")
         .merge(unknown_age, on="geo", how="left")
)

for col in ["children", "elderly", "women_adult", "men_adult", "unknown_age"]:
    flow[col] = flow[col].fillna(0.0)

# Percentages (disjoint bins using total_refugees)
flow["pct_children"]    = flow["children"]    / flow["total_refugees"]
flow["pct_elderly"]     = flow["elderly"]     / flow["total_refugees"]
flow["pct_women_adult"] = flow["women_adult"] / flow["total_refugees"]
flow["pct_men_adult"]   = flow["men_adult"]   / flow["total_refugees"]
flow["pct_unknown_age"] = flow["unknown_age"] / flow["total_refugees"]

# Map Eurostat GEO (ISO2-ish) to ISO3
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

flow["dest_iso3"] = flow["geo"].map(iso2_to_iso3)
flow = flow[flow["dest_iso3"].notna()].copy()

flow = flow[[
    "dest_iso3",
    "total_refugees",
    "pct_children",
    "pct_elderly",
    "pct_women_adult",
    "pct_men_adult",
    "pct_unknown_age"
]]

print("\nPreview:")
print(flow.head())
print("Rows:", len(flow))

print("Writing", out)
flow.to_csv(out, index=False)
