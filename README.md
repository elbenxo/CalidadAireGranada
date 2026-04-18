# Informe mensual de calidad del aire · Granada

Web estática que genera informes mensuales de calidad del aire (NO₂, PM10,
PM2.5) para la ciudad de Granada, con comparativa contra los 10 años
anteriores del mismo mes y cruce con la IMD (tráfico) publicada por el CGIM.

Pensado para el Ayuntamiento de Granada. Publicado en GitHub Pages.

## Cómo funciona

1. `scripts/scrape.py` descarga:
   - Medias mensuales por (estación, año, mes, contaminante) desde
     `granada.org/inet/calidadaire.nsf/grf` → `data/air.json`.
   - IMD mensual y anual desde `movilidadgranada.com/tra_datos.php` (tabla
     Google Charts embebida) → `data/traffic.json`.
2. `index.html` + `js/app.js` leen esos JSON estáticos y renderizan el
   informe. Sin backend, sin CORS, sin build-tools.
3. `.github/workflows/scrape.yml` ejecuta el scraper el día 2 de cada mes
   y despliega la web actualizada en GitHub Pages.

## Stack

- HTML + CSS + JS vanilla
- [Chart.js](https://www.chartjs.org/) vía CDN
- Python 3.11 (`requests`) para el scraper
- GitHub Actions + GitHub Pages

## Local

```bash
# Regenerar los datos (≈15 min)
pip install requests
python3 scripts/scrape.py --years 2015-2026 --out data/

# Servir localmente
python3 -m http.server 8000
# http://localhost:8000/
```

## Publicar en GitHub Pages

En el repositorio de GitHub:

1. Settings → Pages → Source → **GitHub Actions**.
2. El workflow `Monthly data refresh & deploy` desplegará automáticamente
   tras cada push a la rama activa y el día 2 de cada mes.

## Detalles técnicos

Ver `.claude/skills/calidad-aire-granada/SKILL.md` para la documentación
completa de los endpoints, parámetros y convenciones del informe.
