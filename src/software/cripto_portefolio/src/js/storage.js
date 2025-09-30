// storage.js - localStorage persistence helpers

const LS_KEY_PORTFOLIO = 'cryptoPortfolio';
const LS_KEY_DATE = 'comparisonDate';
const LS_KEY_THEME = 'theme';
const LS_KEY_PRICE_CACHE = 'priceCacheV1';
const LS_KEY_COINLIST = 'coinListCacheV1';
const LS_KEY_MARKET_CHART = 'marketChartCacheV1';
const LS_KEY_SETTINGS = 'settingsV1';

function loadPortfolio() {
  try { return JSON.parse(localStorage.getItem(LS_KEY_PORTFOLIO)) || []; } catch { return []; }
}

function savePortfolio(portfolio) {
  localStorage.setItem(LS_KEY_PORTFOLIO, JSON.stringify(portfolio));
}

function loadComparisonDate() {
  return localStorage.getItem(LS_KEY_DATE) || null;
}

function saveComparisonDate(dateStr) {
  localStorage.setItem(LS_KEY_DATE, dateStr);
}

function loadTheme() {
  return localStorage.getItem(LS_KEY_THEME) || null;
}

function saveTheme(theme) {
  localStorage.setItem(LS_KEY_THEME, theme);
}

function loadPriceCache() {
  try { return JSON.parse(localStorage.getItem(LS_KEY_PRICE_CACHE)) || {}; } catch { return {}; }
}

function savePriceCache(cache) {
  localStorage.setItem(LS_KEY_PRICE_CACHE, JSON.stringify(cache));
}

function loadCoinListCache() {
  try { return JSON.parse(localStorage.getItem(LS_KEY_COINLIST)) || null; } catch { return null; }
}

function saveCoinListCache(obj) {
  localStorage.setItem(LS_KEY_COINLIST, JSON.stringify(obj));
}

function loadMarketChartCache() {
  try { return JSON.parse(localStorage.getItem(LS_KEY_MARKET_CHART)) || {}; } catch { return {}; }
}

function saveMarketChartCache(cache) {
  localStorage.setItem(LS_KEY_MARKET_CHART, JSON.stringify(cache));
}

function loadSettings() {
  try { return JSON.parse(localStorage.getItem(LS_KEY_SETTINGS)) || null; } catch { return null; }
}

function saveSettings(settings) {
  localStorage.setItem(LS_KEY_SETTINGS, JSON.stringify(settings));
}

export {
  loadPortfolio,
  savePortfolio,
  loadComparisonDate,
  saveComparisonDate,
  loadTheme,
  saveTheme,
  loadPriceCache,
  savePriceCache,
  loadCoinListCache,
  saveCoinListCache,
  loadMarketChartCache,
  saveMarketChartCache,
  loadSettings,
  saveSettings,
};
