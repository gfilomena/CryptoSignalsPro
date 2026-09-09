# CryptoSignals Pro

Standalone **React + Vite** SPA at the repo root. The older single-file HTML version lives in [`legacy/index.html`](legacy/index.html).

## Features

- **Live market overview** — Curated crypto list with prices and volumes from **Binance**, refreshed about every 30 seconds.
- **Multi-currency** — Display in **USD**, **EUR**, or **CHF** (CHF uses a fetched FX rate).
- **Fear & Greed index** — Global sentiment from Alternative.me, shown in the dashboard.
- **Whale activity** — Large-transfer alerts via the **Supabase** `whale-proxy` edge function (optional; requires Supabase env). Sentiment is merged into the market grid when configured.
- **Strategy backtesting** — In-browser simulation: presets, custom date ranges, tunable thresholds, weighted indicators (EMA, RSI divergence, MACD, Bollinger, OBV, ATR, etc.), progress, stats, and an **equity curve** preview.
- **Asset detail** — After selecting an asset: multi-timeframe **price chart**, indicator cards (e.g. RSI, MACD-related signals), and formatted volume/price for the chosen currency.
- **Scalping signal engine (BTC/USDT)** — Rule-based multi-timeframe engine (15m regime + 5m breakout/pullback/confirmation) producing concrete entry/stop/TP1/TP2, position sizing from a fixed risk %, a daily loss/trade limit, a weighted confidence score, and an explicit signal state machine (`NO_TRADE → WATCH → *_SETUP → *_CONFIRMED → TRADE_ACTIVE → TARGET_HIT/STOP_HIT`). Generates **alerts only** — it never places real orders. See `src/lib/scalp/`.
- **PWA + iPhone push notifications** — Installable app (manifest + service worker, `vite-plugin-pwa`) with Web Push alerts for the signal engine. See [Notifications setup](#notifications--iphone-push-setup) below.
- **Paper trading & signal history** — Every CONFIRMED signal opens a virtual trade (fee/spread/slippage-aware); results and aggregate stats (win rate, profit factor, expectancy, max drawdown…) are shown in the dashboard.
- **Internationalization** — UI strings in **English**, **Italian**, and **Spanish** (`src/i18n/`).
- **Backend (optional)** — `supabase/` holds Edge Functions (`market-data`, `whale-proxy`, bot helpers, `signal-cycle`, `signal-data`, `push-subscribe`, `push-test`) and SQL migrations for cron and bot/signal-related tables.

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
| `VITE_VAPID_PUBLIC_KEY` | VAPID public key for Web Push (safe to expose client-side). Required to enable notifications. |

If these are missing, the app still runs; whale-related features and push notifications stay inactive — the scalping signal card still works, computed client-side from Binance data. For local Supabase work, see `supabase/.env.example`.

## Notifications / iPhone push setup

Push notifications need three things: the Supabase backend deployed, a VAPID key pair, and — on
iPhone specifically — the app installed to the Home Screen (Apple requires this before a PWA can
ask for notification permission at all).

1. **Apply the migrations and deploy the new Edge Functions**
   ```bash
   supabase db push
   supabase functions deploy signal-cycle signal-data push-subscribe push-test --no-verify-jwt
   ```
   Then schedule `signal-cycle` (every 1 minute) the same way `bot-cycle` is scheduled — see
   `supabase/migrations/20260909090100_schedule_signal_cycle.sql` (fill in your project ref and
   anon key).

2. **Generate a VAPID key pair** (one-time; do this on your machine, not in the repo):
   ```bash
   npx web-push generate-vapid-keys
   ```
   This prints a public and a private key.

3. **Store the keys as Supabase secrets** (server-side, used by `signal-cycle`/`push-test` to sign
   pushes — never commit these):
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=<public key>
   supabase secrets set VAPID_PRIVATE_KEY=<private key>
   supabase secrets set VAPID_SUBJECT=mailto:you@example.com
   ```

4. **Expose the public key to the frontend** by setting `VITE_VAPID_PUBLIC_KEY=<public key>` in
   your `.env` / Vercel project settings (same value as `VAPID_PUBLIC_KEY` above — it's public by
   design) and redeploy the app.

5. **On iPhone**: open the app in Safari → Share → **Add to Home Screen** → open it from the Home
   Screen icon (not the Safari tab). Then, in the app, open **Setup → iPhone / push notifications**
   and tap **Enable Notifications**. Requires iOS 16.4+.

6. Use **Test Notification** in the same panel to confirm delivery end to end.

## Repository layout

- `src/` — React app, components, `lib/` (indicators, market data, charts, whales, …)
- `backtest/` — Backtest presets and simulation engine
- `supabase/` — Edge functions and database migrations
- `legacy/` — Historical HTML monolith
