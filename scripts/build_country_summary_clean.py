import pandas as pd
from pathlib import Path


BASE = Path(__file__).resolve().parents[1]
SRC = BASE / "data" / "9a488f59-b74d-4043-bef1-23ed4f2b6293-Ukraine-Support-Tracker-Release-25 (1).xlsx"
OUT = BASE / "data" / "country_summary_clean.csv"

# Header row index (0-based) for the Country Summary (€) sheet
HEADER_ROW = 7

KEEP = [
    "Country",
    "EU member",
    "Geographic Europe",
    "Total bilateral allocations",
    "Total bilateral commitments",
    "Total bilateral and EU allocations",
    "Total bilateral and EU allocations.1",  # % GDP 2021
    "Financial allocations",
    "Humanitarian allocations",
    "Military allocations",
    "Financial commitments",
    "Humanitarian commitments",
    "Military commitments",
]


def main():
    print("Reading", SRC)
    df = pd.read_excel(SRC, sheet_name="Country Summary (€)", header=HEADER_ROW)

    # Drop empty rows, keep desired columns, rename GDP share for clarity
    df = df[df["Country"].notna()].copy()
    df = df[KEEP]
    df = df.rename(columns={"Total bilateral and EU allocations.1": "Allocations % GDP 2021"})

    print("Rows:", len(df))
    print("Writing", OUT)
    df.to_csv(OUT, index=False)


if __name__ == "__main__":
    main()
