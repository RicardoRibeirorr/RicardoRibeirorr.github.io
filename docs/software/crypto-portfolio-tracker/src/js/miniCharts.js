// miniCharts.js - small per-coin sparkline charts

import { fetchMarketChart } from './api.js';
import { showToast } from './toast.js';

const miniChartInstances = new Map(); // symbol -> Chart

function ensureChartRow(symbol) {
  const tableBody = document.getElementById('portfolioTableBody');
  if (!tableBody) return null;
  const dataRow = tableBody.querySelector(`tr[data-symbol="${symbol}"]`);
  if (!dataRow) return null;
  // If next sibling already chart row, reuse
  let next = dataRow.nextElementSibling;
  if (next && next.dataset && next.dataset.chartRow === symbol) {
    return next.querySelector('canvas');
  }
  // Insert new row
  const tr = document.createElement('tr');
  tr.dataset.chartRow = symbol;
  const td = document.createElement('td');
  td.colSpan = 8; // number of columns in main table
  td.className = 'px-4 pb-4 pt-0';
  td.innerHTML = `
    <div class="mt-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      <div class="px-3 py-1 text-[11px] font-medium tracking-wide text-gray-600 dark:text-gray-300 flex items-center justify-between">
        <span>${symbol} (EUR) – last period</span>
        <span data-role="mini-chart-status" class="text-indigo-500">loading…</span>
      </div>
      <div class="px-3 pb-1 text-[10px] flex flex-wrap gap-x-4 gap-y-0.5 text-gray-500 dark:text-gray-400" data-role="mini-chart-stats"></div>
      <div class="h-24 relative">
        <canvas id="miniChart-${symbol}" height="96" aria-label="${symbol} mini chart"></canvas>
      </div>
    </div>`;
  tr.appendChild(td);
  dataRow.parentNode.insertBefore(tr, dataRow.nextSibling);
  return td.querySelector('canvas');
}

function buildDataset(prices) {
  if (!prices || !prices.length) return { labels: [], data: [], dates: [] };
  const labels = prices.map(p => new Date(p[0]).toISOString().slice(5, 10)); // MM-DD
  const data = prices.map(p => Number(p[1].toFixed(6)));
  const dates = prices.map(p => new Date(p[0]).toISOString().slice(0,10));
  return { labels, data, dates };
}

// Simple crosshair plugin for mini charts
const miniCrosshairPlugin = {
  id: 'miniCrosshair',
  afterDraw(chart) {
    const active = chart._active && chart._active[0];
    if (!active) return;
    const ctx = chart.ctx;
    const x = active.element.x;
    ctx.save();
    ctx.strokeStyle = 'rgba(99,102,241,0.5)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3,3]);
    ctx.beginPath();
    ctx.moveTo(x, chart.chartArea.top);
    ctx.lineTo(x, chart.chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  }
};

async function renderMiniChart(symbol, days) {
  const canvas = ensureChartRow(symbol);
  if (!canvas) return;
  const statusEl = canvas.closest('td').querySelector('[data-role="mini-chart-status"]');
  try {
    const prices = await fetchMarketChart(symbol, days);
    const { labels, data, dates } = buildDataset(prices);
    if (!labels.length) {
      if (statusEl) statusEl.textContent = 'no data';
      return;
    }
    const first = data[0];
    const last = data[data.length - 1];
    const up = last >= first;
    const pct = ((last - first) / first * 100);
    if (statusEl) statusEl.textContent = `${up ? '▲' : '▼'} ${pct.toFixed(2)}%`;
    // Stats line
    const statsEl = statusEl?.closest('div')?.parentElement?.querySelector('[data-role="mini-chart-stats"]');
    if (statsEl) {
      const min = Math.min(...data);
      const max = Math.max(...data);
      statsEl.innerHTML = `Start €${first.toFixed(4)} · End €${last.toFixed(4)} · Min €${min.toFixed(4)} · Max €${max.toFixed(4)}`;
    }
    if (miniChartInstances.has(symbol)) {
      const chart = miniChartInstances.get(symbol);
      chart.data.labels = labels;
      chart.data.datasets[0].data = data;
      chart.data.datasets[0].borderColor = up ? '#16a34a' : '#dc2626';
      chart.data.datasets[0].backgroundColor = up ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.15)';
      chart.config._dates = dates;
      chart.update();
      return;
    }
    const ctx = canvas.getContext('2d');
    // gradient background
    const gradient = ctx.createLinearGradient(0,0,0,110);
    gradient.addColorStop(0, up ? 'rgba(22,163,74,0.35)' : 'rgba(220,38,38,0.35)');
    gradient.addColorStop(1, up ? 'rgba(22,163,74,0.02)' : 'rgba(220,38,38,0.02)');
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: `${symbol} (EUR)`,
          data,
          borderWidth: 1.5,
          borderColor: up ? '#16a34a' : '#dc2626',
          backgroundColor: gradient,
          tension: 0.25,
          fill: true,
          pointRadius: 0,
          pointHoverRadius: 3,
          pointHitRadius: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { 
          legend: { display: false },
          tooltip: { 
            mode: 'index',
            intersect: false,
            callbacks: {
              label: (c) => {
                const arr = c.chart.config._dates || [];
                const iso = arr[c.dataIndex] || '';
                const base = `€${c.parsed.y}`;
                if (c.dataIndex === 0) return `${iso}  ${base}`;
                const firstVal = c.dataset.data[0];
                const diff = c.parsed.y - firstVal;
                const pct2 = firstVal ? (diff / firstVal * 100) : 0;
                const sign = diff >= 0 ? '+' : '';
                return `${iso}  ${base}  (${sign}€${diff.toFixed(4)}, ${sign}${pct2.toFixed(2)}%)`;
              }
            }
          }
        },
        scales: { x: { display: false }, y: { display: false } },
        interaction: { mode: 'index', intersect: false },
      },
      plugins: [miniCrosshairPlugin]
    });
    chart.config._dates = dates;
    miniChartInstances.set(symbol, chart);
  } catch (e) {
    if (statusEl) statusEl.textContent = e.status === 429 ? 'rate limited' : 'error';
    const msg = e.status === 429
      ? `Too many API calls for ${symbol} mini chart. Wait a few minutes then use Reload All or Force Reload.`
      : `Mini chart failed for ${symbol}`;
    showToast(msg, 'error');
    console.warn('Mini chart failed for', symbol, e);
  }
}

async function renderMiniChartsForPortfolio(portfolio, comparisonDate) {
  if (!portfolio.length) return;
  const startDate = new Date(comparisonDate + 'T00:00:00Z');
  const daysDiff = Math.max(1, Math.ceil((Date.now() - startDate.getTime()) / 86400000));
  for (let i = 0; i < portfolio.length; i++) {
    const { symbol } = portfolio[i];
    await renderMiniChart(symbol, daysDiff);
  }
}

function clearMiniCharts() {
  // Remove chart rows from DOM & destroy instances
  miniChartInstances.forEach(ch => ch.destroy());
  miniChartInstances.clear();
  const tableBody = document.getElementById('portfolioTableBody');
  if (!tableBody) return;
  [...tableBody.querySelectorAll('tr[data-chart-row]')].forEach(r => r.remove());
}

export { renderMiniChartsForPortfolio, clearMiniCharts, renderMiniChart };
