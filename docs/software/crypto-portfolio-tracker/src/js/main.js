// main.js - entry point

import { initUI, refreshAll } from './ui.js';
import { initChart } from './chart.js';
import { showToast } from './toast.js';

window.addEventListener('DOMContentLoaded', async () => {
  initUI();
  const ctx = document.getElementById('portfolioChart').getContext('2d');
  initChart(ctx);
  showToast('Loading portfolio…', 'info', { ttl: 4000 });
  const start = performance.now();
  try {
    await refreshAll();
    const ms = Math.round(performance.now() - start);
    showToast(`Portfolio loaded (${ms} ms)`, 'success', { ttl: 6000 });
  } catch (e) {
    showToast('Initial load failed', 'error');
  }
});
