---
name: calidad-aire-granada
description: Reference for scraping and reporting Granada's monthly air quality (NO2, PM10, PM2.5) and city-level traffic IMD. Use when working with granada.org air-quality endpoints, movilidadgranada.com traffic data, or the monthly report web in this repo.
---

# Calidad del Aire y Tráfico de Granada

This skill documents the two data sources this project scrapes and the
conventions used to build the monthly report.

## 1. Air quality — www.granada.org (HTTPS)

Lotus Notes based portal. HTML only, no JSON API, no CORS.

### Stations (`punto`)
- `NORTE` — Estación Granada Norte
- `CONGRESOS` — Estación Palacio de Congresos

### Pollutants (`parametro`)
- `NO2` — Dióxido de nitrógeno (µg/m³). Used as NOx proxy; annual limit 40 µg/m³ (RD 102/2011).
- `PART` — Partículas PM10 (µg/m³). Annual limit 40 µg/m³.
- `PM25` — Partículas PM2.5 (µg/m³). Annual limit 25 µg/m³ → 20 µg/m³ (RD 102/2011 revisado).
- `SO2`, `CO`, `O3` — available but not part of the report.
- `ICA` — composite air-quality index (unitless).

Granada does NOT publish NO nor NOx totals; NO2 is the proxy.

### Endpoints

| Purpose | URL template |
|---|---|
| Year overview (daily ICA grid) | `https://www.granada.org/inet/calidadaire.nsf/icayear?open&anio=YYYY&punto=STATION` |
| Month average (hour-by-hour means) | `https://www.granada.org/inet/calidadaire.nsf/grf?open&anio=YYYY&mes=MM&parametro=PARAM&punto=STATION` |
| Day detail (hourly values) | `https://www.granada.org/inet/calidadaire.nsf/diaica?open&fecha=D/M/YYYY` |
| Parameter detail for one day | `https://www.granada.org/inet/calidadaire.nsf/verdia?open&dia=D&mes=M&anio=YYYY&punto=STATION&parametro=PARAM` |

`MM` must be zero-padded (`01`-`12`). `D/M/YYYY` is NOT zero-padded.

### Extracting the monthly mean

The `grf` endpoint renders a page whose HTML contains:

```
<td class='stxt' style='widht:50%;'>Media: <b>42,65</b> &micro;g/m<sup>3</sup></td>
```

Regex: `Media:\s*<b>\s*([\d,\.]+)\s*</b>\s*&micro;g`

Numbers use Spanish locale (comma decimal, dot thousands). Convert before parsing.

If the station has no data for a (year, month, pollutant) tuple, the page still
loads but the `Media` field is absent or shows zero. Treat missing as `null`.

### Coverage

Year selector in the site ranges **2015 to current year**. The current month is
only published once the month is over (banner on the site: "Los datos del mes
actual se presentarán el próximo mes").

### Rate limiting

No documented limit. Be polite: 0.5-1 s between requests, parallelism of 2-4.

## 2. Traffic — www.movilidadgranada.com (HTTP only, no HTTPS!)

**Important:** HTTPS on this host returns 503 via its CDN. Use plain HTTP.

### Monthly IMD table (city-level)

The page `http://www.movilidadgranada.com/tra_datos.php` embeds a Google Charts
`arrayToDataTable` call with the monthly IMD (Intensidad Media Diaria) per lane
per month, 2015 onward. Extract it directly from the HTML — it is the simplest
and most reliable way to get city-wide traffic intensity.

Look for the block:

```js
var data8 = google.visualization.arrayToDataTable([
  ['Mes', '2015', '2016', ..., 'YYYY'],
  ['ene',  3935, 4177, ...],
  ...
]);
```

Extract rows with regex:

```python
re.search(r"arrayToDataTable\(\[\s*\[([^\]]+)\](.*?)\]\);", html, re.DOTALL)
```

Then parse the header and the 12 month rows. Spanish month abbreviations: `ene,
feb, mar, abr, may, jun, jul, ago, sep, oct, nov, dic`.

### Per-point CSVs (optional, not used in current report)

Yearly ZIP: `http://www.movilidadgranada.com/tra/pm/YYYY-pm-granada.zip`.
Contains 12 nested `YYYY_MM.zip` / `YYYY_MM.rar` files, each with one CSV per
measurement point. **Avoid RAR** if you can — from mid-2024 onward some months
ship as RAR. The `rarfile` Python module needs the `unrar` binary installed.

Measurement-point metadata: `/tra/pm/Puntos-Medida_2022-01.csv` (177 points,
semicolon separator, lon/lat in ETRS89).

### 2025

2025 partial file: `/tra/pm/2025-pm-granada(hasta_oct).zip`. The filename moves
when they ship a new cutoff. The embedded IMD table usually lags until the full
year closes.

## 3. Report conventions used in this repo

- **Ventana**: 10 años previos al mes del informe, inclusive del propio mes.
  Ej: informe Marzo 2025 → compara con Marzo 2015-2024 + Marzo 2025.
- **Media mensual**: media aritmética de las medias horarias devueltas por `grf`.
  El propio endpoint ya devuelve la media agregada del mes — la usamos tal cual.
- **Valor por estación, luego agregado**: el informe muestra cada estación por
  separado y una fila "Media Granada" que promedia NORTE + CONGRESOS cuando
  ambas tienen datos.
- **Partículas diarias**: el informe agrupa PART (PM10) y PM25 bajo "Partículas".
  Aunque las mediciones son horarias en el portal, sólo consumimos la media
  mensual que el portal calcula. No reagregamos desde horarios.
- **Cruce con tráfico**: la IMD es anual a nivel ciudad. El informe muestra la
  IMD del año del informe junto a la del mismo año en cada comparativa.

## 4. Files in this repo

| Path | Purpose |
|---|---|
| `scripts/scrape.py` | Entry point. Fetches air + traffic, writes `data/air.json` and `data/traffic.json`. |
| `data/air.json` | Monthly means per (station, year, month, parameter). |
| `data/traffic.json` | Monthly IMD per year, plus annual average. |
| `index.html`, `css/`, `js/` | Static report UI served from GitHub Pages. |
| `.github/workflows/scrape.yml` | Runs `scripts/scrape.py` on the 9th of each month and commits new data. |

## 5. Running the scraper locally

```bash
pip install requests
python3 scripts/scrape.py --years 2015-2026 --out data/
```

Flags:
- `--years FROM-TO` year range (inclusive).
- `--only air|traffic` to run one source.
- `--dry-run` to log without writing.

Takes ~10-15 min for full 2015-current, 2 stations × 3 pollutants × 12 months.
