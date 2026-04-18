#!/usr/bin/env python3
"""Scrape Granada air quality + traffic data and write JSON files.

See .claude/skills/calidad-aire-granada/SKILL.md for source details.
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import urlencode

import requests

AIR_BASE = "https://www.granada.org/inet/calidadaire.nsf/grf"
TRAFFIC_PAGE = "http://www.movilidadgranada.com/tra_datos.php"

STATIONS = ["NORTE", "CONGRESOS"]
POLLUTANTS = ["NO2", "PART", "PM25"]
SPANISH_MONTHS = ["ene", "feb", "mar", "abr", "may", "jun",
                  "jul", "ago", "sep", "oct", "nov", "dic"]

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (compatible; GranadaAirReport/1.0; "
        "+https://github.com/elbenxo/calidadairegranada)"
    ),
}

MEDIA_RE = re.compile(
    r"Media:\s*<b>\s*([0-9]+(?:[.,][0-9]+)?)\s*</b>\s*&micro;g",
    re.IGNORECASE,
)
MAX_RE = re.compile(
    r"M[aá&]x[^:]*:\s*<b>\s*([0-9]+(?:[.,][0-9]+)?)",
    re.IGNORECASE,
)
MIN_RE = re.compile(
    r"M[ií&]n[^:]*:\s*<b>\s*([0-9]+(?:[.,][0-9]+)?)",
    re.IGNORECASE,
)


def spanish_number(s: str) -> float:
    return float(s.replace(".", "").replace(",", "."))


def fetch_month(session: requests.Session, year: int, month: int,
                station: str, pollutant: str) -> dict | None:
    params = {
        "open": "",
        "anio": str(year),
        "mes": f"{month:02d}",
        "parametro": pollutant,
        "punto": station,
    }
    url = f"{AIR_BASE}?{urlencode(params).replace('open=', 'open&').rstrip('&')}"
    # The endpoint wants `?open&anio=...`, urlencode adds `open=` — fix manually.
    url = f"{AIR_BASE}?open&anio={year}&mes={month:02d}&parametro={pollutant}&punto={station}"
    try:
        r = session.get(url, timeout=30, headers=HEADERS)
    except requests.RequestException as e:
        print(f"  ! {station}/{year}-{month:02d}/{pollutant} error: {e}", file=sys.stderr)
        return None
    if r.status_code != 200:
        print(f"  ! {station}/{year}-{month:02d}/{pollutant} HTTP {r.status_code}", file=sys.stderr)
        return None
    html = r.text
    m = MEDIA_RE.search(html)
    if not m:
        return None
    result = {"media": spanish_number(m.group(1))}
    mx = MAX_RE.search(html)
    mn = MIN_RE.search(html)
    if mx:
        result["max"] = spanish_number(mx.group(1))
    if mn:
        result["min"] = spanish_number(mn.group(1))
    return result


def scrape_air(years: range, out: Path, workers: int = 3) -> None:
    print(f"Scraping air quality for {list(years)} ...")
    session = requests.Session()
    current_year = datetime.now().year
    current_month = datetime.now().month

    tasks = []
    for year in years:
        for month in range(1, 13):
            # Skip future months
            if year > current_year or (year == current_year and month >= current_month):
                continue
            for station in STATIONS:
                for pollutant in POLLUTANTS:
                    tasks.append((year, month, station, pollutant))

    data: dict = {"meta": {"scraped_at": datetime.utcnow().isoformat() + "Z",
                           "stations": STATIONS, "pollutants": POLLUTANTS},
                  "records": {}}

    def worker(task):
        y, m, st, po = task
        res = fetch_month(session, y, m, st, po)
        time.sleep(0.4)
        return task, res

    done = 0
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for (y, m, st, po), res in ex.map(worker, tasks):
            done += 1
            key = f"{st}|{y}|{m:02d}|{po}"
            if res is not None:
                data["records"][key] = res
            if done % 25 == 0 or done == len(tasks):
                print(f"  {done}/{len(tasks)}  last={key} -> {res}")

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    print(f"Wrote {out} ({len(data['records'])} records).")


def scrape_traffic(out: Path) -> None:
    print("Scraping traffic IMD table ...")
    r = requests.get(TRAFFIC_PAGE, timeout=30, headers=HEADERS)
    r.raise_for_status()
    html = r.text
    # Locate the data8 arrayToDataTable block (monthly IMD)
    m = re.search(
        r"var\s+data8\s*=\s*google\.visualization\.arrayToDataTable\(\s*\[(.*?)\]\s*\);",
        html, re.DOTALL,
    )
    if not m:
        raise RuntimeError("Could not locate monthly IMD table in traffic page.")
    block = m.group(1)
    # Rows: each row is [...]
    rows = re.findall(r"\[([^\]]+)\]", block)
    if not rows:
        raise RuntimeError("No rows in IMD table.")
    header = [c.strip().strip("'\"") for c in rows[0].split(",")]
    years = [int(c) for c in header[1:]]
    monthly: dict[str, dict[int, int]] = {}
    for row in rows[1:]:
        cells = [c.strip().strip("'\"") for c in row.split(",")]
        month_label = cells[0]
        if month_label not in SPANISH_MONTHS:
            continue
        month_idx = SPANISH_MONTHS.index(month_label) + 1
        values = [int(c) for c in cells[1:] if c]
        monthly[f"{month_idx:02d}"] = dict(zip(years, values))

    # Also extract annual averages (data variable)
    m2 = re.search(
        r"var\s+data\s*=\s*google\.visualization\.arrayToDataTable\(\s*\[(.*?)\]\s*\);",
        html, re.DOTALL,
    )
    annual: dict[int, int] = {}
    if m2:
        for row in re.findall(r"\[([^\]]+)\]", m2.group(1)):
            cells = [c.strip().strip("'\"") for c in row.split(",")]
            if len(cells) == 2 and cells[0].isdigit():
                annual[int(cells[0])] = int(cells[1])

    data = {
        "meta": {
            "scraped_at": datetime.utcnow().isoformat() + "Z",
            "source": TRAFFIC_PAGE,
            "description": ("IMD (Intensidad Media Diaria) por carril de "
                            "circulación en Granada. Fuente: CGIM."),
        },
        "years": years,
        "monthly_imd": monthly,
        "annual_imd": annual,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    print(f"Wrote {out}. Years: {years[0]}-{years[-1]}.")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default="2015-" + str(datetime.now().year),
                    help="Year range FROM-TO inclusive.")
    ap.add_argument("--only", choices=["air", "traffic"], default=None)
    ap.add_argument("--out", default="data", help="Output directory.")
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()

    a, b = args.years.split("-")
    years = range(int(a), int(b) + 1)
    out_dir = Path(args.out)

    if args.only in (None, "air"):
        scrape_air(years, out_dir / "air.json", workers=args.workers)
    if args.only in (None, "traffic"):
        scrape_traffic(out_dir / "traffic.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
