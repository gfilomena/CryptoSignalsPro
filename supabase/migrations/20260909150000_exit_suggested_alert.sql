-- EXIT_SUGGESTED alert: a discretionary "consider closing early" heads-up while a paper trade is
-- still open, fired at most once per open position. exit_suggested is the dedup flag that
-- signal-cycle checks before evaluating the reversal signal again.
ALTER TABLE public.scalp_paper_trades
  ADD COLUMN IF NOT EXISTS exit_suggested boolean NOT NULL DEFAULT false;
