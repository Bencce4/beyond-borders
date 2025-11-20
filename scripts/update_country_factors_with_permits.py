#!/usr/bin/env python3
import pandas as pd
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

CF_PATH      = ROOT / "data" / "country_factors.csv"
METRICS_PATH = ROOT / "data" / "respermits_ua_metrics.csv"

print(f"Reading {CF_PATH}")
cf = pd.read_csv(CF_PATH)

print("Country_factors columns:", list(cf.columns))

print(f"Reading {METRICS_PATH}")
m = pd.read_csv(METRICS_PATH)

print("Metrics columns:", list(m.columns))

cols_to_keep = [
    "dest_iso3",
    "permits_prewar",
    "permits_now",
    "ua_perm_delta",
    "total_refugees",
    "ua_perm_per_refugee",
    "ua_perm_share_war",
]

m_small = m[cols_to_keep].copy()

merged = cf.merge(m_small, on="dest_iso3", how="left")

print("\nPreview merged country_factors:")
print(merged.head())

print(f"Writing merged back to {CF_PATH}")
merged.to_csv(CF_PATH, index=False)
