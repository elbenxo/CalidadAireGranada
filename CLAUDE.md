# CLAUDE.md

Guía para Claude cuando trabaje en este repositorio.

## 1. Qué es este proyecto

Web estática que publica un **informe mensual de calidad del aire de la
ciudad de Granada**, pensado para el Ayuntamiento de Granada y alojado en
GitHub Pages. El informe compara el mes en curso con los mismos meses de
los 10 años anteriores y cruza los datos con la intensidad de tráfico
(IMD) de la ciudad para estudiar si existe una relación causal entre
caída del tráfico y caída de contaminantes.

- URL de despliegue: GitHub Pages sobre la rama activa.
- Audiencia: técnicos del Ayuntamiento de Granada y ciudadanía.
- Branding: escudo y marca de `granada.org` (icono oficial Calidad del Aire).

## 2. Objetivos

1. **Informe legible**: portada, resumen ejecutivo, KPIs, gráficas y
   tabla detallada por estación, listo para imprimir en PDF (A4).
2. **Comparativa histórica**: ventana móvil de 10 años sobre el mismo
   mes, con referencia al valor límite anual (RD 102/2011).
3. **Cruce con tráfico**: análisis de correlación real (Pearson + recta
   de regresión) entre IMD mensual y media del contaminante, no solo
   gráficos decorativos.
4. **Cero mantenimiento**: `GitHub Actions` refresca datos y redeploy
   el día 2 de cada mes sin intervención.
5. **Sin backend**: solo hosting estático → `JSON` precomputado.

## 3. Fuentes de datos

### 3.1 Calidad del aire — `granada.org` (HTTPS, Lotus Notes)

Portal municipal sin API. Se scrapea HTML.

- Estaciones: `NORTE` (Granada Norte), `CONGRESOS` (Palacio de Congresos).
- Contaminantes usados: `NO2`, `PART` (PM10), `PM25`.
- Granada **no publica NOx total** → se usa NO₂ como proxy.
- Endpoint clave (media mensual agregada):
  `https://www.granada.org/inet/calidadaire.nsf/grf?open&anio=YYYY&mes=MM&parametro=PARAM&punto=STATION`
- Regex para extraer la media: `Media:\s*<b>\s*([\d,\.]+)\s*</b>\s*&micro;g`
- Números en locale español (coma decimal).

### 3.2 Tráfico — `movilidadgranada.com` (HTTP solo, ¡no HTTPS!)

CGIM publica la IMD mensual (Intensidad Media Diaria, veh/día·carril) a
nivel ciudad en una tabla `google.visualization.arrayToDataTable`
embebida en `http://www.movilidadgranada.com/tra_datos.php`.

- HTTPS devuelve 503 en ese host → usar HTTP.
- Se extrae con regex desde el JS inline, no hace falta descomprimir ZIPs
  ni CSVs por punto (aunque existen; ver `SKILL.md`).
- Meses en abreviaturas españolas: `ene, feb, mar, abr, may, jun, jul,
  ago, sep, oct, nov, dic`.

### 3.3 Documentación detallada

`.claude/skills/calidad-aire-granada/SKILL.md` es la referencia canónica
de endpoints, regex, convenciones y flags del scraper. **Consultarla
antes de modificar el scraper o los endpoints.**

## 4. Arquitectura

```
 ┌──────────────────────────────┐
 │ GitHub Actions (mensual)     │
 │ scripts/scrape.py            │
 │   → data/air.json            │
 │   → data/traffic.json        │
 │ git commit & push            │
 └──────────────┬───────────────┘
                │
                ▼
 ┌──────────────────────────────┐
 │ GitHub Pages (estático)      │
 │ index.html + css/ + js/      │
 │   fetch('data/*.json')       │
 │   Chart.js (CDN)             │
 └──────────────────────────────┘
```

- **Pre-scrape + JSON estático + Actions**: evita CORS y cumple con
  limitaciones de GitHub Pages (sin backend).
- Los JSON se commitean al repo y viajan con el despliegue.
- El frontend es vanilla JS + Chart.js desde CDN. Sin bundler.

## 5. Estructura del repositorio

| Ruta | Propósito |
|---|---|
| `index.html` | Layout del informe: portada, resumen, KPIs, gráficas, tabla, correlación tráfico, metodología, fuentes. |
| `css/style.css` | Paleta (rojo Granada `#a6192e`, oro `#d4a017`), layout responsive (breakpoints 700/900 px), estilos de impresión A4. |
| `js/app.js` | Lógica del informe: carga JSON, renderiza KPIs, gráficas mensuales, tabla, análisis de Pearson + scatter, resumen. |
| `scripts/scrape.py` | Scraper Python 3 con `requests` y `ThreadPoolExecutor`. Soporta `--years FROM-TO`, `--only air\|traffic`, `--dry-run`. |
| `data/air.json` | Medias mensuales por (estación, año, mes, contaminante). |
| `data/traffic.json` | IMD mensual por año y media anual. |
| `.github/workflows/scrape.yml` | Cron mensual (`15 6 2 * *`) + redeploy en cada push. |
| `.claude/skills/calidad-aire-granada/SKILL.md` | Documentación operativa del scraper y del modelo de datos. |
| `README.md` | Descripción breve para humanos. |

## 6. Convenciones del informe

- **Ventana**: 10 años previos + mes en curso.
- **Agregación**: se consume la media mensual que ya calcula el portal
  (no re-agregamos desde horarios).
- **Por estación**: cada estación se muestra por separado + fila
  "Media Granada" cuando ambas tienen dato.
- **Valor límite anual**: línea discontinua en las gráficas (NO₂ 40,
  PM10 40, PM2.5 20 µg/m³).
- **Correlación tráfico–aire**:
  - Scatter IMD mensual vs media del contaminante, un punto por año.
  - Recta de regresión lineal, año en curso resaltado.
  - Coeficiente de Pearson, R², etiqueta cualitativa (fuerte / moderada
    / débil / inexistente), sensibilidad (Δµg/m³ por +1000 veh/día·carril).
  - Con n ≈ 10–11 la correlación es **indicativa**, no concluyente; las
    partículas reciben aportes no locales (polvo sahariano, calefacción).

## 7. Trabajo local

```bash
# Regenerar datos (~10-15 min)
pip install requests
python3 scripts/scrape.py --years 2015-2026 --out data

# Servir el sitio
python3 -m http.server 8000
# http://localhost:8000/
```

## 8. Directrices para cambios

- **No introducir backend**. Todo cálculo se hace en el scraper (Python)
  o en el cliente (JS). El hosting es estático.
- **No romper el print CSS**: el informe debe exportar limpio a PDF.
- **Responsive obligatorio**: probar ≤ 400 px; las gráficas deben
  mantenerse dentro del `canvas-holder` (posición absoluta dentro de un
  contenedor con altura fija).
- **Scraper educado**: 0.5–1 s entre requests, paralelismo 2–4.
- **Locale español** en números y meses tanto en scraper como en UI.
- **Nuevos contaminantes / estaciones**: añadir a `SKILL.md`, al
  diccionario `POLLUTANTS` de `js/app.js` y a la lista del scraper.
- **Ramas**: `main` (estable / despliegue) y `develop` (integración).
  El workflow de Pages redeploy en push a cualquiera de las dos.
