import { SUPABASE_ANON_KEY, SUPABASE_URL, hasSupabaseConfig } from '../../config/env'
import type { StrategyConfig } from '../../config/strategyConfig'

/**
 * Best-effort push of the user's strategy/risk parameters to the scalp_config singleton row, so
 * the server-side signal-cycle (which drives push notifications) uses the same settings as the
 * dashboard. Silently no-ops when Supabase isn't configured or the request fails — the local
 * (localStorage) config always remains the source of truth for the UI itself.
 */
export async function syncConfigToServer(config: StrategyConfig): Promise<void> {
  if (!hasSupabaseConfig) return
  try {
    await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/scalp_config?id=not.is.null`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ config, updated_at: new Date().toISOString() }),
    })
  } catch {
    /* best-effort only */
  }
}
