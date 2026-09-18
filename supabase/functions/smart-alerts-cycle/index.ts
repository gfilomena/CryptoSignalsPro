// Scheduled (pg_cron, every 1 minute) Smart Alerts evaluator. Mirrors the pure logic in
// src/lib/smartAlerts/{conditionEngine,marketData,notificationCopy}.ts 1:1 — duplicated here
// rather than imported because Deno Edge Functions don't bundle the Vite app's src/ (same pattern
// already used by signal-cycle for the scalp engine). This function NEVER places a real order and
// NEVER labels anything BUY/SELL — Smart Alerts are informational monitoring alerts only.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// ---------------------------------------------------------------------------
// Types (ported from src/types/smartAlert.ts)
// ---------------------------------------------------------------------------
type AlertMetric =
  | "PRICE" | "PRICE_CHANGE" | "OPEN_INTEREST" | "OPEN_INTEREST_CHANGE" | "FUNDING_RATE"
  | "VOLUME" | "VOLUME_CHANGE" | "RSI" | "LONG_LIQUIDATIONS" | "SHORT_LIQUIDATIONS" | "LIQUIDATION_SPIKE";
type ConditionOperator = ">" | ">=" | "<" | "<=" | "==";
type MetricTimeframe = "5m" | "15m" | "1h" | "4h";
const METRIC_TIMEFRAMES: MetricTimeframe[] = ["5m", "15m", "1h", "4h"];

interface AlertCondition { id: string; metric: AlertMetric; timeframe?: MetricTimeframe; operator: ConditionOperator; threshold: number; enabled: boolean }

interface MetricSnapshot {
  symbol: string; timestamp: number; price: number | null; priceChangePct: number | null;
  openInterest: number | null; openInterestChangePct: Partial<Record<MetricTimeframe, number | null>>;
  fundingRate: number | null; volume: number | null; volumeChangePct: Partial<Record<MetricTimeframe, number | null>>;
  rsi: Partial<Record<MetricTimeframe, number | null>>;
  longLiquidations: number | null; shortLiquidations: number | null; liquidationSpike: boolean | null;
}

interface SmartAlertRow {
  id: string; name: string; category: string; symbol: string; mode: string; session_duration: string | null;
  enabled: boolean; conditions: AlertCondition[]; operator: "AND" | "OR"; cooldown_ms: number; push_enabled: boolean;
  created_at: string; expires_at: string | null; last_triggered_at: string | null; session_expired: boolean;
}

// ---------------------------------------------------------------------------
// Indicators (ported from src/lib/indicators.ts — only what's needed here)
// ---------------------------------------------------------------------------
function calculateRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change; else losses -= change;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

// ---------------------------------------------------------------------------
// Binance Futures market data (ported from src/lib/smartAlerts/marketData.ts)
// ---------------------------------------------------------------------------
const FAPI_BASE = "https://fapi.binance.com";

function toFuturesPair(symbol: string): string {
  const s = symbol.toUpperCase();
  return s.endsWith("USDT") ? s : `${s}USDT`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance futures ${res.status} for ${url}`);
  return await res.json() as T;
}

async function settled<T>(p: Promise<T>): Promise<T | null> {
  try { return await p; } catch { return null; }
}

async function fetchTicker24hr(pair: string) {
  const data = await getJson<{ lastPrice: string; priceChangePercent: string; quoteVolume: string }>(`${FAPI_BASE}/fapi/v1/ticker/24hr?symbol=${pair}`);
  return { price: parseFloat(data.lastPrice), priceChangePct: parseFloat(data.priceChangePercent), volume: parseFloat(data.quoteVolume) };
}

async function fetchOpenInterest(pair: string): Promise<number> {
  const data = await getJson<{ openInterest: string }>(`${FAPI_BASE}/fapi/v1/openInterest?symbol=${pair}`);
  return parseFloat(data.openInterest);
}

async function fetchOpenInterestChangePct(pair: string, tf: MetricTimeframe): Promise<number | null> {
  const data = await getJson<{ sumOpenInterest: string; timestamp: number }[]>(`${FAPI_BASE}/futures/data/openInterestHist?symbol=${pair}&period=${tf}&limit=2`);
  if (data.length < 2) return null;
  const prev = parseFloat(data[0].sumOpenInterest), latest = parseFloat(data[data.length - 1].sumOpenInterest);
  if (!Number.isFinite(prev) || prev === 0) return null;
  return ((latest - prev) / prev) * 100;
}

async function fetchFundingRatePct(pair: string): Promise<number> {
  const data = await getJson<{ lastFundingRate: string }>(`${FAPI_BASE}/fapi/v1/premiumIndex?symbol=${pair}`);
  return parseFloat(data.lastFundingRate) * 100;
}

async function fetchFuturesCandles(pair: string, interval: string, limit: number) {
  const raw = await getJson<(string | number)[][]>(`${FAPI_BASE}/fapi/v1/klines?symbol=${pair}&interval=${interval}&limit=${limit}`);
  return raw.map((k) => ({ close: parseFloat(String(k[4])), volume: parseFloat(String(k[5])) }));
}

async function fetchRsiAt(pair: string, tf: MetricTimeframe): Promise<number | null> {
  const candles = await fetchFuturesCandles(pair, tf, 200);
  if (candles.length < 15) return null;
  return calculateRSI(candles.map((c) => c.close));
}

async function fetchVolumeChangePct(pair: string, tf: MetricTimeframe): Promise<number | null> {
  const candles = await fetchFuturesCandles(pair, tf, 3);
  if (candles.length < 3) return null;
  const closed = candles.slice(0, -1);
  const prev = closed[closed.length - 2], latest = closed[closed.length - 1];
  if (!prev || prev.volume === 0) return null;
  return ((latest.volume - prev.volume) / prev.volume) * 100;
}

// KNOWN GAP: no public REST endpoint for aggregate liquidation volume on Binance Futures (only a
// per-order websocket stream). Always unavailable until a dedicated ingestion service exists —
// see marketData.ts's module comment and the project's final report for details.
async function fetchSmartAlertSnapshot(symbol: string): Promise<MetricSnapshot> {
  const pair = toFuturesPair(symbol);
  const [ticker, openInterest, fundingRate] = await Promise.all([
    settled(fetchTicker24hr(pair)), settled(fetchOpenInterest(pair)), settled(fetchFundingRatePct(pair)),
  ]);
  const [oiEntries, rsiEntries, volEntries] = await Promise.all([
    Promise.all(METRIC_TIMEFRAMES.map(async (tf) => [tf, await settled(fetchOpenInterestChangePct(pair, tf))] as const)),
    Promise.all(METRIC_TIMEFRAMES.map(async (tf) => [tf, await settled(fetchRsiAt(pair, tf))] as const)),
    Promise.all(METRIC_TIMEFRAMES.map(async (tf) => [tf, await settled(fetchVolumeChangePct(pair, tf))] as const)),
  ]);
  return {
    symbol: symbol.toUpperCase(), timestamp: Date.now(),
    price: ticker?.price ?? null, priceChangePct: ticker?.priceChangePct ?? null,
    openInterest: openInterest ?? null, openInterestChangePct: Object.fromEntries(oiEntries),
    fundingRate: fundingRate ?? null, volume: ticker?.volume ?? null, volumeChangePct: Object.fromEntries(volEntries),
    rsi: Object.fromEntries(rsiEntries), longLiquidations: null, shortLiquidations: null, liquidationSpike: null,
  };
}

// ---------------------------------------------------------------------------
// Condition engine (ported from src/lib/smartAlerts/conditionEngine.ts — unchanged logic)
// ---------------------------------------------------------------------------
function readMetricValue(c: AlertCondition, s: MetricSnapshot): number | null {
  switch (c.metric) {
    case "PRICE": return s.price;
    case "PRICE_CHANGE": return s.priceChangePct;
    case "OPEN_INTEREST": return s.openInterest;
    case "OPEN_INTEREST_CHANGE": return c.timeframe ? (s.openInterestChangePct[c.timeframe] ?? null) : null;
    case "FUNDING_RATE": return s.fundingRate;
    case "VOLUME": return s.volume;
    case "VOLUME_CHANGE": return c.timeframe ? (s.volumeChangePct[c.timeframe] ?? null) : null;
    case "RSI": return c.timeframe ? (s.rsi[c.timeframe] ?? null) : null;
    case "LONG_LIQUIDATIONS": return s.longLiquidations;
    case "SHORT_LIQUIDATIONS": return s.shortLiquidations;
    case "LIQUIDATION_SPIKE": return s.liquidationSpike === null ? null : (s.liquidationSpike ? 1 : 0);
    default: return null;
  }
}

function compare(value: number, op: ConditionOperator, threshold: number): boolean {
  switch (op) {
    case ">": return value > threshold;
    case ">=": return value >= threshold;
    case "<": return value < threshold;
    case "<=": return value <= threshold;
    case "==": return value === threshold;
  }
}

function evaluateCondition(c: AlertCondition, s: MetricSnapshot): boolean | null {
  if (!Number.isFinite(c.threshold)) return null;
  const value = readMetricValue(c, s);
  if (value === null || !Number.isFinite(value)) return null;
  return compare(value, c.operator, c.threshold);
}

function evaluateAlert(row: SmartAlertRow, snapshot: MetricSnapshot): { triggered: boolean; matched: AlertCondition[] } {
  const enabled = row.conditions.filter((c) => c.enabled);
  if (enabled.length === 0) return { triggered: false, matched: [] };
  const matched: AlertCondition[] = [];
  let unavailable = 0;
  for (const c of enabled) {
    const result = evaluateCondition(c, snapshot);
    if (result === null) unavailable++;
    else if (result) matched.push(c);
  }
  const triggered = row.operator === "AND" ? unavailable === 0 && matched.length === enabled.length : matched.length > 0;
  return { triggered, matched };
}

// ---------------------------------------------------------------------------
// Push (ported from src/lib/smartAlerts/notificationCopy.ts + signal-cycle's sendPushToSubscribers)
// ---------------------------------------------------------------------------
function fmtPrice(v: number): string { return v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 4 : 2 }); }
function fmtPct(v: number): string { const sign = v > 0 ? "+" : ""; return `${sign}${v.toFixed(2)}%`; }

const CATEGORY_MESSAGES: Record<string, string> = {
  PRICE: "Price conditions detected", MOMENTUM: "Momentum conditions detected",
  HIGH_LEVERAGE: "High leverage conditions detected", FUNDING: "Funding conditions detected",
  OPEN_INTEREST: "Open interest conditions detected", LIQUIDATION: "Liquidation activity increased",
  REVERSAL_WATCH: "Reversal Watch triggered", OVERHEATED_MARKET: "Overheated market conditions detected",
  MARKET_STRENGTH: "Market strength conditions detected", CUSTOM: "Custom alert triggered",
};

function buildPushBody(snapshot: MetricSnapshot, categoryMessage: string): string {
  const lines: string[] = [categoryMessage];
  if (snapshot.price !== null) lines.push(`Price: $${fmtPrice(snapshot.price)}`);
  if (snapshot.priceChangePct !== null) lines.push(`Price change: ${fmtPct(snapshot.priceChangePct)}`);
  for (const [tf, v] of Object.entries(snapshot.openInterestChangePct)) if (v !== null && v !== undefined) lines.push(`OI ${tf}: ${fmtPct(v)}`);
  if (snapshot.fundingRate !== null) lines.push(`Funding: ${fmtPct(snapshot.fundingRate)}`);
  for (const [tf, v] of Object.entries(snapshot.rsi)) if (v !== null && v !== undefined) lines.push(`RSI ${tf}: ${v.toFixed(0)}`);
  return lines.join("\n");
}

async function sendSmartAlertPush(sb: ReturnType<typeof createClient>, row: SmartAlertRow, snapshot: MetricSnapshot) {
  if (!row.push_enabled) return { sent: 0, reason: "push_disabled_for_alert" };
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:alerts@cryptosignalspro.app";
  if (!vapidPublic || !vapidPrivate) return { sent: 0, reason: "vapid_not_configured" };
  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const { data: subs } = await sb.from("push_subscriptions").select("*").eq("smart_alerts_enabled", true);
  if (!subs || subs.length === 0) return { sent: 0, reason: "no_subscribers" };

  const title = `${row.symbol}/USDT — ${row.name}`;
  const body = buildPushBody(snapshot, CATEGORY_MESSAGES[row.category] ?? "Alert conditions detected");
  const payload = JSON.stringify({ title, body, type: "SMART_ALERT", symbol: row.symbol, alertId: row.id, category: row.category });

  let sent = 0;
  await Promise.allSettled(subs.map(async (sub: Record<string, unknown>) => {
    const subscription = { endpoint: sub.endpoint as string, keys: { p256dh: sub.p256dh as string, auth: sub.auth as string } };
    try {
      await webpush.sendNotification(subscription, payload);
      sent++;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await sb.from("push_subscriptions").delete().eq("id", sub.id as string);
    }
  }));
  return { sent, total: subs.length };
}

// ---------------------------------------------------------------------------
// Main cycle
// ---------------------------------------------------------------------------
Deno.serve(async () => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sb = createClient(supabaseUrl, serviceKey);
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    // Auto-pause any SESSION alert whose window has elapsed — never evaluated once expired.
    await sb.from("smart_alerts").update({ enabled: false, session_expired: true, updated_at: nowIso })
      .eq("enabled", true).eq("mode", "SESSION").lte("expires_at", nowIso);

    const { data: alertRows } = await sb.from("smart_alerts").select("*").eq("enabled", true);
    const alerts = (alertRows ?? []) as SmartAlertRow[];
    if (alerts.length === 0) return new Response(JSON.stringify({ ok: true, evaluated: 0 }), { headers: { "Content-Type": "application/json" } });

    const symbols = Array.from(new Set(alerts.map((a) => a.symbol)));
    const snapshotEntries = await Promise.all(symbols.map(async (s) => [s, await fetchSmartAlertSnapshot(s)] as const));
    const snapshots = Object.fromEntries(snapshotEntries) as Record<string, MetricSnapshot>;

    const results: Record<string, unknown> = {};

    for (const row of alerts) {
      const snapshot = snapshots[row.symbol];
      if (!snapshot) continue;

      const inCooldown = row.last_triggered_at ? now - new Date(row.last_triggered_at).getTime() < row.cooldown_ms : false;
      const { triggered, matched } = evaluateAlert(row, snapshot);
      const shouldFire = triggered && !inCooldown;

      if (!shouldFire) {
        results[row.id] = { triggered, inCooldown, fired: false };
        continue;
      }

      await sb.from("smart_alert_events").insert({
        alert_id: row.id, alert_name: row.name, category: row.category, symbol: row.symbol,
        matched_conditions: matched, snapshot, created_at: nowIso, read: false,
      });
      await sb.from("smart_alerts").update({ last_triggered_at: nowIso, updated_at: nowIso }).eq("id", row.id);

      const pushResult = await sendSmartAlertPush(sb, row, snapshot);
      results[row.id] = { triggered: true, fired: true, push: pushResult };
    }

    return new Response(JSON.stringify({ ok: true, evaluated: alerts.length, results }), { headers: { "Content-Type": "application/json" }, status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), { status: 500 });
  }
});
