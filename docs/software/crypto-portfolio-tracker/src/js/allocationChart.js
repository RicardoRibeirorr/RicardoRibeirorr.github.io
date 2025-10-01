// allocationChart.js - horizontal bar chart for allocation & unrealized P/L
// Assumptions: actions array has price snapshots. Current prices already fetched in UI refresh pipeline.
import { getPortfolio } from './portfolio.js';
import { fetchCurrentPrices } from './api.js';

let allocationChart = null;

function computeCostBasis(entry) {
  // Sum buy lots - remove proportional sold quantity FIFO to leave remaining cost basis
  const buys = [];
  for (const a of entry.actions || []) {
    if (a.type === 'buy') buys.push({ qty: a.quantity, price: a.price });
    else if (a.type === 'sell') {
      let remaining = a.quantity;
      while (remaining > 0 && buys.length) {
        const lot = buys[0];
        const use = Math.min(lot.qty, remaining);
        lot.qty -= use; remaining -= use;
        if (lot.qty === 0) buys.shift();
      }
    }
  }
  // Remaining buys represent open position cost
  let cost = 0; let remainingQty = 0;
  for (const lot of buys) {
    if (lot.price != null) {
      cost += lot.qty * lot.price;
      remainingQty += lot.qty;
    }
  }
  return { cost, remainingQty };
}

async function buildData() {
  const portfolio = getPortfolio().filter(p => p.quantity > 0);
  if (!portfolio.length) return { labels: [], datasets: [] };
  // Ensure current prices snapshot
  const symbols = portfolio.map(p => p.symbol);
  let currPrices = {};
  try { currPrices = await fetchCurrentPrices(symbols); } catch (_) {}
  const rows = [];
  for (const p of portfolio) {
    const { cost, remainingQty } = computeCostBasis(p);
    const currentPrice = currPrices[p.symbol] ?? null;
    const currentValue = currentPrice != null ? currentPrice * p.quantity : null;
    const unrealized = (currentValue != null && cost > 0) ? currentValue - cost : 0;
    rows.push({ symbol: p.symbol, cost, currentValue, unrealized });
  }
  const totalCost = rows.reduce((s,r)=>s + (r.cost||0), 0) || 1;
  // Prepare chart data: We'll use stacked horizontal bars: dataset 1 cost basis (neutral), dataset 2 gain (positive only), dataset 3 loss (negative only)
  const labels = rows.map(r => r.symbol);
  const costBasis = rows.map(r => Number(r.cost.toFixed(2)));
  const gains = rows.map(r => r.unrealized > 0 ? Number(r.unrealized.toFixed(2)) : 0);
  const losses = rows.map(r => r.unrealized < 0 ? Number(Math.abs(r.unrealized).toFixed(2)) : 0);
  return { labels, costBasis, gains, losses, rows, totalCost };
}

function fmt(v) { return '€' + v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }

export async function renderAllocationChart() {
  const ctx = document.getElementById('allocationChart');
  if (!ctx) return;
  const { labels, costBasis, gains, losses, rows, totalCost } = await buildData();
  if (!labels.length) {
    if (allocationChart) { allocationChart.destroy(); allocationChart = null; }
    return;
  }
  const data = {
    labels,
    datasets: [
      { label: 'Cost Basis', data: costBasis, backgroundColor: '#9ca3af', borderWidth: 0, stack: 'stack1', barPercentage: 0.7, categoryPercentage: 0.9 },
      { label: 'Unrealized Gain', data: gains, backgroundColor: '#16a34a', borderWidth: 0, stack: 'stack1', barPercentage: 0.7, categoryPercentage: 0.9 },
      { label: 'Unrealized Loss', data: losses, backgroundColor: '#dc2626', borderWidth: 0, stack: 'stack1', barPercentage: 0.7, categoryPercentage: 0.9 },
    ]
  };
  const options = {
    indexAxis: 'y',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: true, labels: { boxWidth: 12 } },
      tooltip: {
        mode: 'index',
        intersect: false,
        callbacks: {
          label: (ctx) => {
            const dsLabel = ctx.dataset.label;
            return `${dsLabel}: ${fmt(ctx.parsed.x)}`;
          },
          afterBody: (items) => {
            if (!items.length) return '';
            const idx = items[0].dataIndex;
            const r = rows[idx];
            const allocPct = r.cost ? (r.cost / totalCost * 100) : 0;
            const unrealPct = r.cost ? (r.unrealized / r.cost * 100) : 0;
            return [`Allocation: ${allocPct.toFixed(1)}%`, `Unrealized: ${(r.unrealized>=0?'+':'')+unrealPct.toFixed(1)}%`];
          }
        }
      }
    },
    scales: {
      x: {
        stacked: true,
        ticks: {
          callback: (v) => '€' + Number(v).toLocaleString(),
        },
        grid: { color: 'rgba(0,0,0,0.05)' }
      },
      y: {
        stacked: true,
        grid: { display: false }
      }
    },
    animation: { duration: 400 }
  };
  if (allocationChart) {
    allocationChart.data = data;
    allocationChart.options = options;
    allocationChart.update();
  } else {
    allocationChart = new Chart(ctx.getContext('2d'), { type: 'bar', data, options });
  }
}

export function refreshAllocationChart() { renderAllocationChart(); }
