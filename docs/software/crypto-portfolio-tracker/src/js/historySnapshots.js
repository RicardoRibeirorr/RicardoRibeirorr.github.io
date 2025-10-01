// historySnapshots.js - builds a multi-horizon snapshot table
// Horizons requested: current (baseline), 12h, 24h (yesterday), 4d, 7d, 14d, 21d, 30d, 60d, 90d
// For each symbol and portfolio total show: icon (direction), type (horizon label), portfolio total EUR at that horizon, per-coin price, and P/L vs current.

import { fetchMarketChart } from './api.js';
import { getPortfolio } from './portfolio.js';

// Helper: choose minimum days range needed to cover max horizon
const HORIZONS = [
  { key: 'current', label: 'Current', hours: 0 },
  { key: 'h12', label: '12h', hours: 12 },
  { key: 'h24', label: 'Yesterday', hours: 24 },
  { key: 'd4', label: '4d', hours: 24 * 4 },
  { key: 'd7', label: '1w', hours: 24 * 7 },
  { key: 'd14', label: '2w', hours: 24 * 14 },
  { key: 'd21', label: '3w', hours: 24 * 21 },
  { key: 'd30', label: '1m', hours: 24 * 30 },
  { key: 'd60', label: '2m', hours: 24 * 60 },
  { key: 'd90', label: '3m', hours: 24 * 90 },
];

function directionIcon(deltaPct) {
  if (deltaPct == null) return '·';
  if (Math.abs(deltaPct) < 0.01) return '·';
  return deltaPct > 0 ? '▲' : '▼';
}

function fmtEUR(v) { return v == null ? '—' : '€' + v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtPct(v) { return v == null ? '—' : (v >=0 ? '+' : '') + v.toFixed(2) + '%'; }

// We attempt to retrieve daily prices via market_chart for up to 90 days.
// For intra-day (12h) we approximate using the closest daily point (will be coarse) - limitation of using daily interval.
// (Could refine by calling with ?interval=hourly for small day windows, but we limit API usage.)

async function buildSnapshots() {
  const portfolio = getPortfolio();
  if (!portfolio.length) return null;
  const maxHours = Math.max(...HORIZONS.map(h => h.hours));
  const maxDays = Math.ceil(maxHours / 24); // 0 -> 0 => we'll still request 1 day minimum below
  const daysToFetch = Math.max(1, maxDays + 1); // buffer
  const perSymbolSeries = new Map();
  for (const { symbol } of portfolio) {
    try {
      const prices = await fetchMarketChart(symbol, daysToFetch); // [ [ts, price], ... ] timestamps ms
      perSymbolSeries.set(symbol, prices);
    } catch (e) {
      console.warn('History snapshot fetch failed for', symbol, e);
    }
  }
  if (!perSymbolSeries.size) return null;
  const nowTs = Date.now();
  function priceAt(symbol, hoursAgo) {
    if (hoursAgo === 0) {
      // approximate current: latest point in series
      const series = perSymbolSeries.get(symbol);
      if (!series || !series.length) return null;
      return series[series.length -1][1];
    }
    const targetTs = nowTs - hoursAgo * 3600000;
    const series = perSymbolSeries.get(symbol) || [];
    // Find closest point at or before target (linear scan backwards acceptable for short arrays)
    for (let i = series.length -1; i >=0; i--) {
      const [ts, price] = series[i];
      if (ts <= targetTs) return price;
    }
    // fallback earliest
    return series.length ? series[0][1] : null;
  }
  // Build rows per horizon
  const currentPrices = new Map();
  for (const { symbol } of portfolio) currentPrices.set(symbol, priceAt(symbol, 0));
  const rows = [];
  for (const h of HORIZONS) {
    const prices = {};
    let portfolioTotal = 0;
    for (const { symbol, quantity } of portfolio) {
      const p = priceAt(symbol, h.hours);
      prices[symbol] = p;
      if (p != null) portfolioTotal += p * quantity;
    }
    // compute delta vs current
    let deltaPct = null;
    let deltaEUR = null;
    if (h.key !== 'current') {
      let currentTotal = 0; let have = false;
      for (const { symbol, quantity } of portfolio) {
        const cp = currentPrices.get(symbol);
        if (cp == null) continue; have = true; currentTotal += cp * quantity;
      }
      if (have && currentTotal) {
        deltaEUR = portfolioTotal ? (currentTotal - portfolioTotal) : 0;
        deltaPct = portfolioTotal ? (currentTotal / portfolioTotal - 1) * 100 : null;
      }
    }
    rows.push({ horizon: h, portfolioTotal: portfolioTotal || 0, prices, deltaPct, deltaEUR });
  }
  return { rows, currentPrices };
}

function renderSnapshotTable(data) {
  const wrap = document.getElementById('historyTableWrapper');
  if (!wrap) return;
  if (!data) { wrap.innerHTML = '<div class="py-4 text-gray-500">No data</div>'; return; }
  const portfolio = getPortfolio();
  const symbols = portfolio.map(p => p.symbol);
  const header = `<thead><tr>
    <th class="px-2 py-1 text-left">Dir</th>
    <th class="px-2 py-1 text-left">Type</th>
    <th class="px-2 py-1 text-right">Portfolio €</th>
    ${symbols.map(s => `<th class='px-2 py-1 text-right'>${s}</th>`).join('')}
    <th class="px-2 py-1 text-right">Δ €</th>
    <th class="px-2 py-1 text-right">Δ %</th>
  </tr></thead>`;
  const bodyRows = data.rows.map(r => {
    const cls = r.deltaPct == null ? '' : (r.deltaPct > 0 ? 'text-bull' : (r.deltaPct < 0 ? 'text-bear' : ''));
    return `<tr>
      <td class="px-2 py-1">${directionIcon(r.deltaPct)}</td>
      <td class="px-2 py-1">${r.horizon.label}</td>
      <td class="px-2 py-1 text-right">${fmtEUR(r.portfolioTotal)}</td>
      ${symbols.map(s => `<td class='px-2 py-1 text-right'>${r.prices[s] != null ? r.prices[s].toFixed(4) : '—'}</td>`).join('')}
      <td class="px-2 py-1 text-right ${cls}">${r.deltaEUR != null ? (r.deltaEUR >=0?'+':'') + '€' + r.deltaEUR.toFixed(2) : '—'}</td>
      <td class="px-2 py-1 text-right ${cls}">${fmtPct(r.deltaPct)}</td>
    </tr>`;
  }).join('');
  wrap.innerHTML = `<table class="min-w-full border-separate border-spacing-y-0.5 text-[11px]">
    ${header}
    <tbody>${bodyRows}</tbody>
  </table>`;
}

let building = false;
export async function refreshHistorySnapshots() {
  if (building) return; // avoid re-entry
  building = true;
  try {
    const wrap = document.getElementById('historyTableWrapper');
    if (wrap) wrap.innerHTML = '<div class="py-4 text-gray-500">Building…</div>';
    const data = await buildSnapshots();
    renderSnapshotTable(data);
  } catch (e) {
    console.warn('History snapshot build failed', e);
    const wrap = document.getElementById('historyTableWrapper');
    if (wrap) wrap.innerHTML = '<div class="py-4 text-red-600">Failed to build snapshots</div>';
  } finally {
    building = false;
  }
}

export function initHistorySnapshots() {
  refreshHistorySnapshots();
}
