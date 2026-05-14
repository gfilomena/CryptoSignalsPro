import { EDGE_FN_URL, SUPABASE_ANON_KEY, hasSupabaseConfig } from './env'

export { EDGE_FN_URL, SUPABASE_ANON_KEY, hasSupabaseConfig } from './env'

/** Headers for Supabase Edge Functions (anon key) */
export function edgeHeaders(json = false): HeadersInit {
  const h: Record<string, string> = { apikey: SUPABASE_ANON_KEY }
  if (json) h['Content-Type'] = 'application/json'
  return h
}

export async function edgeFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!hasSupabaseConfig) throw new Error('Supabase non configurato: imposta VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY')
  const headers = new Headers(init.headers)
  if (!headers.has('apikey')) headers.set('apikey', SUPABASE_ANON_KEY)
  return fetch(`${EDGE_FN_URL}${path}`, { ...init, headers })
}
