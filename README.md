# CryptoSignals Pro

Standalone **React + Vite** SPA at the repo root. The older single-file HTML version lives in [`legacy/index.html`](legacy/index.html).

## Features

- **Live market overview** — Curated crypto list with prices and volumes from **Binance**, refreshed about every 30 seconds.
- **Multi-currency** — Display in **USD**, **EUR**, or **CHF** (CHF uses a fetched FX rate).
- **Fear & Greed index** — Global sentiment from Alternative.me, shown in the dashboard.
- **Whale activity** — Large-transfer alerts via the **Supabase** `whale-proxy` edge function (optional; requires Supabase env). Sentiment is merged into the market grid when configured.
- **Strategy backtesting** — In-browser simulation: presets, custom date ranges, tunable thresholds, weighted indicators (EMA, RSI divergence, MACD, Bollinger, OBV, ATR, etc.), progress, stats, and an **equity curve** preview.
- **Asset detail** — After selecting an asset: multi-timeframe **price chart**, indicator cards (e.g. RSI, MACD-related signals), and formatted volume/price for the chosen currency.
- **Internationalization** — UI strings in **English**, **Italian**, and **Spanish** (`src/i18n/`).
- **Backend (optional)** — `supabase/` holds Edge Functions (`market-data`, `whale-proxy`, bot helpers) and SQL migrations for cron and bot-related tables.

## Development

```bash
npm install
npm run dev
```

Requires **Node.js ≥ 18**.

## Build

```bash
npm run build
```

Output: `dist/`. On **Vercel**, connect this repo with the project root as the Vite app (no subdirectory).

### Environment variables (frontend)

Set in Vercel or a local `.env`:

| Variable | Purpose |
|----------|---------|
| `VITE_SUPABASE_URL` | Supabase project URL (enables whale proxy and other edge calls from the app) |
| `VITE_SUPABASE_ANON_KEY` | Supabase anon (public) key |

If these are missing, the app still runs; whale-related features stay inactive. For local Supabase work, see `supabase/.env.example`.

## Repository layout

- `src/` — React app, components, `lib/` (indicators, market data, charts, whales, …)
- `backtest/` — Backtest presets and simulation engine
- `supabase/` — Edge functions and database migrations
- `legacy/` — Historical HTML monolith
