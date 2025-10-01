// main.js - entry point

import { initUI, refreshAll } from './ui.js';
import { initChart } from './chart.js';

window.addEventListener('DOMContentLoaded', () => {
  initUI();
  const ctx = document.getElementById('portfolioChart').getContext('2d');
  initChart(ctx);
  refreshAll();
});
