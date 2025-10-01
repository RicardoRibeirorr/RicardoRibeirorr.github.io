// chart.js - chart initialization and updates

let chartInstance = null;

function initChart(ctx) {
  if (chartInstance) return chartInstance;
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Portfolio Value (EUR)',
            data: [],
            borderColor: 'rgb(99 102 241)',
            backgroundColor: 'rgba(99,102,241,0.15)',
            tension: 0.25,
            pointRadius: 0,
            fill: true,
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: true },
        tooltip: { callbacks: { label: (ctx) => `€${ctx.parsed.y.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}` } }
      },
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: true } },
        y: { beginAtZero: false }
      }
    }
  });
  return chartInstance;
}

function updateChart(timeline) {
  if (!chartInstance) return;
  chartInstance.data.labels = timeline.labels;
  chartInstance.data.datasets[0].data = timeline.values;
  chartInstance.update();
}

export { initChart, updateChart };
