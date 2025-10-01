// api.js - CoinGecko API interaction & caching with lightweight instrumentation

const COINGECKO_BASE = 'https://api.coingecko.com/api/v3';

// In-memory caches for session
const cache = {
  coinList: null,
  currentPrices: new Map(), // key: symbol => { price, ts }
  historicalPrice: new Map(), // key: symbol|date => { price, ts }
  marketChart: new Map(), // key: symbol|days => { prices, ts }
  coinImages: new Map(), // key: symbol => { url, ts }
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

import { loadCoinListCache, saveCoinListCache, loadMarketChartCache, saveMarketChartCache, loadCoinImagesCache, saveCoinImagesCache } from './storage.js';

const COINLIST_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Static curated popular symbols (lowercase) mapped to a preferred CoinGecko id override (optional)
const POPULAR_SYMBOLS = new Set(['btc','eth','sol','ada','xrp','dot','link','ltc','matic','doge','arb','avax','tron','bch','xlm','atom','near','op','sei','uni','aave','mana','sand','fil','etc','ftm','egld','grt','hnt','inj','kas','mina','qnt','rdnt','sui','vet','xmr']);

async function fetchCoinList(force = false, popularOnly = false) {
  if (!force && cache.coinList) { pushLog({ ts: Date.now(), type: 'coinList', url: '(memory cache)', status: 'success', cached: true }); return popularOnly ? filterPopular(cache.coinList) : cache.coinList; }
  if (!force) {
    const persisted = loadCoinListCache();
    if (persisted && Date.now() - (persisted.ts || 0) < COINLIST_TTL_MS) {
      const map = new Map();
      for (const item of persisted.data || []) {
        map.set(item.symbol.toLowerCase(), { id: item.id, name: item.name });
      }
      cache.coinList = map;
      pushLog({ ts: Date.now(), type: 'coinList', url: '(persistent cache)', status: 'success', cached: true });
  return popularOnly ? filterPopular(map) : map;
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
  return popularOnly ? filterPopular(symbolToMeta) : symbolToMeta;
}

function filterPopular(fullMap) {
  const filtered = new Map();
  for (const [sym, meta] of fullMap.entries()) {
    if (POPULAR_SYMBOLS.has(sym)) filtered.set(sym, meta);
  }
  return filtered.size ? filtered : fullMap; // fallback to full if something went wrong
}

async function resolveSymbols(symbols) {
  const list = await fetchCoinList(false); // full list for resolving to avoid missing ids
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

// ---------------- Coin Images (logos) with persistence -----------------
let persistedCoinImages = null;
function ensureCoinImagesLoaded() {
  if (persistedCoinImages !== null) return;
  const loaded = loadCoinImagesCache();
  persistedCoinImages = loaded && typeof loaded === 'object' ? loaded : {};
  for (const [sym, url] of Object.entries(persistedCoinImages)) {
    if (typeof url === 'string' && url) {
      cache.coinImages.set(sym.toUpperCase(), { url, ts: 0 });
    }
  }
}
function persistCoinImages() {
  if (persistedCoinImages === null) ensureCoinImagesLoaded();
  const obj = { ...(persistedCoinImages || {}) };
  let changed = false;
  for (const [sym, data] of cache.coinImages.entries()) {
    if (data?.url && !obj[sym]) { obj[sym] = data.url; changed = true; }
  }
  if (changed) { saveCoinImagesCache(obj); persistedCoinImages = obj; }
}
async function fetchCoinImagesForSymbols(symbols) {
  ensureCoinImagesLoaded();
  const unique = [...new Set(symbols.map(s => s.toUpperCase()))];
  const need = [];
  const symbolIdMap = await resolveSymbols(unique);
  for (const sym of unique) {
    if (!cache.coinImages.get(sym)) need.push(sym);
  }
  if (!need.length) {
    const out = {}; for (const s of unique) { const e = cache.coinImages.get(s); if (e) out[s] = e.url; }
    return out;
  }
  const idsNeeded = need.map(s => symbolIdMap.get(s)).filter(Boolean);
  if (!idsNeeded.length) return {};
  const url = `${COINGECKO_BASE}/coins/markets?vs_currency=eur&ids=${encodeURIComponent(idsNeeded.join(','))}&per_page=${idsNeeded.length}`;
  const json = await fetchJSON(url, 1, 'coinImages');
  const idToSymbol = new Map();
  for (const [sym, id] of symbolIdMap.entries()) idToSymbol.set(id, sym);
  for (const item of json) {
    const sym = idToSymbol.get(item.id);
    if (sym) {
      cache.coinImages.set(sym, { url: item.image, ts: now() });
    }
  }
  persistCoinImages();
  const out = {}; for (const s of unique) { const e = cache.coinImages.get(s); if (e) out[s] = e.url; }
  return out;
}
function getCachedCoinImage(symbol) {
  ensureCoinImagesLoaded();
  const e = cache.coinImages.get(symbol.toUpperCase());
  return e ? e.url : null;
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
  // Opportunistically capture image (CoinGecko history endpoint returns image.{thumb,small,large})
  try {
    const img = json?.image?.small || json?.image?.thumb || json?.image?.large;
    if (img && !cache.coinImages.get(symbol.toUpperCase())) {
      cache.coinImages.set(symbol.toUpperCase(), { url: img, ts: now() });
      persistCoinImages();
    }
  } catch (_) { /* ignore image extraction issues */ }
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
  fetchCoinImagesForSymbols,
  getCachedCoinImage,
};

// --- Performance (percent change) timeline including per symbol ---
export async function fetchPerformanceSeries(portfolio, comparisonDate) {
  if (!portfolio.length) return { labels: [], datasets: [] };
  const startDate = new Date(comparisonDate + 'T00:00:00Z');
  const daysDiff = Math.max(1, Math.ceil((Date.now() - startDate.getTime()) / 86400000));
  const symbols = portfolio.map(p => p.symbol);
  const perSymbolData = new Map();
  for (let i = 0; i < symbols.length; i++) {
    const sym = symbols[i];
    try {
      const prices = await fetchMarketChart(sym, daysDiff);
      perSymbolData.set(sym, prices);
    } catch (e) {
      console.warn('Performance chart fetch failed for', sym, e);
    }
  }
  const daySet = new Set();
  const perSymbolDaily = new Map();
  for (const [sym, prices] of perSymbolData.entries()) {
    const dayMap = new Map();
    for (const [ts, price] of prices) {
      const day = new Date(ts).toISOString().slice(0,10);
      if (new Date(day) < startDate) continue;
      dayMap.set(day, price);
      daySet.add(day);
    }
    perSymbolDaily.set(sym, dayMap);
  }
  if (!daySet.size) return { labels: [], datasets: [] };
  const labels = [...daySet].sort();
  // Build per-symbol percent change datasets
  const datasets = [];
  for (const sym of symbols) {
    const dayMap = perSymbolDaily.get(sym);
    if (!dayMap) continue;
    const firstDay = labels.find(d => dayMap.has(d));
    if (!firstDay) continue;
    const base = dayMap.get(firstDay);
    if (base == null || base === 0) continue;
    const values = labels.map(day => {
      const price = dayMap.get(day);
      if (price == null) return null;
      return (price / base - 1) * 100; // percent change
    });
    datasets.push({ label: sym, values });
  }
  // Portfolio percent change (value-based)
  const firstPortfolioValue = (() => {
    for (const day of labels) {
      let total = 0; let have = false;
      for (const { symbol, quantity } of portfolio) {
        const m = perSymbolDaily.get(symbol); if (!m) continue;
        const price = m.get(day); if (price == null) continue;
        total += price * quantity; have = true;
      }
      if (have && total !== 0) return { day, value: total };
    }
    return null;
  })();
  if (firstPortfolioValue) {
    const base = firstPortfolioValue.value;
    const portValues = labels.map(day => {
      let total = 0; let have = false;
      for (const { symbol, quantity } of portfolio) {
        const m = perSymbolDaily.get(symbol); if (!m) continue;
        const price = m.get(day); if (price == null) continue;
        total += price * quantity; have = true;
      }
      if (!have) return null;
      return (total / base - 1) * 100;
    });
    datasets.unshift({ label: 'PORTFOLIO', values: portValues });
  }
  return { labels, datasets };
}
