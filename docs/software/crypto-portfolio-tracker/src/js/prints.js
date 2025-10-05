// prints.js - manage spot prints (snapshot of current prices & portfolio total)
import { loadSpotPrints, saveSpotPrints } from './storage.js';
import { getPortfolio } from './portfolio.js';

let prints = loadSpotPrints();

function listPrints() {
  return [...prints];
}

function addPrint(currentPricesMap) {
  const portfolio = getPortfolio();
  // Compute portfolio total using provided currentPricesMap (symbol -> price)
  let total = 0;
  const prices = {};
  for (const { symbol, quantity } of portfolio) {
    const p = currentPricesMap[symbol] != null ? currentPricesMap[symbol] : null;
    prices[symbol] = p;
    if (p != null) total += p * quantity;
  }
  const id = Date.now() + '-' + Math.random().toString(36).slice(2);
  const entry = { id, ts: Date.now(), prices, portfolioTotal: total };
  prints.unshift(entry); // newest first
  saveSpotPrints(prints);
  return entry;
}

function removePrint(id) {
  prints = prints.filter(p => p.id !== id);
  saveSpotPrints(prints);
  return listPrints();
}

function clearPrints() {
  prints = [];
  saveSpotPrints(prints);
}

export { listPrints, addPrint, removePrint, clearPrints };
