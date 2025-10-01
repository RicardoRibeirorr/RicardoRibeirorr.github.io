# Crypto Portfolio Tracker

Simple client-side crypto portfolio tracker using the CoinGecko API, TailwindCSS, and Chart.js. No backend required.

## Features

- Add / remove coins by symbol (BTC, ETH, SOL, etc.) via searchable datalist
- Specify quantity per coin (default 1)
- Pick a historical comparison date (defaults to 30 days ago)
- Shows current EUR price, historical EUR price, absolute and percentage change
- Colors gains green, losses red
- Aggregated portfolio summary (current value, value on date, change)
- Line chart of portfolio total value from comparison date to today
- Built-in 1 second sequential delay for per-coin historical/chart API calls to mitigate 429 rate limits
- Dark mode toggle (saved in localStorage)
- Portfolio & selected date persist via localStorage

## Tech Stack

- TailwindCSS (CDN) for rapid styling & dark mode
- Chart.js for the time-series chart
- CoinGecko public API for market data
- Vanilla JavaScript ES Modules split into logical files (`api`, `storage`, `portfolio`, `ui`, `chart`, `main`)

## Project Structure

```
index.html
src/
  js/
    api.js          # CoinGecko API helpers & caching
    storage.js      # localStorage persistence
    portfolio.js    # Portfolio state manipulation
    ui.js           # DOM event wiring + table & summary rendering
    chart.js        # Chart.js setup & updating
    main.js         # App bootstrap
```

## Running

Just open `index.html` in a modern browser (Chrome, Firefox, Edge). If loading local ES modules is blocked, serve with a tiny dev server (examples below).

### Optional Local Server (Node)

Using PowerShell (Windows):

```
npx serve .
```

Or Python 3:

```
python -m http.server 8080
```

Then navigate to: http://localhost:8080

## Notes & Limits

- CoinGecko free tier has rate limits; many coins + frequent refreshes may hit them.
- Historical prices use the `/history` endpoint (one per coin) and daily chart uses `/market_chart` with `interval=daily` for efficiency.
- Portfolio timeline assumes 1 data point per day; quantities are constant over the period.
- Duplicate symbols update the existing entry instead of creating a new one.
- Snapshot of price & timestamp stored when a coin is first added (tooltip on coin cell)

## Possible Enhancements

- Quantity editing inline in the table
- Support for fiat conversion selection (USD, GBP, etc.)
- Caching coin list in localStorage with TTL
- Batch concurrency / queue to respect rate limits
- Export / import portfolio JSON
- PWA + offline caching of last snapshot

## Disclaimer

Market data may be delayed or inaccurate. Not investment advice.

---
Enjoy tracking! 🚀
