// allocationChart.js - horizontal bar chart for allocation & unrealized P/L
// Now purely derives from already-fetched UI row data & action history (no new API calls)
import { getPortfolio } from './portfolio.js';

let allocationChart = null;

export function computeCostBasis(entry) {
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

function buildData(latestRows) {
  const portfolio = getPortfolio().filter(p => p.quantity > 0);
  if (!portfolio.length) return { labels: [], costBasis: [], gains: [], losses: [], rows: [], totalCost: 1 };
  const rowMap = new Map();
  if (Array.isArray(latestRows)) for (const r of latestRows) rowMap.set(r.symbol.toUpperCase(), r);
  const rows = [];
  for (const p of portfolio) {
    const { cost } = computeCostBasis(p);
    const currentPrice = rowMap.get(p.symbol)?.currentPrice ?? null;
    const currentValue = currentPrice != null ? currentPrice * p.quantity : null;
    const unrealized = (currentValue != null && cost > 0) ? currentValue - cost : 0;
    const realized = (p.actions || []).filter(a => a.realizedProfit != null).reduce((s,a)=> s + a.realizedProfit, 0);
    rows.push({ symbol: p.symbol, cost, unrealized, realized, currentValue });
  }
  // Order by largest cost allocation first
  rows.sort((a,b) => (b.cost||0) - (a.cost||0));
  const totalCost = rows.reduce((s,r)=> s + (r.cost||0), 0) || 1;
  const labels = rows.map(r => r.symbol);
  const costBasis = rows.map(r => Number((r.cost||0).toFixed(2)));
  const gains = rows.map(r => r.unrealized > 0 ? Number(r.unrealized.toFixed(2)) : 0);
  const losses = rows.map(r => r.unrealized < 0 ? Number(Math.abs(r.unrealized).toFixed(2)) : 0);
  return { labels, costBasis, gains, losses, rows, totalCost };
}

function fmt(v) { return '€' + v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }

export async function renderAllocationChart(latestRows) {
  const ctx = document.getElementById('allocationChart');
  if (!ctx) return;
  const { labels, costBasis, gains, losses, rows, totalCost } = buildData(latestRows);
  if (!labels.length) {
    if (allocationChart) { allocationChart.destroy(); allocationChart = null; }
    return;
  }
  const data = { labels, datasets: [
    { label: 'Cost Basis', data: costBasis, backgroundColor: '#9ca3af', borderWidth: 0, stack: 'stack', barPercentage: 0.7, categoryPercentage: 0.9 },
    { label: 'Unrealized Gain', data: gains, backgroundColor: '#16a34a', borderWidth: 0, stack: 'stack', barPercentage: 0.7, categoryPercentage: 0.9 },
    { label: 'Unrealized Loss', data: losses, backgroundColor: '#dc2626', borderWidth: 0, stack: 'stack', barPercentage: 0.7, categoryPercentage: 0.9 },
  ]};
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
          label: (ctx) => `${ctx.dataset.label}: ${fmt(ctx.parsed.x)}`,
          afterBody: (items) => {
            if (!items.length) return '';
            const i = items[0].dataIndex;
            const r = rows[i];
            const allocPct = r.cost ? (r.cost / totalCost * 100) : 0;
            const unreal = r.unrealized || 0;
            const realized = r.realized || 0;
            const unrealPct = r.cost ? (unreal / r.cost * 100) : 0;
            return [
              `Realized P/L: ${(realized>=0?'+':'')+fmt(Math.abs(realized))}`.replace('€','€'),
              `Unrealized P/L: ${(unreal>=0?'+':'')+fmt(Math.abs(unreal))} (${unrealPct.toFixed(1)}%)`,
              `Allocation: ${allocPct.toFixed(1)}% of cost`
            ];
          }
        }
      }
    },
    scales: {
      x: {
        stacked: true,
        ticks: { callback: (v) => '€' + Number(v).toLocaleString() },
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
    allocationChart.data.labels = labels;
    allocationChart.data.datasets = data.datasets;
    allocationChart.update();
  } else {
    allocationChart = new Chart(ctx.getContext('2d'), { type: 'bar', data, options });
  }
}

export function refreshAllocationChart(latestRows) { renderAllocationChart(latestRows); }
