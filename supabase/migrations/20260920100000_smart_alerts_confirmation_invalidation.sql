-- Adds multi-cycle confirmation (dampens a single noisy tick from firing an alert) and
-- invalidation tracking (tells the user when a fired alert's conditions no longer hold) to Smart
-- Alerts. See src/lib/smartAlerts/conditionEngine.ts's processAlert for the evaluation logic this
-- state supports.

ALTER TABLE public.smart_alerts
  ADD COLUMN IF NOT EXISTS confirmation_cycles integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS pending_match_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_invalidated_at timestamptz;

-- 'triggered' (conditions matched) or 'invalidated' (a fired alert's conditions no longer hold).
-- Existing rows predate this column and have no kind recorded — the app treats a null kind as
-- 'triggered' (see historyFromRow in src/lib/smartAlerts/api.ts), so no backfill is required.
ALTER TABLE public.smart_alert_events
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'triggered';
