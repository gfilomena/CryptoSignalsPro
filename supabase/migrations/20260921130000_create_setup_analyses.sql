-- Market Setup Analyzer: one row per manual "Analyze Setup" press. `data` holds the full record (snapshot, market-state
-- vector, parameters, historical sample sizes/probabilities, strength, engine state) and is later updated with the
-- realised outcomes (+5m … +24h). Same anon-managed pattern as smart_alerts (no login in this app).
CREATE TABLE IF NOT EXISTS public.setup_analyses (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  data jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_setup_analyses_created_at ON public.setup_analyses (created_at DESC);

ALTER TABLE public.setup_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_read_setup_analyses" ON public.setup_analyses FOR SELECT TO anon USING (true);
CREATE POLICY "anon_insert_setup_analyses" ON public.setup_analyses FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_update_setup_analyses" ON public.setup_analyses FOR UPDATE TO anon USING (true) WITH CHECK (true);
CREATE POLICY "service_all_setup_analyses" ON public.setup_analyses FOR ALL TO service_role USING (true) WITH CHECK (true);
