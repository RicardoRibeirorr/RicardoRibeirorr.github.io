// historySnapshots.js - builds a multi-horizon snapshot table
// Updated: user-specified sequence:
//   current, 2h,4h,6h,8h,10h,12h,...,24h, Yesterday, 1d,2d,3d,4d, 1w,2w,3w, 1m,2m,3m,6m
// Note: Some labels (24h, Yesterday, 1d) overlap in time (all ~24h). They are kept as requested; values will likely be identical.
// For each symbol and portfolio total show: direction, label, portfolio total EUR, per-coin price, and P/L vs current.

import { fetchMarketChart } from './api.js';
import { getPortfolio } from './portfolio.js';

// Dynamic horizons builder (hourly horizons removed – hourly API not available).
// Kept overlapping 24h / Yesterday / 1d labels as previously requested; remove if desired later.
function buildHorizons() {
  const list = [];
  list.push({ key: 'current', label: 'Current', hours: 0 });
  list.push({ key: 'h24', label: '24h', hours: 24 });
  list.push({ key: 'yesterday', label: 'Yesterday', hours: 24 });
  for (let d = 1; d <= 4; d++) list.push({ key: `d${d}`, label: `${d}d`, hours: 24 * d });
  list.push({ key: 'w1', label: '1w', hours: 24 * 7 });
  list.push({ key: 'w2', label: '2w', hours: 24 * 14 });
  list.push({ key: 'w3', label: '3w', hours: 24 * 21 });
  list.push({ key: 'm1', label: '1m', hours: 24 * 30 });
  list.push({ key: 'm2', label: '2m', hours: 24 * 60 });
  list.push({ key: 'm3', label: '3m', hours: 24 * 90 });
  list.push({ key: 'm6', label: '6m', hours: 24 * 180 });
  return list;
}

function directionIcon(deltaPct) {
  if (deltaPct == null) return '·';
  if (Math.abs(deltaPct) < 0.01) return '·';
  return deltaPct > 0 ? '▲' : '▼';
}

function fmtEUR(v) { return v == null ? '—' : '€' + v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtPct(v) { return v == null ? '—' : (v >=0 ? '+' : '') + v.toFixed(2) + '%'; }
function fmtPrice(v) {
  if (v == null || !isFinite(v)) return '—';
  const abs = Math.abs(v);
  const opts = abs >= 1 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { minimumFractionDigits: 2, maximumFractionDigits: 8 };
  let out = v.toLocaleString(undefined, opts);
  if (abs < 1) {
    // Trim redundant trailing zeros after decimal, but keep at least 2 decimals
    out = out.replace(/(\.\d*?[1-9])0+$/,'$1');
    // Ensure at least two decimals
    if (/\.\d$/.test(out)) out += '0';
  }
  return out;
}

// We now fetch only daily market_chart data; intra-day horizons removed due to hourly endpoint limitations.

async function buildSnapshots() {
  const portfolio = getPortfolio();
  if (!portfolio.length) return null;
  const nowTs = Date.now();
  const horizons = buildHorizons();
  const needMaxHours = Math.max(...horizons.map(h => h.hours));
  const needDays = Math.ceil(needMaxHours / 24);
  // Ensure we fetch enough daily history (needDays plus small buffer)
  const dailyDaysToFetch = Math.max(needDays + 1, 7);
  const dailySeries = new Map();
  // Fetch daily (coarse) once per symbol
  for (const { symbol } of portfolio) {
    try {
      const prices = await fetchMarketChart(symbol, dailyDaysToFetch); // daily points
      dailySeries.set(symbol, prices);
    } catch (e) { console.warn('Daily series failed', symbol, e); }
  }
  function priceAt(symbol, hoursAgo) {
    const targetTs = nowTs - hoursAgo * 3600000;
    const dSer = dailySeries.get(symbol) || [];
    for (let i = dSer.length -1; i >=0; i--) { const [ts, price] = dSer[i]; if (ts <= targetTs) return price; }
    return dSer.length ? dSer[0][1] : null;
  }
  // Current prices (h=0) computed from the freshest hourly if present else daily latest
  const currentPrices = new Map();
  for (const { symbol } of portfolio) {
    currentPrices.set(symbol, priceAt(symbol, 0));
  }
  const rows = [];
  for (const h of horizons) {
    const prices = {};
    let portfolioTotal = 0;
    for (const { symbol, quantity } of portfolio) {
      const p = priceAt(symbol, h.hours);
      prices[symbol] = p;
      if (p != null) portfolioTotal += p * quantity;
    }
    let deltaPct = null; let deltaEUR = null;
    if (h.hours !== 0) {
      let currTotal = 0; let have = false;
      for (const { symbol, quantity } of portfolio) {
        const cp = currentPrices.get(symbol); if (cp == null) continue; have = true; currTotal += cp * quantity;
      }
      if (have && portfolioTotal) {
        deltaEUR = currTotal - portfolioTotal;
        deltaPct = (currTotal / portfolioTotal - 1) * 100;
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
  ${symbols.map(s => `<td class='px-2 py-1 text-right'>${r.prices[s] != null ? fmtPrice(r.prices[s]) : '—'}</td>`).join('')}
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
