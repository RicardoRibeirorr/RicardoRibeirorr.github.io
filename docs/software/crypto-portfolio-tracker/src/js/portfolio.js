// portfolio.js - portfolio manipulation logic

import { loadPortfolio, savePortfolio } from './storage.js';
import { fetchCurrentPrices, fetchHistoricalPrice } from './api.js';

let state = loadPortfolio();

// Migration: ensure each entry has an actions array (schema upgrade to actions-based model)
for (const entry of state) {
  if (!entry.actions) {
    const qty = Number(entry.quantity) || 0;
    const price = entry.addedPrice != null ? Number(entry.addedPrice) : null;
    const date = (entry.acquisitionDate && /^\d{4}-\d{2}-\d{2}$/.test(entry.acquisitionDate))
      ? entry.acquisitionDate
      : (entry.addedAt ? entry.addedAt.slice(0,10) : new Date().toISOString().slice(0,10));
    entry.actions = [];
    if (qty > 0) {
      entry.actions.push({ id: Date.now() + '-' + Math.random().toString(36).slice(2), type: 'buy', date, quantity: qty, price, valueEUR: (price != null ? qty * price : null), realizedProfit: null });
    }
  }
}
savePortfolio(state);

function normalizeSymbol(symbol) {
  return symbol.trim().toUpperCase();
}

function getPortfolio() {
  return [...state];
}

async function addOrUpdateCoin(symbol, quantity = 1, acquisitionDate = null) {
  symbol = normalizeSymbol(symbol);
  quantity = Number(quantity) || 0;
  if (quantity < 0) quantity = 0;
  const idx = state.findIndex(c => c.symbol === symbol);
  if (idx >= 0) {
    state[idx].quantity = quantity;
    if (acquisitionDate) state[idx].acquisitionDate = acquisitionDate;
  } else {
    // snapshot price at add time
    let addedPrice = null;
    try {
      const prices = await fetchCurrentPrices([symbol]);
      addedPrice = prices[symbol] ?? null;
    } catch (_) { /* ignore */ }
    state.push({ symbol, quantity, addedAt: new Date().toISOString(), addedPrice, acquisitionDate: acquisitionDate || null, actions: quantity > 0 ? [{ id: Date.now() + '-' + Math.random().toString(36).slice(2), type: 'buy', date: (acquisitionDate || new Date().toISOString().slice(0,10)), quantity, price: addedPrice, valueEUR: (addedPrice != null ? quantity * addedPrice : null), realizedProfit: null }] : [] });
  }
  state = state.filter(c => c.quantity > 0);
  savePortfolio(state);
  return getPortfolio();
}

function removeCoin(symbol) {
  symbol = normalizeSymbol(symbol);
  state = state.filter(c => c.symbol !== symbol);
  savePortfolio(state);
  return getPortfolio();
}

function clearPortfolio() {
  state = [];
  savePortfolio(state);
}

async function recordAction(symbol, type, quantity, actionDateOverride = null) {
  symbol = normalizeSymbol(symbol);
  if (!['buy','sell'].includes(type)) throw new Error('Invalid action type');
  quantity = Number(quantity) || 0;
  if (quantity <= 0) throw new Error('Quantity must be > 0');
  let entry = state.find(c => c.symbol === symbol);
  if (!entry) {
    if (type === 'sell') throw new Error('Cannot sell: no existing position');
    entry = { symbol, quantity: 0, addedAt: new Date().toISOString(), addedPrice: null, acquisitionDate: null, actions: [] };
    state.push(entry);
  }
  if (!entry.actions) entry.actions = [];
  // Snapshot current price
  let price = null;
  try {
    const prices = await fetchCurrentPrices([symbol]);
    price = prices[symbol] ?? null;
  } catch (_) { /* ignore */ }
  let date = new Date().toISOString().slice(0,10);
  if (actionDateOverride && /^\d{4}-\d{2}-\d{2}$/.test(actionDateOverride)) {
    // clamp to today if user enters future date
    const today = new Date().toISOString().slice(0,10);
    date = actionDateOverride > today ? today : actionDateOverride;
  }
  const action = { id: Date.now() + '-' + Math.random().toString(36).slice(2), type, date, quantity, price, valueEUR: (price != null ? quantity * price : null), realizedProfit: null };
  if (type === 'buy') {
    entry.quantity = (entry.quantity || 0) + quantity;
    // Update acquisitionDate if previously flat (quantity before buy was 0)
    if ((entry.quantity - quantity) === 0) entry.acquisitionDate = date;
    entry.addedPrice = price; // last buy snapshot
  } else {
    // Sell: ensure enough position (FIFO P/L)
    if (quantity > entry.quantity) throw new Error('Sell exceeds held quantity');
    // Compute realized profit using FIFO over prior buys minus sells
    let remaining = quantity;
    // Build FIFO lot queue from actions so far (before this sell)
    const fifoLots = [];
    for (const a of entry.actions) {
      if (a.type === 'buy') {
        fifoLots.push({ qty: a.quantity, price: a.price });
      } else if (a.type === 'sell') {
        let toConsume = a.quantity;
        while (toConsume > 0 && fifoLots.length) {
          const lot = fifoLots[0];
            const use = Math.min(lot.qty, toConsume);
            lot.qty -= use;
            toConsume -= use;
            if (lot.qty === 0) fifoLots.shift();
        }
      }
    }
    let realized = 0;
    while (remaining > 0 && fifoLots.length) {
      const lot = fifoLots[0];
      const use = Math.min(lot.qty, remaining);
      if (price != null && lot.price != null) {
        realized += (price - lot.price) * use;
      }
      lot.qty -= use;
      remaining -= use;
      if (lot.qty === 0) fifoLots.shift();
    }
    action.realizedProfit = realized;
    entry.quantity -= quantity;
    if (entry.quantity <= 0) {
      entry.quantity = 0;
      // When flat, clear acquisitionDate (next buy will set anew)
      entry.acquisitionDate = null;
    }
  }
  entry.actions.push(action);
  savePortfolio(state);
  return getPortfolio();
}

function recomputeEntryDerived(entry) {
  // Recompute net quantity from buys - sells
  let qty = 0;
  for (const a of entry.actions) {
    if (a.type === 'buy') qty += a.quantity; else if (a.type === 'sell') qty -= a.quantity;
  }
  entry.quantity = Math.max(0, qty);
  // Set acquisitionDate to first buy after last flat period
  if (entry.quantity === 0) {
    entry.acquisitionDate = null;
  } else {
    // Walk actions accumulating until positive then record that buy's date
    let running = 0;
    let acq = null;
    for (const a of entry.actions) {
      if (a.type === 'buy') {
        const before = running;
        running += a.quantity;
        if (before === 0 && running > 0 && !acq) acq = a.date;
      } else if (a.type === 'sell') {
        running -= a.quantity;
        if (running < 0) running = 0; // safety
      }
    }
    entry.acquisitionDate = acq;
  }
}

function deleteAction(symbol, actionId) {
  symbol = normalizeSymbol(symbol);
  const entry = state.find(c => c.symbol === symbol);
  if (!entry || !entry.actions) return getPortfolio();
  const idx = entry.actions.findIndex(a => a.id === actionId);
  if (idx === -1) return getPortfolio();
  // Remove the action
  entry.actions.splice(idx, 1);
  // Recompute realizedProfit for all sell actions (since FIFO chain may change)
  const buys = [];
  for (const a of entry.actions) {
    if (a.type === 'buy') {
      buys.push({ qty: a.quantity, price: a.price });
    } else if (a.type === 'sell') {
      let remaining = a.quantity;
      let realized = 0;
      // consume FIFO lots
      for (let i = 0; i < buys.length && remaining > 0; i++) {
        const lot = buys[i];
        if (lot.qty === 0) continue;
        const use = Math.min(lot.qty, remaining);
        if (a.price != null && lot.price != null) realized += (a.price - lot.price) * use;
        lot.qty -= use;
        remaining -= use;
      }
      a.realizedProfit = realized;
    }
  }
  recomputeEntryDerived(entry);
  savePortfolio(state);
  return getPortfolio();
}

function recomputeSellRealizedProfits(entry) {
  // Build FIFO lots of buys with their remaining qty and price
  const buys = [];
  for (const a of entry.actions) {
    if (a.type === 'buy') {
      buys.push({ qty: a.quantity, price: a.price });
    } else if (a.type === 'sell') {
      // Recompute realized profit for this sell
      let remaining = a.quantity;
      let realized = 0;
      let incomplete = false;
      const snapshotLots = buys.map(l => ({ qty: l.qty, price: l.price }));
      for (const lot of snapshotLots) {
        if (remaining <= 0) break;
        if (lot.qty <= 0) continue;
        const use = Math.min(lot.qty, remaining);
        if (a.price == null || lot.price == null) { incomplete = true; break; }
        realized += (a.price - lot.price) * use;
        lot.qty -= use;
        remaining -= use;
      }
      a.realizedProfit = incomplete || remaining > 0 ? null : realized;
      // Advance original lots consumption to keep FIFO chain consistent after this sell
      let consume = a.quantity;
      for (const lot of buys) {
        if (consume <= 0) break;
        if (lot.qty <= 0) continue;
        const use = Math.min(lot.qty, consume);
        lot.qty -= use;
        consume -= use;
      }
    }
  }
}

async function backfillMissingActionPrices(cutoffDays = 360) {
  const cutoffDate = new Date(Date.now() - cutoffDays * 86400000).toISOString().slice(0,10);
  const today = new Date().toISOString().slice(0,10);
  const todaySymbols = new Set();
  const todayActionsMap = new Map(); // symbol -> actions[] needing today price
  const historicalTasks = []; // { entry, action }
  let updated = false;
  for (const entry of state) {
    if (!entry.actions) continue;
    for (const action of entry.actions) {
      if (action.price != null) continue;
      if (action.date < cutoffDate) continue; // ignore too old
      if (action.date === today) {
        todaySymbols.add(entry.symbol);
        if (!todayActionsMap.has(entry.symbol)) todayActionsMap.set(entry.symbol, []);
        todayActionsMap.get(entry.symbol).push(action);
      } else {
        historicalTasks.push({ entry, action });
      }
    }
  }
  // Fetch current prices for today's missing actions in batch
  if (todaySymbols.size) {
    try {
      const curr = await fetchCurrentPrices([...todaySymbols]);
      for (const sym of todaySymbols) {
        const price = curr[sym] ?? null;
        if (price != null) {
          for (const act of todayActionsMap.get(sym)) {
            act.price = price;
            act.valueEUR = price * act.quantity;
            updated = true;
          }
        }
      }
    } catch (_) { /* ignore */ }
  }
  // Sequentially fetch historical prices for remaining tasks
  for (const t of historicalTasks) {
    try {
      const price = await fetchHistoricalPrice(t.entry.symbol, t.action.date);
      if (price != null) {
        t.action.price = price;
        t.action.valueEUR = price * t.action.quantity;
        updated = true;
      }
    } catch (_) { /* ignore individual failures */ }
  }
  if (updated) {
    // Recompute realized P/L for any entries touched
    const touchedSymbols = new Set(historicalTasks.map(t => t.entry.symbol));
    todayActionsMap.forEach((_, sym) => touchedSymbols.add(sym));
    for (const sym of touchedSymbols) {
      const entry = state.find(e => e.symbol === sym);
      if (!entry) continue;
      recomputeSellRealizedProfits(entry);
      recomputeEntryDerived(entry);
    }
    savePortfolio(state);
  }
  return updated;
}

export { getPortfolio, addOrUpdateCoin, removeCoin, clearPortfolio, recordAction, deleteAction, backfillMissingActionPrices };
// Update acquisition date for a symbol and persist
function updateAcquisitionDate(symbol, dateStr) {
  symbol = normalizeSymbol(symbol);
  const entry = state.find(c => c.symbol === symbol);
  if (!entry) return getPortfolio();
  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    entry.acquisitionDate = dateStr;
  } else {
    entry.acquisitionDate = null;
  }
  savePortfolio(state);
  return getPortfolio();
}
// Bulk replace portfolio (used for import)
function setPortfolio(items) {
  if (!Array.isArray(items)) throw new Error('Invalid portfolio format');
  const sanitized = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    let { symbol, quantity, addedAt, addedPrice, acquisitionDate, actions } = it;
    if (!symbol) continue;
    symbol = normalizeSymbol(String(symbol));
    quantity = Number(quantity);
    if (!isFinite(quantity) || quantity < 0) continue;
    if (addedAt && isNaN(Date.parse(addedAt))) addedAt = new Date().toISOString();
    if (addedPrice != null) {
      const num = Number(addedPrice);
      addedPrice = isFinite(num) ? num : null;
    } else {
      addedPrice = null;
    }
    if (acquisitionDate && !/^\d{4}-\d{2}-\d{2}$/.test(acquisitionDate)) acquisitionDate = null;
    const actArr = Array.isArray(actions) ? actions.map(a => {
      if (!a || typeof a !== 'object') return null;
      let { id, type, date, quantity: aq, price, realizedProfit, valueEUR } = a;
      if (!['buy','sell'].includes(type)) return null;
      aq = Number(aq);
      if (!isFinite(aq) || aq <= 0) return null;
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) date = new Date().toISOString().slice(0,10);
      price = price != null && isFinite(Number(price)) ? Number(price) : null;
      valueEUR = (price != null ? aq * price : null);
      realizedProfit = realizedProfit != null && isFinite(Number(realizedProfit)) ? Number(realizedProfit) : null;
      return { id: id || Date.now() + '-' + Math.random().toString(36).slice(2), type, date, quantity: aq, price, valueEUR, realizedProfit };
    }).filter(Boolean) : [];
    sanitized.push({ symbol, quantity, addedAt: addedAt || new Date().toISOString(), addedPrice, acquisitionDate: acquisitionDate || null, actions: actArr });
  }
  state = sanitized;
  savePortfolio(state);
  return getPortfolio();
}

export { setPortfolio };
export { updateAcquisitionDate };
