// Read-only endpoint for the frontend: current signal snapshot, alert history, paper trades and
// aggregate paper-trading stats for one symbol. Mirrors the response shape expected by
// src/lib/scalp/signalClient.ts (camelCase, matching src/types/scalpSignal.ts).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

function mapAlert(row: Record<string, unknown>) {
  return {
    id: row.id, symbol: row.symbol, timeframe: row.timeframe, type: row.type, state: row.state,
    direction: row.direction, entryPrice: row.entry_price != null ? Number(row.entry_price) : undefined,
    stopLoss: row.stop_loss != null ? Number(row.stop_loss) : undefined,
    takeProfit1: row.take_profit_1 != null ? Number(row.take_profit_1) : undefined,
    takeProfit2: row.take_profit_2 != null ? Number(row.take_profit_2) : undefined,
    riskAmount: row.risk_amount != null ? Number(row.risk_amount) : undefined,
    rewardAmount: row.reward_amount != null ? Number(row.reward_amount) : undefined,
    riskRewardRatio: row.risk_reward_ratio != null ? Number(row.risk_reward_ratio) : undefined,
    confidence: row.confidence, capitalCurrency: row.capital_currency, reasons: row.reasons ?? [],
    timestamp: new Date(row.created_at as string).getTime(),
  };
}

function mapPaperTrade(row: Record<string, unknown>) {
  return {
    id: row.id, symbol: row.symbol, direction: row.direction, entryPrice: Number(row.entry_price),
    stopLoss: Number(row.stop_loss), takeProfit1: Number(row.take_profit_1), takeProfit2: Number(row.take_profit_2),
    positionSize: Number(row.position_size), riskAmount: Number(row.risk_amount), confidence: row.confidence,
    capitalCurrency: row.capital_currency, openedAt: new Date(row.opened_at as string).getTime(),
    closedAt: row.closed_at ? new Date(row.closed_at as string).getTime() : undefined,
    exitPrice: row.exit_price != null ? Number(row.exit_price) : undefined,
    result: row.result, pnl: row.pnl != null ? Number(row.pnl) : undefined,
    pnlR: row.pnl_r != null ? Number(row.pnl_r) : undefined, costPct: Number(row.cost_pct ?? 0),
  };
}

type MappedPaperTrade = ReturnType<typeof mapPaperTrade>;

function computePaperStats(trades: MappedPaperTrade[]) {
  const closed = trades.filter((t) => t.result !== "OPEN");
  const wins = closed.filter((t) => (t.pnl ?? 0) > 0);
  const losses = closed.filter((t) => (t.pnl ?? 0) <= 0);
  const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const grossWin = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));
  const winRate = closed.length ? (wins.length / closed.length) * 100 : 0;
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Number.POSITIVE_INFINITY : 0;
  const expectancy = closed.length ? totalPnl / closed.length : 0;
  const avgRR = closed.length ? closed.reduce((s, t) => s + (t.pnlR ?? 0), 0) / closed.length : 0;
  const ordered = [...closed].sort((a, b) => (a.closedAt ?? 0) - (b.closedAt ?? 0));
  let equity = 0, peak = 0, maxDrawdown = 0;
  for (const t of ordered) { equity += t.pnl ?? 0; if (equity > peak) peak = equity; const dd = peak - equity; if (dd > maxDrawdown) maxDrawdown = dd; }
  return { totalTrades: closed.length, wins: wins.length, losses: losses.length, winRate, profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0, avgWin, avgLoss, expectancy, maxDrawdown, totalPnl, avgRR };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey" } });
  }
  const corsHeaders = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);

    const url = new URL(req.url);
    const symbol = url.searchParams.get("symbol") || "BTC";

    const { data: stateRow } = await sb.from("scalp_signal_state").select("*").eq("symbol", symbol).maybeSingle();
    const { data: alertRows } = await sb.from("scalp_alerts").select("*").eq("symbol", symbol).order("created_at", { ascending: false }).limit(100);
    const { data: tradeRows } = await sb.from("scalp_paper_trades").select("*").eq("symbol", symbol).order("opened_at", { ascending: false }).limit(500);

    const alerts = (alertRows || []).map(mapAlert);
    const paperTrades = (tradeRows || []).map(mapPaperTrade);

    const snapshot = stateRow
      ? {
          symbol: stateRow.symbol, state: stateRow.state, regime: stateRow.regime, setup: stateRow.setup,
          risk: stateRow.risk, confidence: stateRow.confidence, dailyRisk: stateRow.daily_risk,
          lastAlert: stateRow.last_alert, updatedAt: new Date(stateRow.updated_at).getTime(),
        }
      : { symbol, state: "NO_TRADE", regime: "neutral", setup: null, risk: null, confidence: null, dailyRisk: { locked: false, tradesToday: 0, lossRToday: 0, dayKey: "" }, lastAlert: null, updatedAt: Date.now() };

    return new Response(JSON.stringify({ ok: true, snapshot, alerts, paperTrades, paperStats: computePaperStats(paperTrades) }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), { headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, status: 500 });
  }
});
