CREATE TABLE IF NOT EXISTS bot_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  initial_capital numeric NOT NULL DEFAULT 10000,
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'running',
  final_pnl numeric
);

CREATE TABLE IF NOT EXISTS bot_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES bot_sessions(id) ON DELETE CASCADE,
  symbol text NOT NULL,
  direction text NOT NULL,
  entry_price numeric NOT NULL,
  entry_time timestamptz NOT NULL DEFAULT now(),
  exit_price numeric,
  exit_time timestamptz,
  quantity numeric NOT NULL,
  pnl numeric,
  pnl_percent numeric,
  exit_reason text,
  entry_score integer,
  entry_confidence integer,
  status text NOT NULL DEFAULT 'open'
);

ALTER TABLE bot_sessions DISABLE ROW LEVEL SECURITY;
ALTER TABLE bot_trades DISABLE ROW LEVEL SECURITY;
