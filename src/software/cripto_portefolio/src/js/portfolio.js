// portfolio.js - portfolio manipulation logic

import { loadPortfolio, savePortfolio } from './storage.js';
import { fetchCurrentPrices } from './api.js';

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

export { getPortfolio, addOrUpdateCoin, removeCoin, clearPortfolio, recordAction };
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
