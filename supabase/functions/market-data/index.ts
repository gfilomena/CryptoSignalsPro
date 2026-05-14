import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey'
      }
    });
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const type = url.searchParams.get('type') || 'snapshot';

    if (type === 'snapshot') {
      const { data: snap } = await sb.from('market_snapshots')
        .select('*').order('created_at', { ascending: false }).limit(1).single();
      return new Response(JSON.stringify({ ok: true, snapshot: snap }), { headers: corsHeaders });

    } else if (type === 'stats') {
      const { data: sessions } = await sb.from('bot_sessions')
        .select('*').order('started_at', { ascending: false }).limit(1);
      const session = sessions && sessions.length > 0 ? sessions[0] : null;

      if (!session) {
        return new Response(JSON.stringify({ ok: true, session: null, open_trades: [], closed_trades: [] }), { headers: corsHeaders });
      }

      const { data: openTrades } = await sb.from('bot_trades')
        .select('*').eq('session_id', session.id).eq('status', 'open')
        .order('entry_time', { ascending: false });

      const { data: closedTrades } = await sb.from('bot_trades')
        .select('*').eq('session_id', session.id).eq('status', 'closed')
        .order('exit_time', { ascending: false });

      return new Response(JSON.stringify({
        ok: true,
        session,
        open_trades: openTrades || [],
        closed_trades: closedTrades || []
      }), { headers: corsHeaders });

    } else {
      return new Response(JSON.stringify({ ok: false, reason: 'invalid_type' }), { headers: corsHeaders, status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
