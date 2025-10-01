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
      <div class="px-3 py-1 text-xs font-medium tracking-wide text-gray-500 dark:text-gray-400 flex items-center justify-between">
        <span>${symbol} price (EUR) – last period</span>
        <span data-role="mini-chart-status" class="text-indigo-500">loading…</span>
      </div>
      <div class="h-24 relative">
        <canvas id="miniChart-${symbol}" height="96" aria-label="${symbol} mini chart"></canvas>
      </div>
    </div>`;
  tr.appendChild(td);
  dataRow.parentNode.insertBefore(tr, dataRow.nextSibling);
  return td.querySelector('canvas');
}

function buildDataset(prices) {
  if (!prices || !prices.length) return { labels: [], data: [] };
  const labels = prices.map(p => new Date(p[0]).toISOString().slice(5, 10)); // MM-DD
  const data = prices.map(p => Number(p[1].toFixed(4)));
  return { labels, data };
}

async function renderMiniChart(symbol, days) {
  const canvas = ensureChartRow(symbol);
  if (!canvas) return;
  const statusEl = canvas.closest('td').querySelector('[data-role="mini-chart-status"]');
  try {
    const prices = await fetchMarketChart(symbol, days);
    const { labels, data } = buildDataset(prices);
    if (!labels.length) {
      if (statusEl) statusEl.textContent = 'no data';
      return;
    }
    const first = data[0];
    const last = data[data.length - 1];
    const up = last >= first;
    if (statusEl) statusEl.textContent = `${up ? '▲' : '▼'} ${( (last-first)/first*100 ).toFixed(2)}%`; 
    if (miniChartInstances.has(symbol)) {
      const chart = miniChartInstances.get(symbol);
      chart.data.labels = labels;
      chart.data.datasets[0].data = data;
      chart.data.datasets[0].borderColor = up ? '#16a34a' : '#dc2626';
      chart.data.datasets[0].backgroundColor = up ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.15)';
      chart.update();
      return;
    }
    const ctx = canvas.getContext('2d');
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: `${symbol} (EUR)`,
          data,
          borderWidth: 1.5,
          borderColor: up ? '#16a34a' : '#dc2626',
          backgroundColor: up ? 'rgba(22,163,74,0.15)' : 'rgba(220,38,38,0.15)',
          tension: 0.25,
          fill: true,
          pointRadius: 0,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `€${c.parsed.y}` } } },
        scales: { x: { display: false }, y: { display: false } },
      }
    });
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
