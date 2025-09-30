// api.js - CoinGecko API interaction & caching with lightweight instrumentation

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// In-memory caches for session
const cache = {
  coinList: null,
  currentPrices: new Map(), // key: symbol => { price, ts }
  historicalPrice: new Map(), // key: symbol|date => { price, ts }
  marketChart: new Map(), // key: symbol|days => { prices, ts }
};

const CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes for current prices
const HISTORY_TTL_MS = 60 * 60 * 1000; // 1 hour for historical

function now() { return Date.now(); }

// ---- Logging --------------------------------------------------------------
const apiLog = [];
const MAX_LOG = 300;
function pushLog(entry) {
  apiLog.push(entry);
  if (apiLog.length > MAX_LOG) apiLog.splice(0, apiLog.length - MAX_LOG);
  // Broadcast update
  window.dispatchEvent(new CustomEvent('api-log-update'));
}
function getApiLog() { return [...apiLog].reverse(); } // newest first
function formatTime(ts) { return new Date(ts).toLocaleTimeString([], { hour12: false }); }

async function fetchJSON(url, retry = 1, metaType = 'raw') {
  const start = Date.now();
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) {
      if (retry > 0 && res.status >= 500) {
        await new Promise(r => setTimeout(r, 500));
        return fetchJSON(url, retry - 1, metaType);
      }
      const err = new Error(`API error ${res.status} for ${url}`);
      err.status = res.status;
      err.url = url;
      const note = res.status === 429 ? 'Too many calls – wait a few minutes then refresh.' : undefined;
      pushLog({ ts: Date.now(), type: metaType, url, status: 'error', httpStatus: res.status, duration: Date.now() - start, cached: false, note });
      throw err;
    }
    const json = await res.json();
    pushLog({ ts: Date.now(), type: metaType, url, status: 'success', httpStatus: res.status, duration: Date.now() - start, cached: false });
    return json;
  } catch (e) {
    if (!e.status) e.status = 0;
    if (!apiLog.length || apiLog[apiLog.length - 1].url !== url) {
      const note = e.status === 429 ? 'Too many calls – wait a few minutes then refresh.' : undefined;
      pushLog({ ts: Date.now(), type: metaType, url, status: 'error', httpStatus: e.status, duration: Date.now() - start, cached: false, note });
    }
    throw e;
  }
}

import { loadCoinListCache, saveCoinListCache, loadMarketChartCache, saveMarketChartCache } from './storage.js';

const COINLIST_TTL_MS = 24 * 60 * 60 * 1000; // 24h

async function fetchCoinList(force = false) {
  if (!force && cache.coinList) { pushLog({ ts: Date.now(), type: 'coinList', url: '(memory cache)', status: 'success', cached: true }); return cache.coinList; }
  if (!force) {
    const persisted = loadCoinListCache();
    if (persisted && Date.now() - (persisted.ts || 0) < COINLIST_TTL_MS) {
      const map = new Map();
      for (const item of persisted.data || []) {
        map.set(item.symbol.toLowerCase(), { id: item.id, name: item.name });
      }
      cache.coinList = map;
      pushLog({ ts: Date.now(), type: 'coinList', url: '(persistent cache)', status: 'success', cached: true });
      return map;
    }
  }
  const data = await fetchJSON(`${COINGECKO_BASE}/coins/list?include_platform=false`, 1, 'coinList');
  const symbolToMeta = new Map();
  for (const c of data) {
    const sym = c.symbol.toLowerCase();
    if (!symbolToMeta.has(sym) || c.id.length < symbolToMeta.get(sym).id.length) {
      symbolToMeta.set(sym, { id: c.id, name: c.name });
    }
  }
  cache.coinList = symbolToMeta;
  // Persist
  saveCoinListCache({ ts: Date.now(), data: [...symbolToMeta.entries()].map(([sym, meta]) => ({ symbol: sym, id: meta.id, name: meta.name })) });
  return symbolToMeta;
}

async function resolveSymbols(symbols) {
  const list = await fetchCoinList();
  const map = new Map();
  for (const s of symbols) {
    const key = s.toLowerCase();
    if (list.has(key)) map.set(s.toUpperCase(), list.get(key).id);
  }
  return map; // symbol (original casing) -> id
}

async function fetchCurrentPrices(symbols) {
  const symbolIdMap = await resolveSymbols(symbols);
  const ids = [...symbolIdMap.values()];
  if (ids.length === 0) return {};
  const url = `${COINGECKO_BASE}/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=eur`;
  const data = await fetchJSON(url, 1, 'currentPrices');
  const result = {};
  const ts = now();
  for (const [symbol, id] of symbolIdMap.entries()) {
    const price = data[id]?.eur ?? null;
    result[symbol] = price;
    cache.currentPrices.set(symbol, { price, ts });
  }
  return result;
}

function dateToDDMMYYYY(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${d}-${m}-${y}`;
}

async function fetchHistoricalPrice(symbol, dateStr) {
  const key = `${symbol}|${dateStr}`;
  const cached = cache.historicalPrice.get(key);
  if (cached && now() - cached.ts < HISTORY_TTL_MS) { pushLog({ ts: Date.now(), type: 'historicalPrice', url: '(memory cache)', status: 'success', cached: true }); return cached.price; }
  const symbolIdMap = await resolveSymbols([symbol]);
  const id = symbolIdMap.get(symbol.toUpperCase());
  if (!id) throw new Error(`Unknown symbol ${symbol}`);
  const ddmmyyyy = dateToDDMMYYYY(dateStr);
  const url = `${COINGECKO_BASE}/coins/${id}/history?date=${ddmmyyyy}&localization=false`;
  const json = await fetchJSON(url, 1, 'historicalPrice');
  const price = json?.market_data?.current_price?.eur ?? null;
  cache.historicalPrice.set(key, { price, ts: now() });
  return price;
}

const MARKET_CHART_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours
let persistedMarketChart = null;

function loadMarketChartPersisted() {
  if (persistedMarketChart) return persistedMarketChart;
  persistedMarketChart = loadMarketChartCache();
  return persistedMarketChart;
}

function storeMarketChartPersisted() {
  saveMarketChartCache(persistedMarketChart || {});
}

async function fetchMarketChart(symbol, days) {
  const key = `${symbol}|${days}`;
  // Check memory
  const mem = cache.marketChart.get(key);
  if (mem && now() - mem.ts < MARKET_CHART_TTL_MS) { pushLog({ ts: Date.now(), type: 'marketChart', url: '(memory cache)', status: 'success', cached: true }); return mem.prices; }
  // Check persistent
  const persisted = loadMarketChartPersisted();
  if (persisted[key] && now() - persisted[key].ts < MARKET_CHART_TTL_MS) {
    cache.marketChart.set(key, { prices: persisted[key].prices, ts: persisted[key].ts });
    pushLog({ ts: Date.now(), type: 'marketChart', url: '(persistent cache)', status: 'success', cached: true });
    return persisted[key].prices;
  }
  const symbolIdMap = await resolveSymbols([symbol]);
  const id = symbolIdMap.get(symbol.toUpperCase());
  if (!id) throw new Error(`Unknown symbol ${symbol}`);
  const url = `${COINGECKO_BASE}/coins/${id}/market_chart?vs_currency=eur&days=${days}&interval=daily`;
  const json = await fetchJSON(url, 1, 'marketChart');
  const prices = json.prices || [];
  const record = { prices, ts: now() };
  cache.marketChart.set(key, record);
  persisted[key] = record;
  storeMarketChartPersisted();
  return prices; // [ [timestamp, price], ... ]
}

async function fetchPortfolioTimeline(portfolio, comparisonDate) {
  if (!portfolio.length) return { labels: [], values: [] };
  const startDate = new Date(comparisonDate + 'T00:00:00Z');
  const daysDiff = Math.max(1, Math.ceil((Date.now() - startDate.getTime()) / 86400000));
  const symbols = portfolio.map(p => p.symbol);
  const perSymbolData = new Map();
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    if (i > 0) await new Promise(r => setTimeout(r, 1000));
    try {
      const prices = await fetchMarketChart(sym, daysDiff);
      perSymbolData.set(sym, prices);
    } catch (e) {
      console.warn('Chart fetch failed for', sym, e);
    }
  }
  const daySet = new Set();
  const perSymbolDaily = new Map(); // sym -> Map(day -> price)
  for (const [sym, prices] of perSymbolData.entries()) {
    const dayMap = new Map();
    for (const [ts, price] of prices) {
      const day = new Date(ts).toISOString().slice(0,10);
      if (new Date(day) < startDate) continue;
      // last write wins (prices already daily, but keep latest)
      dayMap.set(day, price);
      daySet.add(day);
    }
    perSymbolDaily.set(sym, dayMap);
  }
  if (!daySet.size) return { labels: [], values: [] };
  const labels = [...daySet].sort();
  const values = labels.map(day => {
    let total = 0;
    for (const { symbol, quantity } of portfolio) {
      const m = perSymbolDaily.get(symbol);
      if (!m) continue;
      const price = m.get(day);
      if (price == null) continue;
      total += price * quantity;
    }
    return Number(total.toFixed(2));
  });
  return { labels, values };
}

export {
  fetchCoinList,
  fetchCurrentPrices,
  fetchHistoricalPrice,
  fetchPortfolioTimeline,
  fetchMarketChart,
  getApiLog,
};
