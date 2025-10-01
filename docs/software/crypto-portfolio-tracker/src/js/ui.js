// ui.js - DOM rendering and event listeners

import { fetchCurrentPrices, fetchHistoricalPrice, fetchPortfolioTimeline, fetchCoinList, getApiLog, fetchCoinImagesForSymbols, getCachedCoinImage } from './api.js';
import { getPortfolio, addOrUpdateCoin, removeCoin, clearPortfolio, setPortfolio, recordAction, deleteAction, backfillMissingActionPrices, updateAcquisitionDate } from './portfolio.js';
import { loadComparisonDate, saveComparisonDate, loadPriceCache, savePriceCache, loadTheme, saveTheme, saveCoinListCache, saveMarketChartCache, loadSettings, saveSettings } from './storage.js';
import { updateChart } from './chart.js';
import { showToast } from './toast.js';
import { renderMiniChartsForPortfolio, clearMiniCharts, renderMiniChart } from './miniCharts.js';
import { initAnalytics, refreshAnalytics } from './analytics.js';
import { refreshAllocationChart } from './allocationChart.js';
import { initHistorySnapshots, refreshHistorySnapshots } from './historySnapshots.js';
import { formatDisplayPrice } from './priceFormat.js';

const els = {};
// Dynamic settings (defaults)
let settings = {
  refreshHours: 6, // hours freshness window
  perCallDelayMs: 2000, // ms delay between sequential API calls
};
let priceCache = {};
let latestRows = [];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function q(id) { return document.getElementById(id); }

function initDOMRefs() {
  els.symbolInput = q('symbolInput');
  els.quantityInput = q('quantityInput');
  els.actionType = q('actionType');
  els.addCoinForm = q('addCoinForm');
  els.addCoinError = q('addCoinError');
  els.refreshCoinListBtn = q('refreshCoinListBtn');
  els.coinListInfo = q('coinListInfo');
  els.comparisonDate = q('comparisonDate');
  els.tableBody = q('portfolioTableBody');
  els.emptyState = q('emptyState');
  els.summary = q('portfolioSummary');
  els.refreshBtn = q('refreshBtn');
  els.forceReloadBtn = q('forceReloadBtn');
  els.clearPortfolioBtn = q('clearPortfolioBtn');
  els.darkModeToggle = q('darkModeToggle');
  els.exportPortfolioBtn = q('exportPortfolioBtn');
  els.importPortfolioBtn = q('importPortfolioBtn');
  els.importFileInput = q('importFile');
  els.apiLogToggleBtn = q('apiLogToggleBtn');
  els.apiLogPanel = q('apiLogPanel');
  els.apiLogCloseBtn = q('apiLogCloseBtn');
  els.apiLogList = q('apiLogList');
  els.settingsToggleBtn = q('settingsToggleBtn');
  els.settingsPanel = q('settingsPanel');
  els.settingsCloseBtn = q('settingsCloseBtn');
  els.settingsToggleBtn = q('settingsToggleBtn');
  els.settingsPanel = q('settingsPanel');
  els.settingsCloseBtn = q('settingsCloseBtn');
  // Settings
  els.settingRefreshHours = q('settingRefreshHours');
  els.settingApiDelay = q('settingApiDelay');
  els.applySettingsBtn = q('applySettingsBtn');
  els.settingsStatus = q('settingsStatus');
}

function defaultComparisonDate() {
  const d = new Date(Date.now() - 30 * 86400000);
  return d.toISOString().slice(0, 10);
}

function initDate() {
  const saved = loadComparisonDate();
  els.comparisonDate.value = saved || defaultComparisonDate();
  els.comparisonDate.addEventListener('change', () => {
    saveComparisonDate(els.comparisonDate.value);
    // Do NOT refresh all holdings here; this date now only serves as default for new actions
  });
}

function initTheme() {
  // If a user preference stored, apply; else use system preference
  const stored = loadTheme();
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const mode = stored || (prefersDark ? 'dark' : 'light');
  applyTheme(mode);
  if (els.darkModeToggle) {
    els.darkModeToggle.checked = mode === 'dark';
    els.darkModeToggle.addEventListener('change', () => {
      const newMode = els.darkModeToggle.checked ? 'dark' : 'light';
      applyTheme(newMode);
    });
  }
}

function initSettings() {
  const stored = loadSettings();
  if (stored) {
    if (Number.isFinite(stored.refreshHours)) settings.refreshHours = Math.min(72, Math.max(1, stored.refreshHours));
    if (Number.isFinite(stored.perCallDelayMs)) settings.perCallDelayMs = Math.min(10000, Math.max(0, stored.perCallDelayMs));
  }
  if (els.settingRefreshHours) els.settingRefreshHours.value = settings.refreshHours;
  if (els.settingApiDelay) els.settingApiDelay.value = (settings.perCallDelayMs / 1000);
  if (els.applySettingsBtn) {
    els.applySettingsBtn.addEventListener('click', () => {
      const rh = parseFloat(els.settingRefreshHours.value);
      const delaySec = parseFloat(els.settingApiDelay.value);
      const newRefresh = Number.isFinite(rh) ? Math.min(72, Math.max(1, rh)) : settings.refreshHours;
      const newDelayMs = Number.isFinite(delaySec) ? Math.min(10000, Math.max(0, delaySec * 1000)) : settings.perCallDelayMs;
      const changed = newRefresh !== settings.refreshHours || newDelayMs !== settings.perCallDelayMs;
      settings.refreshHours = newRefresh;
      settings.perCallDelayMs = newDelayMs;
      saveSettings(settings);
      if (els.settingRefreshHours) els.settingRefreshHours.value = settings.refreshHours;
      if (els.settingApiDelay) els.settingApiDelay.value = (settings.perCallDelayMs / 1000);
      if (els.settingsStatus) {
        els.settingsStatus.textContent = changed ? 'Saved. Applying…' : 'No changes';
        setTimeout(() => { if (els.settingsStatus) els.settingsStatus.textContent = ''; }, 2500);
      }
      if (changed) {
        // If freshness window shrank, previously fresh cache may now be stale; force a soft refresh
        refreshAll();
      }
    });
  }
}

function applyTheme(mode) {
  document.documentElement.classList.toggle('dark', mode === 'dark');
  saveTheme(mode);
}

async function populateCoinDatalist(force = false) {
  const datalist = document.getElementById('coinOptions');
  if (!datalist) return;
  const popularOnly = document.getElementById('popularOnlyToggle')?.checked || false;
  if (els.refreshCoinListBtn) {
    els.refreshCoinListBtn.disabled = true;
    els.refreshCoinListBtn.textContent = force ? 'Refreshing...' : 'Loading...';
  }
  try {
    const list = await fetchCoinList(force, popularOnly);
    const items = [...list.entries()]
      .sort((a,b) => a[0].localeCompare(b[0]))
      .slice(0, 5000); // allow more
    datalist.innerHTML = items.map(([sym, meta]) => `<option value="${sym.toUpperCase()}" label="${meta.name}"></option>`).join('');
    if (els.coinListInfo) {
      els.coinListInfo.textContent = `Loaded ${items.length} symbol${items.length===1?'':'s'}${popularOnly ? ' (popular subset)' : ''}${force ? ' (refreshed)' : ''}.`;
    }
  } catch (e) {
    console.warn('Failed to load coin list', e);
    const msg = e.status === 429 ? 'Too many API calls (coin list). Try again later.' : 'Failed to load coin list.';
    showToast(msg, 'error');
    if (els.coinListInfo) els.coinListInfo.textContent = 'Failed to load coin list';
  } finally {
    if (els.refreshCoinListBtn) {
      els.refreshCoinListBtn.disabled = false;
      els.refreshCoinListBtn.textContent = 'Refresh List';
    }
  }
}

function initAddCoinForm() {
  els.addCoinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    els.addCoinError.classList.add('hidden');
    const symbol = els.symbolInput.value.trim();
    const qty = els.quantityInput.value;
    const type = els.actionType ? els.actionType.value : 'buy';
    if (!symbol) return;
    try {
      const actDate = els.comparisonDate ? els.comparisonDate.value : null;
      if (type === 'buy') {
        await recordAction(symbol, 'buy', qty, actDate);
      } else {
        await recordAction(symbol, 'sell', qty, actDate);
      }
      els.symbolInput.value = '';
      if (els.quantityInput) els.quantityInput.value = 1;
      await refreshAll();
    } catch (err) {
      els.addCoinError.textContent = err.message;
      els.addCoinError.classList.remove('hidden');
    }
  });
}

function initControls() {
  els.refreshBtn.addEventListener('click', () => refreshAll());
  if (els.forceReloadBtn) {
    els.forceReloadBtn.addEventListener('click', () => forceReload());
  }
  els.clearPortfolioBtn.addEventListener('click', () => {
    if (confirm('Clear entire portfolio?')) {
      clearPortfolio();
      refreshAll();
    }
  });
  if (els.refreshCoinListBtn) {
    els.refreshCoinListBtn.addEventListener('click', () => populateCoinDatalist(true));
  }
  const popularToggle = document.getElementById('popularOnlyToggle');
  if (popularToggle) popularToggle.addEventListener('change', () => populateCoinDatalist());
  if (els.exportPortfolioBtn) {
    els.exportPortfolioBtn.addEventListener('click', exportPortfolioJSON);
  }
  if (els.importPortfolioBtn && els.importFileInput) {
    els.importPortfolioBtn.addEventListener('click', () => els.importFileInput.click());
    els.importFileInput.addEventListener('change', handleImportFile);
  }
  if (els.apiLogToggleBtn) {
    els.apiLogToggleBtn.addEventListener('click', toggleApiLogPanel);
  }
  if (els.apiLogCloseBtn) {
    els.apiLogCloseBtn.addEventListener('click', () => hideApiLogPanel());
  }
  if (els.settingsToggleBtn) {
    els.settingsToggleBtn.addEventListener('click', toggleSettingsPanel);
  }
  if (els.settingsCloseBtn) {
    els.settingsCloseBtn.addEventListener('click', () => hideSettingsPanel());
  }
  if (els.settingsToggleBtn) {
    els.settingsToggleBtn.addEventListener('click', toggleSettingsPanel);
  }
  if (els.settingsCloseBtn) {
    els.settingsCloseBtn.addEventListener('click', () => hideSettingsPanel());
  }
  window.addEventListener('api-log-update', () => {
    if (!els.apiLogPanel?.classList.contains('hidden')) renderApiLog();
  });

  // Mobile collapse for Record Action panel
  const toggleBtn = document.getElementById('actionPanelToggle');
  const panelBody = document.getElementById('actionPanelBody');
  if (toggleBtn && panelBody) {
    const STORAGE_KEY = 'actionPanelExpanded';
    const saved = localStorage.getItem(STORAGE_KEY);
    const isMobile = window.matchMedia('(max-width: 640px)').matches; // sm breakpoint
    // Default: expanded on desktop, collapsed on mobile unless saved preference exists
    let expanded = saved != null ? saved === 'true' : !isMobile;
    function applyState() {
      if (expanded) {
        panelBody.classList.remove('hidden');
        toggleBtn.setAttribute('aria-expanded','true');
        toggleBtn.textContent = '− Hide';
        const hint = document.getElementById('actionPanelHint');
        if (hint) hint.textContent = isMobile ? 'Tap to collapse' : '';
      } else {
        panelBody.classList.add('hidden');
        toggleBtn.setAttribute('aria-expanded','false');
        toggleBtn.textContent = '+ Record Action';
        const hint = document.getElementById('actionPanelHint');
        if (hint) hint.textContent = isMobile ? 'Tap to expand' : '';
      }
    }
    applyState();
    toggleBtn.addEventListener('click', () => {
      expanded = !expanded;
      localStorage.setItem(STORAGE_KEY, String(expanded));
      applyState();
    });
  }
}

function exportPortfolioJSON() {
  try {
    const data = {
      exportedAt: new Date().toISOString(),
      comparisonDate: els.comparisonDate?.value || null,
      portfolio: getPortfolio(),
      settings: { refreshHours: settings.refreshHours, perCallDelayMs: settings.perCallDelayMs },
      version: 2,
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `portfolio-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  } catch (e) {
    alert('Failed to export portfolio: ' + e.message);
  }
}

function handleImportFile(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const text = String(reader.result || '');
      const json = JSON.parse(text);
      const portfolioData = Array.isArray(json) ? json : json.portfolio;
      if (!Array.isArray(portfolioData)) throw new Error('JSON must be an array or an object with a portfolio array');
      setPortfolio(portfolioData);
      if (json.comparisonDate && /^\d{4}-\d{2}-\d{2}$/.test(json.comparisonDate)) {
        els.comparisonDate.value = json.comparisonDate;
        saveComparisonDate(json.comparisonDate);
      }
      // Restore settings if present
      if (json.settings && typeof json.settings === 'object') {
        let changed = false;
        if (Number.isFinite(json.settings.refreshHours)) {
          const rh = Math.min(72, Math.max(1, json.settings.refreshHours));
          if (rh !== settings.refreshHours) { settings.refreshHours = rh; changed = true; }
        }
        if (Number.isFinite(json.settings.perCallDelayMs)) {
          const dms = Math.min(10000, Math.max(0, json.settings.perCallDelayMs));
          if (dms !== settings.perCallDelayMs) { settings.perCallDelayMs = dms; changed = true; }
        }
        saveSettings(settings);
        // Reflect in UI controls
        if (els.settingRefreshHours) els.settingRefreshHours.value = settings.refreshHours;
        if (els.settingApiDelay) els.settingApiDelay.value = (settings.perCallDelayMs / 1000);
        if (changed) showToast('Settings restored from import', 'info');
      }
      await refreshAll();
      alert('Portfolio imported');
    } catch (e) {
      console.error(e);
      alert('Import failed: ' + e.message);
    } finally {
      ev.target.value = '';
    }
  };
  reader.onerror = () => {
    alert('Failed to read file');
  };
  reader.readAsText(file);
}

function renderEmptyState(show) {
  els.emptyState.classList.toggle('hidden', !show);
}

function renderSummary(rows) {
  els.summary.innerHTML = '';
  if (!rows.length) return;
  const totalCurrent = rows.reduce((a, r) => a + (r.currentValue || 0), 0);
  const totalPast = rows.reduce((a, r) => a + (r.pastValue || 0), 0);
  const diff = totalCurrent - totalPast;
  const pct = totalPast ? (diff / totalPast) * 100 : 0;
  const fmt2 = v => '€' + v.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const summaryData = [
    ['Total (current)', fmt2(totalCurrent)],
    ['Total (on date)', fmt2(totalPast)],
    ['Change (EUR)', (diff >= 0 ? '+' : '') + fmt2(Math.abs(diff))],
    ['Change (%)', (diff >= 0 ? '+' : '') + pct.toFixed(2) + '%'],
  ];
  for (const [label, value] of summaryData) {
    const spanL = document.createElement('div');
    spanL.textContent = label;
    const spanV = document.createElement('div');
    spanV.textContent = value;
    spanV.className = 'text-right font-medium';
    if (label.startsWith('Change')) {
      spanV.classList.add(diff >= 0 ? 'text-bull' : 'text-bear');
    }
    els.summary.append(spanL, spanV);
  }
}

function hoursAgo(ts) { if (!ts) return null; return Math.floor((Date.now() - ts) / 3600000); }
function getFreshnessMs() { return settings.refreshHours * 60 * 60 * 1000; }
function isFresh(ts) { const ms = getFreshnessMs(); return ts && (Date.now() - ts) < ms; }
function ensureSymbolCache(symbol) { if (!priceCache[symbol]) priceCache[symbol] = { current: null, history: {} }; return priceCache[symbol]; }
function getCachedCurrent(symbol) { const e = priceCache[symbol]?.current; return e && isFresh(e.ts) ? e : null; }
function setCachedCurrent(symbol, price) { ensureSymbolCache(symbol).current = { price, ts: Date.now() }; savePriceCache(priceCache); }
function getCachedHistorical(symbol, dateStr) { const e = priceCache[symbol]?.history?.[dateStr]; return e && isFresh(e.ts) ? e : null; }
function setCachedHistorical(symbol, dateStr, price) { ensureSymbolCache(symbol); priceCache[symbol].history[dateStr] = { price, ts: Date.now() }; savePriceCache(priceCache); }

function renderTable(rows) {
  els.tableBody.innerHTML = '';
  renderEmptyState(!rows.length);
  // Pre-fetch coin images (best effort, non-blocking for initial synchronous render) then patch cells
  const symbols = rows.map(r => r.symbol);
  fetchCoinImagesForSymbols(symbols).then(imgMap => {
    rows.forEach(r => {
      const tr = els.tableBody.querySelector(`tr[data-symbol="${r.symbol}"]`);
      if (!tr) return;
      const imgEl = tr.querySelector('img[data-coin-img]');
      const cached = getCachedCoinImage(r.symbol);
      const src = imgMap[r.symbol] || cached;
      if (imgEl && src && imgEl.getAttribute('data-loaded') !== '1') {
        imgEl.src = src;
        imgEl.setAttribute('data-loaded','1');
      }
    });
  }).catch(()=>{
    // Even if batch fetch fails, try populate with any individual cached ones (from historical calls)
    rows.forEach(r => {
      const tr = els.tableBody.querySelector(`tr[data-symbol="${r.symbol}"]`);
      if (!tr) return;
      const imgEl = tr.querySelector('img[data-coin-img]');
      const cached = getCachedCoinImage(r.symbol);
      if (imgEl && cached && imgEl.getAttribute('data-loaded') !== '1') {
        imgEl.src = cached;
        imgEl.setAttribute('data-loaded','1');
      }
    });
  });
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-gray-50 dark:hover:bg-gray-700/40 transition-colors';
    tr.dataset.symbol = row.symbol;
    const addedInfo = row.addedPrice != null ? `Added @ €${row.addedPrice.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}` : 'No snapshot';
    const diff = (row.currentPrice ?? 0) - (row.pastPrice ?? 0);
    const pct = row.pastPrice ? (diff / row.pastPrice) * 100 : 0;
    const diffCls = row.currentPrice != null && row.pastPrice != null ? (diff >= 0 ? 'text-bull' : 'text-bear') : '';
    const statusText = row.statusText || '(loading)';
    const acqDate = getPortfolio().find(p => p.symbol === row.symbol)?.acquisitionDate || '';
  const actions = getPortfolio().find(p => p.symbol === row.symbol)?.actions || [];
  const netQty = getPortfolio().find(p => p.symbol === row.symbol)?.quantity || 0;
  const nextAction = netQty > 0 ? 'SELL' : 'BUY';
    const realizedTotal = actions.filter(a => a.realizedProfit != null).reduce((s,a)=>s+a.realizedProfit,0);
    const imgUrl = getCachedCoinImage(row.symbol) || '';
    tr.innerHTML = `
      <td class="px-4 py-2 font-medium" title="${addedInfo}\nAdded: ${row.addedAt || '—'}">
        <div class="flex flex-col gap-1">
          <span class="flex items-center gap-2">
            <img data-coin-img src="${imgUrl}" alt="${row.symbol} logo" class="w-5 h-5 rounded-full bg-gray-200 dark:bg-gray-700 object-contain" />
            <span>${row.symbol}</span>
            <span class="inline-block text-[10px] px-1 py-0.5 rounded bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200">Next: ${nextAction}</span>
          </span>
          <input type="date" data-acq="${row.symbol}" value="${acqDate || ''}" class="block w-full rounded-md bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-600 focus:ring-indigo-500 focus:border-indigo-500 text-[11px] px-1 py-0.5" />
        </div>
      </td>
  <td class="px-4 py-2 text-right">${Number(row.quantity).toFixed(2)}</td>
  <td class="px-4 py-2 text-right" data-cell="pastPrice" title="Price on ${acqDate}">${row.pastPrice != null ? '€' + formatDisplayPrice(row.pastPrice) : '—'}</td>
  <td class="px-4 py-2 text-right font-mono" data-cell="currentPrice">${row.currentPrice != null ? '€' + row.currentPrice : '—'}</td>
      <td class="px-4 py-2 text-right ${diffCls}" data-cell="diff">${row.currentPrice != null && row.pastPrice != null ? (diff >= 0 ? '+' : '') + '€' + diff.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'}</td>
      <td class="px-4 py-2 text-right ${diffCls}" data-cell="pct">${row.currentPrice != null && row.pastPrice != null ? (diff >= 0 ? '+' : '') + pct.toFixed(2) + '%' : '—'}</td>
      <td class="px-4 py-2 text-left" data-cell="status">${statusText}</td>
      <td class="px-2 py-2 text-right">
        <div class="flex items-center justify-end gap-2">
          <button data-refresh="${row.symbol}" class="text-xs text-indigo-600 hover:underline">Refresh</button>
          <button data-remove="${row.symbol}" class="text-xs text-red-600 hover:underline">Remove</button>
        </div>
      </td>`;
    els.tableBody.appendChild(tr);
    // Action history row
    const trHist = document.createElement('tr');
    trHist.dataset.symbol = row.symbol + '-history';
    const histHtml = actions.length ? `
      <table class="min-w-full text-[11px]">
        <thead>
          <tr class="text-gray-500 dark:text-gray-400">
            <th class="px-2 py-1 text-left">Type</th>
            <th class="px-2 py-1 text-right">Qty</th>
            <th class="px-2 py-1 text-right">Price</th>
            <th class="px-2 py-1 text-right">Value</th>
            <th class="px-2 py-1 text-right">Realized P/L</th>
            <th class="px-2 py-1 text-left">Date</th>
          </tr>
        </thead>
        <tbody>
          ${actions.map(a => {
            const qtyDispRaw = Number(a.quantity).toFixed(2);
            const qtyDisp = a.type === 'sell' ? '-' + qtyDispRaw : qtyDispRaw;
            const rp = a.realizedProfit != null ? (a.realizedProfit >=0 ? '+' : '') + '€' + a.realizedProfit.toFixed(2) : '—';
            const rpCls = a.realizedProfit != null ? (a.realizedProfit >=0 ? 'text-bull' : 'text-bear') : '';
            return `<tr>
              <td class="px-2 py-0.5 capitalize">${a.type}</td>
              <td class="px-2 py-0.5 text-right">${qtyDisp}</td>
              <td class="px-2 py-0.5 text-right">${a.price != null ? '€'+Number(a.price).toFixed(4) :'—'}</td>
              <td class="px-2 py-0.5 text-right">${a.valueEUR != null ? '€'+a.valueEUR.toFixed(2):'—'}</td>
              <td class="px-2 py-0.5 text-right ${rpCls}">${rp}</td>
              <td class="px-2 py-0.5 flex items-center gap-2">${a.date}<button data-del-action="${row.symbol}|${a.id}" class="text-[10px] text-red-600 hover:underline ml-auto">✕</button></td>
            </tr>`;
          }).join('')}
          <tr class="font-medium">
            <td class="px-2 py-1" colspan="4">Realized Total</td>
            <td class="px-2 py-1 text-right ${realizedTotal>=0?'text-bull':'text-bear'}">${(realizedTotal>=0?'+':'')+'€'+realizedTotal.toFixed(2)}</td>
            <td></td>
          </tr>
        </tbody>
      </table>` : '<div class="text-[11px] text-gray-500">No actions yet.</div>';
    trHist.innerHTML = `<td colspan="8" class="bg-gray-50 dark:bg-gray-900/40 px-4 pb-3 pt-1">${histHtml}</td>`;
    els.tableBody.appendChild(trHist);
  }
  els.tableBody.querySelectorAll('button[data-remove]').forEach(btn => {
    btn.addEventListener('click', () => { removeCoin(btn.dataset.remove); refreshAll(); });
  });
  els.tableBody.querySelectorAll('button[data-refresh]').forEach(btn => {
    btn.addEventListener('click', () => refreshCoin(btn.dataset.refresh));
  });
  // Delete individual actions
  els.tableBody.querySelectorAll('button[data-del-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const [sym, actionId] = btn.getAttribute('data-del-action').split('|');
      deleteAction(sym, actionId);
      // Re-render full table (simpler for now) and refresh summary
      refreshAll();
    });
  });
  // Acquisition date change handlers
  els.tableBody.querySelectorAll('input[data-acq]').forEach(inp => {
    inp.addEventListener('change', async () => {
      const sym = inp.getAttribute('data-acq');
      const port = getPortfolio();
      const entry = port.find(p => p.symbol === sym);
      if (entry) {
        updateAcquisitionDate(sym, inp.value || null);
        // Invalidate historical cache for that symbol & re-fetch just that row
        const row = latestRows.find(r => r.symbol === sym);
        if (row) {
          row.acquisitionDate = inp.value || (els.comparisonDate ? els.comparisonDate.value : defaultComparisonDate());
          row.pastPrice = null; row.statusText = '(loading)'; updateRowComputed(row);
          await refreshCoin(sym);
        }
      }
    });
  });
}

function updateRowComputed(row) {
  const tr = els.tableBody.querySelector(`tr[data-symbol="${row.symbol}"]`);
  if (!tr) return;
  const diff = (row.currentPrice ?? 0) - (row.pastPrice ?? 0);
  const pct = row.pastPrice ? (diff / row.pastPrice) * 100 : 0;
  const diffCls = row.currentPrice != null && row.pastPrice != null ? (diff >= 0 ? 'text-bull' : 'text-bear') : '';
  const currentCell = tr.querySelector('[data-cell="currentPrice"]');
  const pastCell = tr.querySelector('[data-cell="pastPrice"]');
  const diffCell = tr.querySelector('[data-cell="diff"]');
  const pctCell = tr.querySelector('[data-cell="pct"]');
  const statusCell = tr.querySelector('[data-cell="status"]');
  if (currentCell) currentCell.textContent = row.currentPrice != null ? '€' + row.currentPrice : '—';
  if (pastCell) pastCell.textContent = row.pastPrice != null ? '€' + formatDisplayPrice(row.pastPrice) : '—';
  if (diffCell) { diffCell.className = `px-4 py-2 text-right ${diffCls}`; diffCell.textContent = (row.currentPrice != null && row.pastPrice != null) ? (diff >= 0 ? '+' : '') + '€' + diff.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}) : '—'; }
  if (pctCell) { pctCell.className = `px-4 py-2 text-right ${diffCls}`; pctCell.textContent = (row.currentPrice != null && row.pastPrice != null) ? (diff >= 0 ? '+' : '') + pct.toFixed(2) + '%' : '—'; }
  if (statusCell) statusCell.textContent = row.statusText;
}

function finalizeSummary(rows) {
  renderSummary(rows.map(r => ({ currentValue: (r.currentPrice || 0) * r.quantity, pastValue: (r.pastPrice || 0) * r.quantity })));
}

function quickChartFromRows(rows) {
  if (!rows.length) return { labels: [], values: [] };
  // Use earliest acquisition date across rows as the historical comparison point
  const earliest = rows.reduce((min, r) => (r.acquisitionDate && r.acquisitionDate < min ? r.acquisitionDate : min), rows[0].acquisitionDate);
  const today = new Date().toISOString().slice(0,10);
  let pastTotal = 0;
  let currentTotal = 0;
  for (const r of rows) {
    if (r.pastPrice != null) pastTotal += r.pastPrice * r.quantity;
    if (r.currentPrice != null) currentTotal += r.currentPrice * r.quantity;
  }
  if (pastTotal === 0 && currentTotal === 0) return { labels: [], values: [] };
  return { labels: [earliest, today], values: [Number(pastTotal.toFixed(2)), Number(currentTotal.toFixed(2))] };
}

async function refreshAll() {
  const portfolio = getPortfolio();
  if (!portfolio.length) { renderTable([]); finalizeSummary([]); updateChart({ labels: [], values: [] }); return; }
  // Attempt to backfill missing action prices (non-blocking render after)
  backfillMissingActionPrices().then(updated => { if (updated) { refreshAll(); } });
  const defaultAcq = els.comparisonDate ? els.comparisonDate.value : defaultComparisonDate();
  clearMiniCharts();
  const rows = [];
  for (const { symbol, quantity, addedAt, addedPrice, acquisitionDate } of portfolio) {
    const acq = acquisitionDate || defaultAcq;
    const cachedCurr = getCachedCurrent(symbol);
    const cachedHist = getCachedHistorical(symbol, acq);
    const statusText = (cachedCurr && cachedHist) ? `up to date (${hoursAgo(Math.min(cachedCurr.ts, cachedHist.ts))}h ago)` : '(loading)';
    rows.push({ symbol, quantity, addedAt, addedPrice, acquisitionDate: acq, currentPrice: cachedCurr?.price ?? null, pastPrice: cachedHist?.price ?? null, statusText, needsFetch: !(cachedCurr && cachedHist) });
  }
  latestRows = rows;
  renderTable(rows);
  finalizeSummary(rows);
  // Provide immediate provisional chart using any cached data
  const provisional = quickChartFromRows(rows);
  if (provisional.labels.length) updateChart(provisional);
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row.needsFetch) continue;
    let error = false;
    // 1. Current price
    try {
      const curr = await fetchCurrentPrices([row.symbol]);
      if (curr[row.symbol] != null) { row.currentPrice = curr[row.symbol]; setCachedCurrent(row.symbol, row.currentPrice); }
    } catch (e) { error = true; handleApiError(e, `Current price failed for ${row.symbol}`); }
    if (settings.perCallDelayMs > 0) await sleep(settings.perCallDelayMs);
    // 2. Historical price
    try {
      const past = await fetchHistoricalPrice(row.symbol, row.acquisitionDate);
      if (past != null) { row.pastPrice = past; setCachedHistorical(row.symbol, row.acquisitionDate, row.pastPrice); }
    } catch (e) { error = true; handleApiError(e, `Historical price failed for ${row.symbol}`); }
    row.statusText = error ? 'error' : `up to date (${hoursAgo(Date.now())}h ago)`;
    row.needsFetch = false;
    updateRowComputed(row);
    finalizeSummary(rows);
    const provisional2 = quickChartFromRows(rows);
    if (provisional2.labels.length) updateChart(provisional2);
    if (settings.perCallDelayMs > 0 && i < rows.length - 1) await sleep(settings.perCallDelayMs);
  }
  const earliest = rows.reduce((min, r) => (r.acquisitionDate && r.acquisitionDate < min ? r.acquisitionDate : min), rows[0].acquisitionDate);
  if (settings.perCallDelayMs > 0) await sleep(settings.perCallDelayMs);
  try { const timeline = await fetchPortfolioTimeline(portfolio, earliest); updateChart(timeline); } catch (e) { handleApiError(e, 'Timeline fetch failed'); }
  if (settings.perCallDelayMs > 0) await sleep(settings.perCallDelayMs);
  try { await renderMiniChartsForPortfolio(portfolio, earliest); } catch (e) { console.warn('Mini charts batch failed', e); }
  // Finally update analytics performance chart
  try { refreshAnalytics(); } catch (e) { console.warn('Analytics refresh failed', e); }
  try { refreshAllocationChart(latestRows); } catch (e) { console.warn('Allocation chart refresh failed', e); }
  try { refreshHistorySnapshots(); } catch (e) { console.warn('History snapshots refresh failed', e); }
}

async function refreshCoin(symbol) {
  // per-row acquisition date
  const row = latestRows.find(r => r.symbol === symbol);
  if (!row) return;
  // Force refresh: mark status loading and fetch ignoring freshness
  row.statusText = '(loading)';
  updateRowComputed(row);
  // Small delay to respect pacing
  if (settings.perCallDelayMs > 0) await sleep(settings.perCallDelayMs);
  let error = false;
  try {
    const curr = await fetchCurrentPrices([row.symbol]);
    if (curr[row.symbol] != null) { row.currentPrice = curr[row.symbol]; setCachedCurrent(row.symbol, row.currentPrice); }
  } catch (e) { error = true; handleApiError(e, `Current price failed for ${row.symbol}`); }
  if (settings.perCallDelayMs > 0) await sleep(settings.perCallDelayMs);
  try {
    const past = await fetchHistoricalPrice(row.symbol, row.acquisitionDate);
    if (past != null) { row.pastPrice = past; setCachedHistorical(row.symbol, row.acquisitionDate, row.pastPrice); }
  } catch (e) { error = true; handleApiError(e, `Historical price failed for ${row.symbol}`); }
  row.statusText = error ? 'error' : `up to date (${hoursAgo(Date.now())}h ago)`;
  updateRowComputed(row);
  finalizeSummary(latestRows);
  const provisional = quickChartFromRows(latestRows);
  if (provisional.labels.length) updateChart(provisional);
  if (settings.perCallDelayMs > 0) await sleep(settings.perCallDelayMs);
  // Optionally update chart after per-coin refresh (could be throttled)
  const earliest2 = latestRows.reduce((min, r) => (r.acquisitionDate && r.acquisitionDate < min ? r.acquisitionDate : min), latestRows[0].acquisitionDate);
  try { const timeline = await fetchPortfolioTimeline(getPortfolio(), earliest2); updateChart(timeline); } catch (e) { handleApiError(e, 'Timeline fetch failed'); }
  if (settings.perCallDelayMs > 0) await sleep(settings.perCallDelayMs);
  try { await renderMiniChartsForPortfolio(getPortfolio(), earliest2); } catch (_) { /* ignore */ }
  try { refreshAnalytics(); } catch (_) { /* ignore */ }
  try { refreshAllocationChart(latestRows); } catch (_) { /* ignore */ }
  try { refreshHistorySnapshots(); } catch (_) { /* ignore */ }
}

function handleApiError(err, contextMsg) {
  const base = err?.status === 429
    ? 'Too many API calls. Wait a few minutes, then refresh the page or use Refresh All.'
    : (contextMsg || 'API request failed');
  showToast(base, 'error');
}

// ---------------------- API LOG PANEL ---------------------------
function toggleApiLogPanel() {
  if (els.apiLogPanel.classList.contains('hidden')) showApiLogPanel(); else hideApiLogPanel();
}
function showApiLogPanel() {
  els.apiLogPanel.classList.remove('hidden');
  renderApiLog();
}
function hideApiLogPanel() {
  els.apiLogPanel.classList.add('hidden');
}
function renderApiLog() {
  const log = getApiLog();
  if (!els.apiLogList) return;
  if (!log.length) { els.apiLogList.textContent = 'No API calls yet.'; return; }
  const lines = log.map(e => {
    const time = new Date(e.ts).toLocaleTimeString([], { hour12: false });
    const status = e.status === 'success' ? 'OK' : 'ERR';
    const cacheTag = e.cached ? '(cache)' : '';
    const http = e.httpStatus != null ? `[${e.httpStatus}]` : '';
    const dur = e.duration != null ? `${e.duration}ms` : '';
    const urlShort = e.url?.startsWith('http') ? e.url.replace(/^https?:\/\//,'').split('?')[0] : e.url;
    const note = e.note ? ` - ${e.note}` : (e.httpStatus === 429 ? ' - Too many calls – wait a few minutes then refresh.' : '');
    const line = `${time} ${status} ${e.type} ${http} ${cacheTag} ${dur} ${urlShort}${note}`.replace(/\s+/g,' ').trim();
    const statusColor = status === 'OK' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400';
    return `<div class="py-1.5 border-b border-gray-200 dark:border-gray-700 last:border-b-0 flex flex-col gap-0.5">`+
      `<div class="flex justify-between items-center"><span class="font-semibold ${statusColor}">${status}</span>`+
      `<span class="text-[10px] text-gray-500">${time}</span></div>`+
      `<div class="text-[11px] break-all">${line}</div>`+
      `</div>`;
  });
  els.apiLogList.classList.remove('whitespace-pre-wrap');
  els.apiLogList.innerHTML = lines.join('');
}
// Force Reload: Clear all caches (price, coin list, market chart) and re-fetch everything fresh
function forceReload() {
  if (!confirm('Force reload will clear all cached data (prices, coin list, charts). Your portfolio holdings (quantities & symbols) will NOT be deleted. Continue?')) return;
  // Clear in-memory price cache
  priceCache = {};
  savePriceCache(priceCache);
  // Clear persistent coin list & market chart caches
  saveCoinListCache({ ts: 0, data: [] });
  saveMarketChartCache({});
  showToast('Caches cleared (holdings kept). Reloading fresh data…', 'warn');
  refreshAll();
}

// ---------------------- SETTINGS PANEL ---------------------------
function toggleSettingsPanel() { if (els.settingsPanel?.classList.contains('hidden')) showSettingsPanel(); else hideSettingsPanel(); }
function showSettingsPanel() { if (els.settingsPanel) els.settingsPanel.classList.remove('hidden'); }
function hideSettingsPanel() { if (els.settingsPanel) els.settingsPanel.classList.add('hidden'); }

function initUI() {
  initDOMRefs();
  initTheme();
  initSettings();
  initDate();
  initAddCoinForm();
  initControls();
  // Populate list after DOM & toggles set; popularOnly may be default checked
  populateCoinDatalist();
  priceCache = loadPriceCache();
  // Initialize analytics module after DOM refs are ready
  try { initAnalytics(); } catch (e) { console.warn('Init analytics failed', e); }
  try { initHistorySnapshots(); } catch (e) { console.warn('Init history snapshots failed', e); }
}

export { initUI, refreshAll };
