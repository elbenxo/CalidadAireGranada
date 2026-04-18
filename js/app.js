// Granada Air Quality monthly report — static web app
// Consumes data/air.json and data/traffic.json produced by scripts/scrape.py

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const POLLUTANTS = {
  NO2:  { label: "NO₂",   unit: "µg/m³", limit: 40, proxy: "NOx" },
  PART: { label: "PM10",  unit: "µg/m³", limit: 40 },
  PM25: { label: "PM2.5", unit: "µg/m³", limit: 20 },
};

const STATION_LABELS = {
  NORTE: "Granada Norte",
  CONGRESOS: "Palacio de Congresos",
};

const WINDOW_YEARS = 10;

const state = {
  air: null,
  traffic: null,
  charts: {},
};

// ---------- Data loading ----------

async function loadData() {
  const [air, traffic] = await Promise.all([
    fetch("data/air.json", { cache: "no-store" }).then(r => r.json()),
    fetch("data/traffic.json", { cache: "no-store" }).then(r => r.json()),
  ]);
  state.air = air;
  state.traffic = traffic;
}

function airKey(station, year, month, pollutant) {
  return `${station}|${year}|${String(month).padStart(2, "0")}|${pollutant}`;
}

function getAirValue(station, year, month, pollutant) {
  const rec = state.air?.records?.[airKey(station, year, month, pollutant)];
  return rec ? rec.media : null;
}

// Mean across stations; returns null if no data.
function getMeanForStations(stations, year, month, pollutant) {
  const vals = stations.map(s => getAirValue(s, year, month, pollutant))
                       .filter(v => v !== null && v !== undefined);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// ---------- UI bootstrap ----------

function fillControls() {
  const monthSel = document.getElementById("monthSel");
  MONTHS_ES.forEach((m, i) => {
    const o = document.createElement("option");
    o.value = i + 1; o.textContent = m;
    monthSel.appendChild(o);
  });

  const yearSel = document.getElementById("yearSel");
  const years = new Set();
  Object.keys(state.air.records).forEach(k => years.add(parseInt(k.split("|")[1], 10)));
  const sortedYears = [...years].sort((a, b) => b - a);
  sortedYears.forEach(y => {
    const o = document.createElement("option");
    o.value = y; o.textContent = y;
    yearSel.appendChild(o);
  });

  // Default: most recent completed month with data
  const defaultYear = sortedYears[0];
  let defaultMonth = 1;
  for (let m = 12; m >= 1; m--) {
    if (getAirValue("NORTE", defaultYear, m, "NO2") !== null ||
        getAirValue("CONGRESOS", defaultYear, m, "NO2") !== null) {
      defaultMonth = m; break;
    }
  }
  monthSel.value = defaultMonth;
  yearSel.value = defaultYear;
}

// ---------- Report rendering ----------

function stationsForSelection() {
  const sel = document.getElementById("stationSel").value;
  if (sel === "ALL") return ["NORTE", "CONGRESOS"];
  return [sel];
}

function fmt(n, digits = 1) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n.toLocaleString("es-ES", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function deltaHtml(current, baseline) {
  if (current === null || baseline === null || baseline === 0) {
    return '<span class="delta flat">sin referencia</span>';
  }
  const pct = ((current - baseline) / baseline) * 100;
  const cls = pct > 1 ? "up" : pct < -1 ? "down" : "flat";
  const arrow = pct > 1 ? "▲" : pct < -1 ? "▼" : "▬";
  return `<span class="delta ${cls}">${arrow} ${fmt(Math.abs(pct), 1)}%</span>`;
}

function renderCover(year, month) {
  const el = document.getElementById("coverPeriod");
  el.textContent = `${MONTHS_ES[month - 1]} · ${year}`;
}

function renderDataMeta() {
  const air = state.air.meta;
  const tra = state.traffic.meta;
  const el = document.getElementById("dataMeta");
  el.textContent = `Última actualización: aire ${air.scraped_at.slice(0, 10)} · tráfico ${tra.scraped_at.slice(0, 10)}.`;
}

function renderKpis(year, month, stations) {
  const wrap = document.getElementById("kpis");
  wrap.innerHTML = "";

  Object.keys(POLLUTANTS).forEach(p => {
    const cfg = POLLUTANTS[p];
    const cur = getMeanForStations(stations, year, month, p);

    // Baseline: mean over previous WINDOW_YEARS years same month (exclude current)
    const baselineVals = [];
    for (let y = year - WINDOW_YEARS; y < year; y++) {
      const v = getMeanForStations(stations, y, month, p);
      if (v !== null) baselineVals.push(v);
    }
    const baseline = baselineVals.length
      ? baselineVals.reduce((a, b) => a + b, 0) / baselineVals.length
      : null;

    const limitFlag = cur !== null && cur > cfg.limit
      ? `<div class="footnote" style="color:var(--bad)">⚠ Supera el valor límite anual (${cfg.limit} ${cfg.unit}).</div>`
      : "";

    const card = document.createElement("div");
    card.className = "kpi";
    card.innerHTML = `
      <div class="label">${cfg.label}${cfg.proxy ? ` (proxy ${cfg.proxy})` : ""}</div>
      <div class="value">${fmt(cur, 1)} <span class="unit">${cfg.unit}</span></div>
      <div>${deltaHtml(cur, baseline)} <span class="footnote">vs media ${baselineVals.length} años</span></div>
      ${limitFlag}
    `;
    wrap.appendChild(card);
  });
}

function buildHistoricalSeries(month, pollutant, stations) {
  // Return sorted [{year, value}] for the given month across all available years.
  const years = new Set();
  Object.keys(state.air.records).forEach(k => {
    const [_, y, mm, po] = k.split("|");
    if (parseInt(mm, 10) === month && po === pollutant) years.add(parseInt(y, 10));
  });
  return [...years].sort((a, b) => a - b).map(y => ({
    year: y,
    value: getMeanForStations(stations, y, month, pollutant),
  }));
}

function drawPollutantChart(canvasId, pollutant, month, year, stations) {
  const cfg = POLLUTANTS[pollutant];
  const raw = buildHistoricalSeries(month, pollutant, stations);

  // Restrict to last WINDOW_YEARS + current
  const startYear = year - WINDOW_YEARS;
  const filtered = raw.filter(r => r.year >= startYear && r.year <= year);

  const labels = filtered.map(r => r.year);
  const values = filtered.map(r => r.value);
  const highlightIdx = filtered.findIndex(r => r.year === year);

  const bgColors = filtered.map((r, i) =>
    i === highlightIdx ? "rgba(166,25,46,0.85)" : "rgba(212,160,23,0.5)");
  const borderColors = filtered.map((r, i) =>
    i === highlightIdx ? "#7a0f20" : "#b8860b");

  const ctx = document.getElementById(canvasId);
  if (state.charts[canvasId]) state.charts[canvasId].destroy();
  state.charts[canvasId] = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: `${cfg.label} · ${MONTHS_ES[month - 1]}`,
        data: values,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 1.5,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: {
          label: (c) => `${fmt(c.parsed.y, 1)} ${cfg.unit}`,
        }},
        annotation: {},
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: cfg.unit } },
        x: { ticks: { maxRotation: 0 } },
      },
    },
    plugins: [{
      id: "limitLine",
      afterDraw: (chart) => {
        const { ctx, chartArea: ca, scales: { y } } = chart;
        if (!cfg.limit || !ca) return;
        const yPos = y.getPixelForValue(cfg.limit);
        if (yPos < ca.top || yPos > ca.bottom) return;
        ctx.save();
        ctx.beginPath();
        ctx.setLineDash([6, 4]);
        ctx.moveTo(ca.left, yPos);
        ctx.lineTo(ca.right, yPos);
        ctx.lineWidth = 1;
        ctx.strokeStyle = "#c62828";
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#c62828";
        ctx.font = "11px system-ui";
        ctx.textAlign = "right";
        ctx.fillText(`Límite ${cfg.limit}`, ca.right - 4, yPos - 4);
        ctx.restore();
      },
    }],
  });
}

function renderTable(year, month) {
  const tbody = document.querySelector("#detailTable tbody");
  tbody.innerHTML = "";
  const stations = ["NORTE", "CONGRESOS"];

  stations.forEach(st => {
    Object.keys(POLLUTANTS).forEach(p => {
      const cfg = POLLUTANTS[p];
      const cur = getAirValue(st, year, month, p);
      const baselineVals = [];
      for (let y = year - WINDOW_YEARS; y < year; y++) {
        const v = getAirValue(st, y, month, p);
        if (v !== null) baselineVals.push(v);
      }
      const baseline = baselineVals.length
        ? baselineVals.reduce((a, b) => a + b, 0) / baselineVals.length : null;
      const deltaPct = (cur !== null && baseline !== null && baseline !== 0)
        ? ((cur - baseline) / baseline) * 100 : null;
      const deltaCls = deltaPct === null ? "" : deltaPct > 1 ? "delta-up" : deltaPct < -1 ? "delta-down" : "";

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${STATION_LABELS[st]}</td>
        <td>${cfg.label}</td>
        <td class="num">${fmt(cur, 1)}</td>
        <td class="num">${fmt(baseline, 1)}</td>
        <td class="num ${deltaCls}">${deltaPct === null ? "—" : (deltaPct > 0 ? "+" : "") + fmt(deltaPct, 1) + "%"}</td>
        <td class="num">${cfg.limit} ${cfg.unit}</td>
      `;
      tbody.appendChild(tr);
    });
  });

  // Aggregated row per pollutant
  Object.keys(POLLUTANTS).forEach(p => {
    const cfg = POLLUTANTS[p];
    const cur = getMeanForStations(stations, year, month, p);
    const baselineVals = [];
    for (let y = year - WINDOW_YEARS; y < year; y++) {
      const v = getMeanForStations(stations, y, month, p);
      if (v !== null) baselineVals.push(v);
    }
    const baseline = baselineVals.length
      ? baselineVals.reduce((a, b) => a + b, 0) / baselineVals.length : null;
    const deltaPct = (cur !== null && baseline !== null && baseline !== 0)
      ? ((cur - baseline) / baseline) * 100 : null;

    const tr = document.createElement("tr");
    tr.className = "meta";
    tr.innerHTML = `
      <td>Media Granada</td>
      <td>${cfg.label}</td>
      <td class="num">${fmt(cur, 1)}</td>
      <td class="num">${fmt(baseline, 1)}</td>
      <td class="num">${deltaPct === null ? "—" : (deltaPct > 0 ? "+" : "") + fmt(deltaPct, 1) + "%"}</td>
      <td class="num">${cfg.limit} ${cfg.unit}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ---------- Traffic correlation ----------

function pearson(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const mx = pairs.reduce((a, p) => a + p.x, 0) / n;
  const my = pairs.reduce((a, p) => a + p.y, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (const p of pairs) {
    const dx = p.x - mx, dy = p.y - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  if (dx2 === 0 || dy2 === 0) return null;
  const r = num / Math.sqrt(dx2 * dy2);
  const slope = num / dx2;
  const intercept = my - slope * mx;
  return { r, slope, intercept, n, mx, my };
}

function correlationStrength(r) {
  const a = Math.abs(r);
  if (a >= 0.7) return { label: "fuerte", cls: "delta up" };
  if (a >= 0.4) return { label: "moderada", cls: "delta up" };
  if (a >= 0.2) return { label: "débil", cls: "delta flat" };
  return { label: "inexistente", cls: "delta flat" };
}

function buildCorrelationPairs(month, pollutant, stations, yearFrom, yearTo) {
  const monthKey = String(month).padStart(2, "0");
  const monthRow = state.traffic.monthly_imd[monthKey] || {};
  const pairs = [];
  for (let y = yearFrom; y <= yearTo; y++) {
    const pol = getMeanForStations(stations, y, month, pollutant);
    const imd = monthRow[y] ?? monthRow[String(y)];
    if (pol !== null && pol !== undefined && imd !== null && imd !== undefined) {
      pairs.push({ x: imd, y: pol, year: y });
    }
  }
  return pairs;
}

function drawScatter(canvasId, pollutant, month, stations, year) {
  const cfg = POLLUTANTS[pollutant];
  const pairs = buildCorrelationPairs(month, pollutant, stations, year - WINDOW_YEARS, year);
  const stats = pearson(pairs);

  // Split current-year point from the rest for distinct styling.
  const historical = pairs.filter(p => p.year !== year);
  const current = pairs.filter(p => p.year === year);

  const datasets = [{
    label: "Años anteriores",
    data: historical,
    backgroundColor: "rgba(90,90,90,0.55)",
    borderColor: "#333",
    pointRadius: 5,
    pointHoverRadius: 7,
  }];
  if (current.length) datasets.push({
    label: `${year}`,
    data: current,
    backgroundColor: "rgba(166,25,46,0.9)",
    borderColor: "#7a0f20",
    pointRadius: 7,
    pointHoverRadius: 9,
  });

  // Regression line
  if (stats && pairs.length >= 3) {
    const xs = pairs.map(p => p.x);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    datasets.push({
      type: "line",
      label: `Ajuste lineal (r=${stats.r.toFixed(2)})`,
      data: [
        { x: xMin, y: stats.slope * xMin + stats.intercept },
        { x: xMax, y: stats.slope * xMax + stats.intercept },
      ],
      borderColor: "rgba(212,160,23,0.9)",
      borderDash: [6, 4],
      borderWidth: 2,
      pointRadius: 0,
      fill: false,
      order: 0,
    });
  }

  const ctx = document.getElementById(canvasId);
  if (state.charts[canvasId]) state.charts[canvasId].destroy();
  state.charts[canvasId] = new Chart(ctx, {
    type: "scatter",
    data: { datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (c) => `${c.raw.year ?? ""}  ·  IMD ${fmt(c.parsed.x, 0)}  ·  ${cfg.label} ${fmt(c.parsed.y, 1)} ${cfg.unit}`,
          },
        },
      },
      scales: {
        x: { title: { display: true, text: "IMD (veh/día·carril)" } },
        y: { title: { display: true, text: `${cfg.label} (${cfg.unit})` }, beginAtZero: true },
      },
    },
  });

  return stats;
}

function renderCorrelation(year, month, stations) {
  document.getElementById("corrMonthLabel").textContent = MONTHS_ES[month - 1];

  const tbody = document.querySelector("#corrTable tbody");
  tbody.innerHTML = "";

  const pollutants = ["NO2", "PART", "PM25"];
  const canvasMap = { NO2: "scatterNO2", PART: "scatterPART", PM25: "scatterPM25" };

  pollutants.forEach(p => {
    const cfg = POLLUTANTS[p];
    const stats = drawScatter(canvasMap[p], p, month, stations, year);

    const tr = document.createElement("tr");
    if (!stats) {
      tr.innerHTML = `
        <td>${cfg.label}</td>
        <td class="num">—</td>
        <td class="num">—</td>
        <td>insuficientes datos</td>
        <td>—</td>
        <td class="num">—</td>`;
    } else {
      const strength = correlationStrength(stats.r);
      const sign = stats.r >= 0 ? "positiva" : "negativa";
      // Sensitivity: change in pollutant per +1000 IMD
      const sensitivity = stats.slope * 1000;
      const signS = sensitivity > 0 ? "+" : "";
      tr.innerHTML = `
        <td>${cfg.label}</td>
        <td class="num">${stats.r.toFixed(2)}</td>
        <td class="num">${(stats.r * stats.r).toFixed(2)}</td>
        <td>${strength.label} ${sign}</td>
        <td class="num">${signS}${fmt(sensitivity, 2)} ${cfg.unit} / +1000 veh</td>
        <td class="num">${stats.n}</td>`;
    }
    tbody.appendChild(tr);
  });
}

function renderSummary(year, month, stations) {
  const el = document.getElementById("summaryText");
  const lines = [];
  Object.keys(POLLUTANTS).forEach(p => {
    const cfg = POLLUTANTS[p];
    const cur = getMeanForStations(stations, year, month, p);
    if (cur === null) {
      lines.push(`<li><strong>${cfg.label}</strong>: sin datos publicados para ${MONTHS_ES[month - 1]} de ${year}.</li>`);
      return;
    }
    const baselineVals = [];
    for (let y = year - WINDOW_YEARS; y < year; y++) {
      const v = getMeanForStations(stations, y, month, p);
      if (v !== null) baselineVals.push(v);
    }
    const baseline = baselineVals.length
      ? baselineVals.reduce((a, b) => a + b, 0) / baselineVals.length : null;
    const pct = baseline ? ((cur - baseline) / baseline) * 100 : null;
    const overLimit = cur > cfg.limit;
    const dir = pct === null ? "" : (pct > 1 ? "por encima" : pct < -1 ? "por debajo" : "en línea");
    lines.push(`<li><strong>${cfg.label}</strong>: media mensual de ${fmt(cur, 1)} ${cfg.unit}${
      pct !== null ? `, ${dir} (${pct > 0 ? "+" : ""}${fmt(pct, 1)}%) de la media de los ${baselineVals.length} años anteriores` : ""
    }${overLimit ? ` <span style="color:var(--bad);font-weight:600">· supera el valor límite anual (${cfg.limit})</span>` : ""}.</li>`);
  });

  // Traffic level + correlation read
  const monthKey = String(month).padStart(2, "0");
  const monthRow = state.traffic.monthly_imd[monthKey] || {};
  const curTr = monthRow[year];
  const baselineTr = [];
  for (let y = year - WINDOW_YEARS; y < year; y++) {
    if (monthRow[y] !== undefined) baselineTr.push(monthRow[y]);
  }
  if (curTr !== undefined && baselineTr.length) {
    const avg = baselineTr.reduce((a, b) => a + b, 0) / baselineTr.length;
    const pct = ((curTr - avg) / avg) * 100;
    lines.push(`<li><strong>Tráfico (IMD)</strong>: ${fmt(curTr, 0)} veh/día·carril, ${pct > 0 ? "+" : ""}${fmt(pct, 1)}% vs media ${baselineTr.length} años anteriores.</li>`);
  }

  // Correlation — focus on NO2 (best traffic marker) plus partículas
  ["NO2", "PART", "PM25"].forEach(p => {
    const cfg = POLLUTANTS[p];
    const pairs = buildCorrelationPairs(month, p, stations, year - WINDOW_YEARS, year);
    const stats = pearson(pairs);
    if (!stats) return;
    const str = correlationStrength(stats.r);
    const sign = stats.r >= 0 ? "positiva" : "negativa";
    const sensitivity = stats.slope * 1000;
    const sS = sensitivity > 0 ? "+" : "";
    lines.push(`<li><strong>Tráfico ↔ ${cfg.label}</strong>: correlación ${str.label} ${sign} (r=${stats.r.toFixed(2)}, R²=${(stats.r * stats.r).toFixed(2)}). Cada +1000 veh/día·carril se asocia con ${sS}${fmt(sensitivity, 2)} ${cfg.unit} (n=${stats.n} años).</li>`);
  });

  el.innerHTML = `<ul>${lines.join("")}</ul>`;
}

// ---------- Orchestration ----------

function runReport() {
  const year = parseInt(document.getElementById("yearSel").value, 10);
  const month = parseInt(document.getElementById("monthSel").value, 10);
  const stations = stationsForSelection();

  renderCover(year, month);
  renderSummary(year, month, stations);
  renderKpis(year, month, stations);
  drawPollutantChart("chartNO2", "NO2", month, year, stations);
  drawPollutantChart("chartPART", "PART", month, year, stations);
  drawPollutantChart("chartPM25", "PM25", month, year, stations);
  renderTable(year, month);
  renderCorrelation(year, month, stations);
  renderDataMeta();
}

async function init() {
  try {
    await loadData();
  } catch (e) {
    document.getElementById("summaryText").textContent =
      "Error cargando datos. Asegúrese de que data/air.json y data/traffic.json existen.";
    console.error(e);
    return;
  }
  fillControls();
  document.getElementById("generateBtn").addEventListener("click", runReport);
  document.getElementById("printBtn").addEventListener("click", () => window.print());
  runReport();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
