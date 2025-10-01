// analytics.js - composite performance chart (portfolio + per-symbol)
import { fetchPerformanceSeries } from './api.js';
import { getPortfolio } from './portfolio.js';

let perfChart = null;

function buildDatasetConfig(series) {
  // Assign distinct colors; first (portfolio) gets thicker stroke
  const basePalette = [
    '#6366f1','#16a34a','#dc2626','#f59e0b','#0891b2','#7c3aed','#db2777','#0d9488','#f472b6','#2563eb'
  ];
  return series.datasets.map((ds, idx) => {
    const color = basePalette[idx % basePalette.length];
    return {
      label: ds.label,
      data: ds.values,
      borderColor: color,
      backgroundColor: color + '22',
      borderWidth: ds.label === 'PORTFOLIO' ? 2 : 1.25,
      tension: 0.25,
      spanGaps: true,
      pointRadius: 0,
      fill: false,
    };
  });
}

function movingAverage(arr, window) {
  if (!window || window < 2) return arr;
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] == null) { out.push(null); continue; }
    let sum = 0; let cnt = 0;
    for (let j = i - window + 1; j <= i; j++) {
      if (j < 0) continue;
      const v = arr[j];
      if (v == null) continue;
      sum += v; cnt++;
    }
    out.push(cnt ? Number((sum / cnt).toFixed(4)) : null);
  }
  return out;
}

async function renderPerformanceChart(baseDateOverride = 'auto', smoothing = 0) {
  const portfolio = getPortfolio();
  if (!portfolio.length) {
    if (perfChart) { perfChart.data.labels = []; perfChart.data.datasets = []; perfChart.update(); }
    return;
  }
  // Determine earliest acquisition/current earliest date as default comparison
  let comparisonDate = baseDateOverride && baseDateOverride !== 'auto' ? baseDateOverride : null;
  if (!comparisonDate) {
    // auto: choose earliest acquisitionDate among holdings or 30d ago fallback
    const dates = portfolio.map(p => p.acquisitionDate).filter(Boolean).sort();
    comparisonDate = dates[0] || new Date(Date.now() - 30 * 86400000).toISOString().slice(0,10);
  }
  const series = await fetchPerformanceSeries(portfolio, comparisonDate);
  if (!series.labels.length) return;
  // Apply smoothing if requested
  const win = Number(smoothing) || 0;
  if (win > 1) {
    for (const ds of series.datasets) {
      ds.values = movingAverage(ds.values, win);
    }
  }
  const datasetConfigs = buildDatasetConfig(series);
  const ctx = document.getElementById('performanceChart').getContext('2d');
  if (!perfChart) {
    perfChart = new Chart(ctx, {
      type: 'line',
      data: { labels: series.labels, datasets: datasetConfigs },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y != null ? (c.parsed.y >=0?'+':'') + c.parsed.y.toFixed(2) + '%':''}` } }
        },
        scales: {
          x: { ticks: { maxRotation: 0, autoSkip: true } },
          y: { title: { display: true, text: '% Change' } }
        }
      }
    });
  } else {
    perfChart.data.labels = series.labels;
    perfChart.data.datasets = datasetConfigs;
    perfChart.update();
  }
  populateBaseDateSelector(series.labels, comparisonDate);
}

function populateBaseDateSelector(labels, current) {
  const sel = document.getElementById('analyticsBaseDate');
  if (!sel) return;
  const existing = new Set(['auto']);
  [...sel.options].forEach(o => existing.add(o.value));
  // Keep only first (auto) then repopulate dates limited to maybe every 7th to avoid clutter
  sel.innerHTML = '<option value="auto">Auto Base</option>' + labels.filter((_,i)=> i % 7 === 0 || i === labels.length -1).map(d => `<option value="${d}" ${d===current?'selected':''}>${d}</option>`).join('');
  if (current && current !== 'auto' && !labels.includes(current)) {
    const opt = document.createElement('option'); opt.value = current; opt.textContent = current; opt.selected = true; sel.appendChild(opt);
  }
}

function hookAnalyticsControls() {
  const baseSel = document.getElementById('analyticsBaseDate');
  const smoothSel = document.getElementById('analyticsSmoothing');
  const metricSel = document.getElementById('analyticsMetric');
  if (baseSel) baseSel.addEventListener('change', () => renderPerformanceChart(baseSel.value, smoothSel?.value || 0));
  if (smoothSel) smoothSel.addEventListener('change', () => renderPerformanceChart(baseSel?.value || 'auto', smoothSel.value));
  if (metricSel) metricSel.addEventListener('change', () => renderPerformanceChart(baseSel?.value || 'auto', smoothSel?.value || 0));
}

export function initAnalytics() {
  hookAnalyticsControls();
  renderPerformanceChart();
}

export function refreshAnalytics() {
  const baseSel = document.getElementById('analyticsBaseDate');
  const smoothSel = document.getElementById('analyticsSmoothing');
  renderPerformanceChart(baseSel?.value || 'auto', smoothSel?.value || 0);
}
