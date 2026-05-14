import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

    const body = await req.json();
    const action = body.action;

    if (action === 'start') {
      const { data: existing } = await sb.from('bot_sessions')
        .select('id').eq('status', 'running').limit(1);
      if (existing && existing.length > 0) {
        return new Response(JSON.stringify({ ok: false, reason: 'session_already_running', session_id: existing[0].id }), { headers: corsHeaders });
      }

      const { data: cfgRow } = await sb.from('bot_config').select('*').limit(1).single();
      if (!cfgRow) {
        return new Response(JSON.stringify({ ok: false, reason: 'no_config' }), { headers: corsHeaders });
      }

      const { data: session, error } = await sb.from('bot_sessions').insert({
        initial_capital: cfgRow.initial_capital,
        currency: cfgRow.currency,
        status: 'running',
        config_snapshot: cfgRow
      }).select().single();

      if (error) {
        return new Response(JSON.stringify({ ok: false, error: error.message }), { headers: corsHeaders, status: 500 });
      }

      return new Response(JSON.stringify({ ok: true, action: 'started', session }), { headers: corsHeaders });

    } else if (action === 'stop') {
      const { data: sessions } = await sb.from('bot_sessions')
        .select('*').eq('status', 'running').limit(1);
      if (!sessions || sessions.length === 0) {
        return new Response(JSON.stringify({ ok: false, reason: 'no_running_session' }), { headers: corsHeaders });
      }
      const session = sessions[0];

      const { data: openTrades } = await sb.from('bot_trades')
        .select('*').eq('session_id', session.id).eq('status', 'open');

      const { data: latestSnap } = await sb.from('market_snapshots')
        .select('data').order('created_at', { ascending: false }).limit(1).single();
      const snapData = latestSnap?.data || {};

      let totalPnl = 0;
      if (openTrades) {
        for (const trade of openTrades) {
          const md = (snapData as Record<string, any>)[trade.symbol];
          const price = md ? md.price : trade.entry_price;
          const pnl = trade.direction === 'long'
            ? (price - Number(trade.entry_price)) * Number(trade.quantity)
            : (Number(trade.entry_price) - price) * Number(trade.quantity);
          const pnlPct = trade.direction === 'long'
            ? ((price - Number(trade.entry_price)) / Number(trade.entry_price)) * 100
            : ((Number(trade.entry_price) - price) / Number(trade.entry_price)) * 100;
          totalPnl += pnl;
          await sb.from('bot_trades').update({
            exit_price: price,
            exit_time: new Date().toISOString(),
            pnl, pnl_percent: pnlPct,
            exit_reason: 'manual_stop',
            status: 'closed'
          }).eq('id', trade.id);
        }
      }

      const { data: allClosed } = await sb.from('bot_trades')
        .select('pnl').eq('session_id', session.id).eq('status', 'closed');
      const finalPnl = (allClosed || []).reduce((s: number, t: any) => s + (Number(t.pnl) || 0), 0);

      await sb.from('bot_sessions').update({
        ended_at: new Date().toISOString(),
        status: 'completed',
        final_pnl: finalPnl
      }).eq('id', session.id);

      return new Response(JSON.stringify({ ok: true, action: 'stopped', final_pnl: finalPnl }), { headers: corsHeaders });

    } else {
      return new Response(JSON.stringify({ ok: false, reason: 'invalid_action' }), { headers: corsHeaders, status: 400 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      status: 500
    });
  }
});
