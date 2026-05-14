export const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string) || ''
export const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || ''

export const hasSupabaseConfig = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY)

export const EDGE_FN_URL = SUPABASE_URL ? `${SUPABASE_URL.replace(/\/$/, '')}/functions/v1` : ''
