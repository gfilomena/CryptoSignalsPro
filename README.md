# CryptoSignals Pro (standalone)

SPA **React + Vite** alla root del repo. Il vecchio monolite HTML è in [`legacy/index.html`](legacy/index.html).

## Sviluppo

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

Output in `dist/`. Su **Vercel** collega il repo: root = progetto Vite (nessuna subdirectory). Variabili: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (vedi `.env.example`).

## Struttura

- `src/` – app React, componenti, `lib/` (indicatori, mercato, grafico, …)
- `backtest/` – preset e motore simulazione backtest
- `supabase/` – edge functions e migrazioni
- `legacy/` – monolite HTML storico
