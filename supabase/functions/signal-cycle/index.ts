// Scheduled (pg_cron, every 1 minute) scalping signal engine for BTC/USDT (and, once enabled in
// scalp_config, ETH/SOL/BNB). Mirrors the pure logic in src/lib/scalp/*.ts 1:1 — duplicated here
// rather than imported because Deno Edge Functions don't bundle the Vite app's src/ (same
// pattern already used by bot-cycle for the indicator math). Writes the resulting state/alerts/
// paper trades to Postgres and sends Web Push notifications on every alert-worthy state change.
// This function NEVER places a real order — it only computes signals and records paper trades.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// ---------------------------------------------------------------------------
// Indicators (ported from src/lib/indicators.ts)
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

function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1];
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calculateMACD(prices: number[]): { macd: number; signal: number; histogram: number } {
  if (prices.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const k12 = 2 / 13, k26 = 2 / 27;
  let ema12 = prices.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let ema26 = prices.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  const series: number[] = [];
  for (let i = 12; i < 26; i++) ema12 = prices[i] * k12 + ema12 * (1 - k12);
  for (let i = 26; i < prices.length; i++) {
    ema12 = prices[i] * k12 + ema12 * (1 - k12);
    ema26 = prices[i] * k26 + ema26 * (1 - k26);
    series.push(ema12 - ema26);
  }
  if (series.length === 0) return { macd: 0, signal: 0, histogram: 0 };
  const macd = series[series.length - 1];
  const signalPeriod = 9;
  let signal: number;
  if (series.length < signalPeriod) signal = series.reduce((a, b) => a + b, 0) / series.length;
  else {
    const kSig = 2 / (signalPeriod + 1);
    signal = series.slice(0, signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod;
    for (let i = signalPeriod; i < series.length; i++) signal = series[i] * kSig + signal * (1 - kSig);
  }
  return { macd, signal, histogram: macd - signal };
}

function calculateATR(klines: number[][], period = 14): number {
  if (klines.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const high = klines[i][2], low = klines[i][3], prevClose = klines[i - 1][4];
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const recentTrs = trs.slice(-period);
  return recentTrs.reduce((a, b) => a + b, 0) / recentTrs.length;
}

// ---------------------------------------------------------------------------
// Candle fetch (ported from src/lib/scalp/klines.ts)
// ---------------------------------------------------------------------------
interface Candle { openTime: number; open: number; high: number; low: number; close: number; volume: number; closeTime: number }

async function fetchCandles(pair: string, interval: string, limit: number): Promise<Candle[]> {
  const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance klines ${res.status} for ${pair} ${interval}`);
  const raw = await res.json() as (string | number)[][];
  return raw.map((k) => ({
    openTime: Number(k[0]), open: parseFloat(String(k[1])), high: parseFloat(String(k[2])),
    low: parseFloat(String(k[3])), close: parseFloat(String(k[4])), volume: parseFloat(String(k[5])),
    closeTime: Number(k[6]),
  }));
}

// ---------------------------------------------------------------------------
// Strategy config (ported from src/config/strategyConfig.ts)
// ---------------------------------------------------------------------------
interface StrategyConfig {
  symbols: { symbol: string; name: string; pair: string; enabled: boolean }[];
  trendTimeframe: string; entryTimeframe: string;
  emaFast: number; emaMedium: number; emaSlow: number; rsiPeriod: number; atrPeriod: number;
  swingLookback: number; pullbackMaxBars: number; volumeConfirmMult: number;
  maxStopAtr: number; atrStopBufferMult: number;
  capital: number; capitalCurrency: string; riskPerTradePct: number; minRiskReward: number;
  maxDailyLossR: number; maxTradesPerDay: number; minSignalConfidence: number;
  confidenceWeights: { trendAlignment: number; breakoutQuality: number; pullbackQuality: number; volume: number; rsi: number; macd: number; volatility: number; riskReward: number };
  alertCooldownMs: number;
  tradingCosts: { feePct: number; spreadPct: number; slippagePct: number };
}

// ---------------------------------------------------------------------------
// Market regime (ported from src/lib/scalp/regime.ts)
// ---------------------------------------------------------------------------
type MarketRegime = "bullish" | "bearish" | "neutral";
interface RegimeResult { regime: MarketRegime; price: number; ema20: number; ema50: number; ema200: number; ema20Slope: number; ema50Slope: number }

function detectRegime(candles: Candle[], config: StrategyConfig): RegimeResult {
  const closes = candles.map((c) => c.close);
  if (closes.length < config.emaSlow + 2) {
    return { regime: "neutral", price: closes[closes.length - 1] ?? 0, ema20: 0, ema50: 0, ema200: 0, ema20Slope: 0, ema50Slope: 0 };
  }
  const price = closes[closes.length - 1];
  const prevCloses = closes.slice(0, -1);
  const ema20 = calculateEMA(closes, config.emaFast), ema20Prev = calculateEMA(prevCloses, config.emaFast);
  const ema50 = calculateEMA(closes, config.emaMedium), ema50Prev = calculateEMA(prevCloses, config.emaMedium);
  const ema200 = calculateEMA(closes, config.emaSlow);
  const ema20Slope = ema20 - ema20Prev, ema50Slope = ema50 - ema50Prev;
  const bullish = price > ema200 && ema20 > ema50 && ema20Slope > 0 && ema50Slope > 0;
  const bearish = price < ema200 && ema20 < ema50 && ema20Slope < 0 && ema50Slope < 0;
  return { regime: bullish ? "bullish" : bearish ? "bearish" : "neutral", price, ema20, ema50, ema200, ema20Slope, ema50Slope };
}

// ---------------------------------------------------------------------------
// Breakout / pullback / confirmation (ported from levels.ts + confirmation.ts)
// ---------------------------------------------------------------------------
type TradeDirection = "long" | "short";
interface BreakoutInfo { direction: TradeDirection; level: number; breakoutIndex: number; breakoutClose: number }
interface PullbackInfo { confirmed: boolean; pullbackIndex: number; retestPrice: number }
interface ConfirmationInfo { confirmed: boolean; candlestickRejection: boolean; volumeConfirmed: boolean; rsiConfirmed: boolean; macdConfirmed: boolean }

function findRecentBreakout(candles: Candle[], config: StrategyConfig, direction: TradeDirection): BreakoutInfo | null {
  const { swingLookback, pullbackMaxBars } = config;
  const n = candles.length;
  if (n < swingLookback + 1) return null;
  const searchStart = n - 1;
  const searchEnd = Math.max(swingLookback, n - 1 - pullbackMaxBars);
  for (let i = searchStart; i >= searchEnd; i--) {
    const window = candles.slice(i - swingLookback, i);
    if (window.length < swingLookback) continue;
    const c = candles[i];
    if (direction === "long") {
      const swingHigh = Math.max(...window.map((w) => w.high));
      if (c.close > swingHigh) return { direction: "long", level: swingHigh, breakoutIndex: i, breakoutClose: c.close };
    } else {
      const swingLow = Math.min(...window.map((w) => w.low));
      if (c.close < swingLow) return { direction: "short", level: swingLow, breakoutIndex: i, breakoutClose: c.close };
    }
  }
  return null;
}

function detectPullback(candles: Candle[], breakout: BreakoutInfo): PullbackInfo {
  const after = candles.slice(breakout.breakoutIndex + 1);
  if (after.length === 0) return { confirmed: false, pullbackIndex: -1, retestPrice: 0 };
  const level = breakout.level;
  let pullbackIndex = -1, retestPrice = 0;
  for (let j = 0; j < after.length; j++) {
    const c = after[j];
    if (breakout.direction === "long" && c.low <= level) { pullbackIndex = breakout.breakoutIndex + 1 + j; retestPrice = c.low; }
    else if (breakout.direction === "short" && c.high >= level) { pullbackIndex = breakout.breakoutIndex + 1 + j; retestPrice = c.high; }
  }
  if (pullbackIndex === -1) return { confirmed: false, pullbackIndex: -1, retestPrice: 0 };
  const last = candles[candles.length - 1];
  const levelHolds = breakout.direction === "long" ? last.close > level : last.close < level;
  return { confirmed: levelHolds, pullbackIndex, retestPrice };
}

function detectConfirmation(candles: Candle[], pullback: PullbackInfo, direction: TradeDirection, config: StrategyConfig): ConfirmationInfo {
  const last = candles[candles.length - 1];
  const body = Math.abs(last.close - last.open);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  const candlestickRejection = direction === "long" ? lowerWick > body && last.close >= last.open : upperWick > body && last.close <= last.open;
  const recentVolumes = candles.slice(-config.swingLookback).map((c) => c.volume);
  const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / (recentVolumes.length || 1);
  const volumeConfirmed = avgVolume > 0 && last.volume >= avgVolume * config.volumeConfirmMult;
  const closes = candles.map((c) => c.close);
  const rsi = calculateRSI(closes, config.rsiPeriod);
  const rsiConfirmed = direction === "long" ? rsi > 45 && rsi < 78 : rsi < 55 && rsi > 22;
  const macd = calculateMACD(closes);
  const macdConfirmed = direction === "long" ? macd.histogram > 0 : macd.histogram < 0;
  const confirmedCount = [candlestickRejection, volumeConfirmed, rsiConfirmed, macdConfirmed].filter(Boolean).length;
  return { confirmed: pullback.confirmed && confirmedCount >= 2, candlestickRejection, volumeConfirmed, rsiConfirmed, macdConfirmed };
}

// ---------------------------------------------------------------------------
// Strategy engine orchestrator (ported from strategyEngine.ts)
// ---------------------------------------------------------------------------
interface ScalpSetup {
  symbol: string; direction: TradeDirection; regime: MarketRegime;
  breakout: BreakoutInfo; pullback: PullbackInfo; confirmation: ConfirmationInfo;
  entryPrice: number; stopCandidate: number; atr: number; atrPct: number;
  rsi: number; macdHistogram: number; volumeRatio: number; timestamp: number;
}

function evaluateSetup(symbol: string, trendCandles: Candle[], entryCandles: Candle[], config: StrategyConfig) {
  const reasons: string[] = [];
  const regimeDetail = detectRegime(trendCandles, config);
  if (regimeDetail.regime === "neutral") { reasons.push("regime_neutral"); return { setup: null as ScalpSetup | null, regime: "neutral" as MarketRegime, regimeDetail, reasons }; }
  const direction: TradeDirection = regimeDetail.regime === "bullish" ? "long" : "short";
  reasons.push(regimeDetail.regime === "bullish" ? "trend_15m_bullish" : "trend_15m_bearish");
  if (entryCandles.length < config.swingLookback + 2) { reasons.push("insufficient_entry_data"); return { setup: null, regime: regimeDetail.regime, regimeDetail, reasons }; }
  const breakout = findRecentBreakout(entryCandles, config, direction);
  if (!breakout) { reasons.push("no_breakout"); return { setup: null, regime: regimeDetail.regime, regimeDetail, reasons }; }
  reasons.push("breakout_detected");
  const pullback = detectPullback(entryCandles, breakout);
  if (!pullback.confirmed) { reasons.push("pullback_not_confirmed"); return { setup: null, regime: regimeDetail.regime, regimeDetail, reasons }; }
  reasons.push("pullback_confirmed");
  const confirmation = detectConfirmation(entryCandles, pullback, direction, config);
  if (!confirmation.confirmed) reasons.push("confirmation_missing");
  if (confirmation.candlestickRejection) reasons.push("candlestick_confirmation");
  if (confirmation.volumeConfirmed) reasons.push("volume_confirmation");
  if (confirmation.rsiConfirmed) reasons.push("rsi_healthy");
  if (confirmation.macdConfirmed) reasons.push(direction === "long" ? "macd_bullish" : "macd_bearish");
  const last = entryCandles[entryCandles.length - 1];
  const closes = entryCandles.map((c) => c.close);
  const klineRows = entryCandles.map((c) => [c.openTime, c.open, c.high, c.low, c.close, c.volume]);
  const atr = calculateATR(klineRows, config.atrPeriod);
  const atrPct = last.close > 0 ? (atr / last.close) * 100 : 0;
  const rsi = calculateRSI(closes, config.rsiPeriod);
  const macd = calculateMACD(closes);
  const recentVolumes = entryCandles.slice(-config.swingLookback).map((c) => c.volume);
  const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / (recentVolumes.length || 1);
  const volumeRatio = avgVolume > 0 ? last.volume / avgVolume : 1;
  const pullbackLeg = entryCandles.slice(breakout.breakoutIndex + 1, pullback.pullbackIndex + 1);
  const stopCandidate = direction === "long"
    ? Math.min(breakout.level, ...pullbackLeg.map((c) => c.low))
    : Math.max(breakout.level, ...pullbackLeg.map((c) => c.high));
  const setup: ScalpSetup = { symbol, direction, regime: regimeDetail.regime, breakout, pullback, confirmation, entryPrice: last.close, stopCandidate, atr, atrPct, rsi, macdHistogram: macd.histogram, volumeRatio, timestamp: last.closeTime };
  return { setup, regime: regimeDetail.regime, regimeDetail, reasons };
}

// ---------------------------------------------------------------------------
// Risk engine (ported from riskEngine.ts)
// ---------------------------------------------------------------------------
interface DailyRiskStatus { locked: boolean; reason?: string; tradesToday: number; lossRToday: number; dayKey: string }
interface RiskCalc { valid: boolean; reasonInvalid?: string; stopLoss: number; stopDistance: number; riskAmount: number; rewardAmount: number; positionSize: number; takeProfit1: number; takeProfit2: number; riskRewardRatio: number; capitalCurrency: string }

function todayKey(): string { return new Date().toISOString().slice(0, 10); }
function initialDailyRisk(dayKey = todayKey()): DailyRiskStatus { return { locked: false, tradesToday: 0, lossRToday: 0, dayKey }; }

function updateDailyRisk(prev: DailyRiskStatus, config: StrategyConfig, event: { newTrade?: boolean; closedLossR?: number }): DailyRiskStatus {
  const dayKey = todayKey();
  let next = prev.dayKey === dayKey ? { ...prev } : initialDailyRisk(dayKey);
  if (event.newTrade) next.tradesToday += 1;
  if (typeof event.closedLossR === "number" && event.closedLossR < 0) next.lossRToday += Math.abs(event.closedLossR);
  const locked = next.lossRToday >= config.maxDailyLossR || next.tradesToday >= config.maxTradesPerDay;
  next = { ...next, locked, reason: locked ? (next.lossRToday >= config.maxDailyLossR ? "max_daily_loss" : "max_trades") : undefined };
  return next;
}

function invalidRisk(reason: string, config: StrategyConfig): RiskCalc {
  return { valid: false, reasonInvalid: reason, stopLoss: 0, stopDistance: 0, riskAmount: 0, rewardAmount: 0, positionSize: 0, takeProfit1: 0, takeProfit2: 0, riskRewardRatio: 0, capitalCurrency: config.capitalCurrency };
}

function calculateRisk(setup: ScalpSetup, config: StrategyConfig, dailyRisk: DailyRiskStatus, usdRate = 1): RiskCalc {
  if (dailyRisk.locked) return invalidRisk("DAILY_LOCKED", config);
  if (dailyRisk.tradesToday >= config.maxTradesPerDay) return invalidRisk("MAX_TRADES_REACHED", config);
  if (config.minRiskReward < 1) return invalidRisk("RR_TOO_LOW", config);
  const rawStopDistance = setup.direction === "long" ? setup.entryPrice - setup.stopCandidate : setup.stopCandidate - setup.entryPrice;
  const atrBuffer = setup.atr * config.atrStopBufferMult;
  const stopDistance = Math.max(rawStopDistance, 0) + atrBuffer;
  if (stopDistance <= 0 || (setup.atr > 0 && stopDistance > setup.atr * config.maxStopAtr)) return invalidRisk("STOP_TOO_WIDE", config);
  const stopLoss = setup.direction === "long" ? setup.entryPrice - stopDistance : setup.entryPrice + stopDistance;
  const riskAmount = config.capital * (config.riskPerTradePct / 100);
  const riskAmountUsd = usdRate > 0 ? riskAmount / usdRate : riskAmount;
  const positionSize = riskAmountUsd / stopDistance;
  const riskRewardRatio = config.minRiskReward;
  const rewardAmount = riskAmount * riskRewardRatio;
  const takeProfit1 = setup.direction === "long" ? setup.entryPrice + stopDistance * riskRewardRatio : setup.entryPrice - stopDistance * riskRewardRatio;
  const takeProfit2 = setup.direction === "long" ? setup.entryPrice + stopDistance * (riskRewardRatio + 1) : setup.entryPrice - stopDistance * (riskRewardRatio + 1);
  return { valid: true, stopLoss, stopDistance, riskAmount, rewardAmount, positionSize, takeProfit1, takeProfit2, riskRewardRatio, capitalCurrency: config.capitalCurrency };
}

// ---------------------------------------------------------------------------
// Confidence score (ported from confidenceScore.ts)
// ---------------------------------------------------------------------------
function clamp01(x: number): number { return Number.isNaN(x) ? 0 : Math.max(0, Math.min(1, x)); }

interface ConfidenceBreakdown {
  trendAlignment: number; breakoutQuality: number; pullbackQuality: number; volume: number;
  rsi: number; macd: number; volatility: number; riskReward: number; total: number;
}

function calculateConfidenceScore(setup: ScalpSetup, regimeDetail: RegimeResult, risk: RiskCalc, config: StrategyConfig): ConfidenceBreakdown {
  const w = config.confidenceWeights;
  const slopeRef = setup.atr || Math.abs(regimeDetail.ema20Slope) || 1;
  const trendAlignment = w.trendAlignment * clamp01(0.5 + (Math.abs(regimeDetail.ema20Slope) / slopeRef) * 0.5);
  const breakoutStrength = setup.atr > 0 ? Math.abs(setup.breakout.breakoutClose - setup.breakout.level) / setup.atr : 0;
  const breakoutQuality = w.breakoutQuality * clamp01(breakoutStrength);
  const barsToPullback = setup.pullback.pullbackIndex - setup.breakout.breakoutIndex;
  const pullbackQuality = w.pullbackQuality * clamp01(1 - barsToPullback / (config.pullbackMaxBars || 1));
  const volumeRange = config.volumeConfirmMult - 1 || 1;
  const volume = w.volume * clamp01((setup.volumeRatio - 1) / volumeRange);
  const rsiScore = setup.direction === "long" ? clamp01((setup.rsi - 45) / 30) : clamp01((55 - setup.rsi) / 30);
  const rsi = w.rsi * rsiScore;
  const macdRef = setup.entryPrice * 0.0015 || 1;
  const macdAligned = (setup.direction === "long" && setup.macdHistogram > 0) || (setup.direction === "short" && setup.macdHistogram < 0);
  const macd = w.macd * (macdAligned ? clamp01(Math.abs(setup.macdHistogram) / macdRef) : 0);
  const volatility = w.volatility * clamp01(1 - Math.abs(setup.atrPct - 0.6) / 1.2);
  const riskReward = risk.valid ? w.riskReward * clamp01(risk.riskRewardRatio / (config.minRiskReward * 1.5)) : 0;
  const total = Math.round(Math.min(100, trendAlignment + breakoutQuality + pullbackQuality + volume + rsi + macd + volatility + riskReward));
  return { trendAlignment, breakoutQuality, pullbackQuality, volume, rsi, macd, volatility, riskReward, total };
}

// ---------------------------------------------------------------------------
// Signal state machine (ported from signalStateMachine.ts)
// ---------------------------------------------------------------------------
type SignalState = "NO_TRADE" | "WATCH" | "LONG_SETUP" | "LONG_CONFIRMED" | "SHORT_SETUP" | "SHORT_CONFIRMED" | "TRADE_ACTIVE" | "TARGET_HIT" | "STOP_HIT" | "EXPIRED";
const SETUP_OR_CONFIRMED_STATES: SignalState[] = ["LONG_SETUP", "LONG_CONFIRMED", "SHORT_SETUP", "SHORT_CONFIRMED"];

function nextSignalState(ctx: {
  prevState: SignalState; regime: MarketRegime; setup: ScalpSetup | null; risk: RiskCalc | null;
  confidenceTotal: number; minConfidence: number;
  activeTrade: { direction: TradeDirection; stopLoss: number; takeProfit1: number; takeProfit2: number } | null;
  currentPrice: number;
}): SignalState {
  if (ctx.activeTrade) {
    const { direction, stopLoss, takeProfit1, takeProfit2 } = ctx.activeTrade;
    const price = ctx.currentPrice;
    const hitStop = direction === "long" ? price <= stopLoss : price >= stopLoss;
    if (hitStop) return "STOP_HIT";
    const hitTarget = direction === "long" ? price >= takeProfit1 || price >= takeProfit2 : price <= takeProfit1 || price <= takeProfit2;
    if (hitTarget) return "TARGET_HIT";
    return "TRADE_ACTIVE";
  }
  if (!ctx.setup) {
    if (SETUP_OR_CONFIRMED_STATES.includes(ctx.prevState)) return "EXPIRED";
    return ctx.regime === "neutral" ? "NO_TRADE" : "WATCH";
  }
  const tradable = ctx.setup.confirmation.confirmed && !!ctx.risk?.valid && ctx.confidenceTotal >= ctx.minConfidence;
  if (ctx.setup.direction === "long") return tradable ? "LONG_CONFIRMED" : "LONG_SETUP";
  return tradable ? "SHORT_CONFIRMED" : "SHORT_SETUP";
}

// ---------------------------------------------------------------------------
// Alert engine (ported from alertEngine.ts)
// ---------------------------------------------------------------------------
type AlertType = "SETUP_DETECTED" | "ENTRY_CONFIRMED" | "STOP_HIT" | "TP1_HIT" | "TP2_HIT" | "SETUP_INVALIDATED";

function mapTransitionToAlertType(prev: SignalState, next: SignalState, targetHit?: "TP1" | "TP2"): AlertType | null {
  const wasSetupLike = prev === "LONG_SETUP" || prev === "SHORT_SETUP";
  const wasConfirmedLike = prev === "LONG_CONFIRMED" || prev === "SHORT_CONFIRMED";
  const wasActiveLike = wasSetupLike || wasConfirmedLike;
  if ((next === "LONG_SETUP" || next === "SHORT_SETUP") && !wasActiveLike) return "SETUP_DETECTED";
  if ((next === "LONG_CONFIRMED" || next === "SHORT_CONFIRMED") && (wasSetupLike || !wasActiveLike)) return "ENTRY_CONFIRMED";
  if (next === "STOP_HIT" && prev !== "STOP_HIT") return "STOP_HIT";
  if (next === "TARGET_HIT" && prev !== "TARGET_HIT") return targetHit === "TP2" ? "TP2_HIT" : "TP1_HIT";
  if (next === "EXPIRED" && wasActiveLike) return "SETUP_INVALIDATED";
  return null;
}

interface AlertEvent {
  id: string; symbol: string; timeframe: string; type: AlertType; state: SignalState;
  direction: TradeDirection | null; entryPrice?: number; stopLoss?: number; takeProfit1?: number;
  takeProfit2?: number; riskAmount?: number; rewardAmount?: number; riskRewardRatio?: number;
  confidence?: number; capitalCurrency?: string; reasons: string[]; timestamp: number;
}

interface AlertBuildContext {
  symbol: string; timeframe: string; prevState: SignalState; nextState: SignalState;
  setup: ScalpSetup | null; risk: RiskCalc | null; confidence: ConfidenceBreakdown | null;
  reasons: string[]; targetHit?: "TP1" | "TP2"; lastAlert: AlertEvent | null; now: number; config: StrategyConfig;
}

function buildAlert(ctx: AlertBuildContext): AlertEvent | null {
  if (ctx.prevState === ctx.nextState) return null;
  const type = mapTransitionToAlertType(ctx.prevState, ctx.nextState, ctx.targetHit);
  if (!type) return null;
  if (ctx.lastAlert && ctx.lastAlert.type === type && ctx.now - new Date(ctx.lastAlert.timestamp).getTime() < ctx.config.alertCooldownMs) return null;
  return {
    id: crypto.randomUUID(), symbol: ctx.symbol, timeframe: ctx.timeframe, type, state: ctx.nextState,
    direction: ctx.setup?.direction ?? null, entryPrice: ctx.setup?.entryPrice,
    stopLoss: ctx.risk?.valid ? ctx.risk.stopLoss : undefined,
    takeProfit1: ctx.risk?.valid ? ctx.risk.takeProfit1 : undefined,
    takeProfit2: ctx.risk?.valid ? ctx.risk.takeProfit2 : undefined,
    riskAmount: ctx.risk?.valid ? ctx.risk.riskAmount : undefined,
    rewardAmount: ctx.risk?.valid ? ctx.risk.rewardAmount : undefined,
    riskRewardRatio: ctx.risk?.valid ? ctx.risk.riskRewardRatio : undefined,
    confidence: ctx.confidence?.total, capitalCurrency: ctx.risk?.capitalCurrency,
    reasons: ctx.reasons, timestamp: ctx.now,
  };
}

// ---------------------------------------------------------------------------
// Paper trading (ported from paperTrading.ts)
// ---------------------------------------------------------------------------
function openPaperTradeRow(setup: ScalpSetup, risk: RiskCalc, confidence: number, config: StrategyConfig) {
  const costs = config.tradingCosts;
  const costPct = costs.feePct * 2 + costs.spreadPct + costs.slippagePct;
  return {
    symbol: setup.symbol, direction: setup.direction, entry_price: setup.entryPrice, stop_loss: risk.stopLoss,
    take_profit_1: risk.takeProfit1, take_profit_2: risk.takeProfit2, position_size: risk.positionSize,
    risk_amount: risk.riskAmount, confidence, capital_currency: risk.capitalCurrency, cost_pct: costPct, result: "OPEN",
  };
}

function closePnl(trade: { direction: string; entry_price: number; position_size: number; cost_pct: number; risk_amount: number }, exitPrice: number, usdRate: number) {
  const grossMoveUsd = trade.direction === "long" ? exitPrice - trade.entry_price : trade.entry_price - exitPrice;
  const grossPnlUsd = grossMoveUsd * trade.position_size;
  const notionalUsd = trade.entry_price * trade.position_size;
  const costUsd = notionalUsd * (trade.cost_pct / 100);
  const pnl = (grossPnlUsd - costUsd) * usdRate;
  const pnlR = trade.risk_amount > 0 ? pnl / trade.risk_amount : 0;
  return { pnl, pnlR };
}

// ---------------------------------------------------------------------------
// FX rate (ported from fxRate.ts)
// ---------------------------------------------------------------------------
async function getUsdRate(currency: string): Promise<number> {
  if (currency === "usd") return 1;
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=USD&to=${currency.toUpperCase()}`);
    const data = await res.json();
    const rate = data.rates?.[currency.toUpperCase()];
    if (typeof rate === "number" && rate > 0) return rate;
  } catch { /* fall through */ }
  return currency === "chf" ? 0.88 : currency === "eur" ? 0.92 : 1;
}

// ---------------------------------------------------------------------------
// Web Push
// ---------------------------------------------------------------------------
async function sendPushToSubscribers(
  sb: ReturnType<typeof createClient>,
  alert: { type: AlertType; symbol: string; direction: string | null; entryPrice?: number; stopLoss?: number; takeProfit1?: number; takeProfit2?: number; confidence?: number; riskRewardRatio?: number },
) {
  const vapidPublic = Deno.env.get("VAPID_PUBLIC_KEY");
  const vapidPrivate = Deno.env.get("VAPID_PRIVATE_KEY");
  const vapidSubject = Deno.env.get("VAPID_SUBJECT") || "mailto:alerts@cryptosignalspro.app";
  if (!vapidPublic || !vapidPrivate) return { sent: 0, reason: "vapid_not_configured" };

  webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

  const { data: subs } = await sb.from("push_subscriptions").select("*");
  if (!subs || subs.length === 0) return { sent: 0, reason: "no_subscribers" };

  const title = `${alert.symbol}/USDT — ${alert.type.replace(/_/g, " ")}`;
  const bodyParts: string[] = [];
  if (alert.direction) bodyParts.push(alert.direction.toUpperCase());
  if (alert.entryPrice) bodyParts.push(`Entry ${alert.entryPrice.toFixed(2)}`);
  if (alert.stopLoss) bodyParts.push(`SL ${alert.stopLoss.toFixed(2)}`);
  if (alert.takeProfit1) bodyParts.push(`TP1 ${alert.takeProfit1.toFixed(2)}`);
  if (alert.confidence) bodyParts.push(`Conf ${alert.confidence}%`);
  const payload = JSON.stringify({ title, body: bodyParts.join(" · "), type: alert.type, symbol: alert.symbol });

  let sent = 0;
  await Promise.allSettled(subs.map(async (row: Record<string, unknown>) => {
    const alertTypes = (row.alert_types as string[]) || [];
    if (!alertTypes.includes(alert.type)) return;
    const subscription = { endpoint: row.endpoint as string, keys: { p256dh: row.p256dh as string, auth: row.auth as string } };
    try {
      await webpush.sendNotification(subscription, payload);
      sent++;
    } catch (err) {
      // Expired/invalid subscription (410 Gone / 404) -> clean it up.
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await sb.from("push_subscriptions").delete().eq("id", row.id as string);
      }
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

    const { data: cfgRow } = await sb.from("scalp_config").select("*").limit(1).single();
    if (!cfgRow) return new Response(JSON.stringify({ ok: false, reason: "no_config" }), { status: 200 });
    const config = cfgRow.config as StrategyConfig;

    const enabledSymbols = config.symbols.filter((s) => s.enabled);
    const results: Record<string, unknown> = {};

    for (const symbolDef of enabledSymbols) {
      const [trendCandles, entryCandles] = await Promise.all([
        fetchCandles(symbolDef.pair, config.trendTimeframe, 260),
        fetchCandles(symbolDef.pair, config.entryTimeframe, 150),
      ]);

      const { setup, regime, regimeDetail, reasons } = evaluateSetup(symbolDef.symbol, trendCandles, entryCandles, config);

      const { data: stateRow } = await sb.from("scalp_signal_state").select("*").eq("symbol", symbolDef.symbol).maybeSingle();
      const prevState: SignalState = (stateRow?.state as SignalState) || "NO_TRADE";
      const prevDailyRisk: DailyRiskStatus = (stateRow?.daily_risk as DailyRiskStatus) || initialDailyRisk();
      const lastAlert = stateRow?.last_alert ?? null;

      const dailyRisk = updateDailyRisk(prevDailyRisk, config, {});
      const usdRate = await getUsdRate(config.capitalCurrency);
      const currentPrice = entryCandles[entryCandles.length - 1]?.close ?? 0;

      const risk = setup ? calculateRisk(setup, config, dailyRisk, usdRate) : null;
      const confidence = setup && risk ? calculateConfidenceScore(setup, regimeDetail, risk, config) : null;

      const { data: openTradeRow } = await sb.from("scalp_paper_trades").select("*").eq("symbol", symbolDef.symbol).eq("result", "OPEN").maybeSingle();
      const activeTrade = openTradeRow
        ? { direction: openTradeRow.direction as TradeDirection, stopLoss: Number(openTradeRow.stop_loss), takeProfit1: Number(openTradeRow.take_profit_1), takeProfit2: Number(openTradeRow.take_profit_2) }
        : null;

      const nextState = nextSignalState({ prevState, regime, setup, risk, confidenceTotal: confidence?.total ?? 0, minConfidence: config.minSignalConfidence, activeTrade, currentPrice });

      let targetHit: "TP1" | "TP2" | undefined;
      if (nextState === "TARGET_HIT" && openTradeRow) {
        const reachedTp2 = activeTrade!.direction === "long" ? currentPrice >= activeTrade!.takeProfit2 : currentPrice <= activeTrade!.takeProfit2;
        targetHit = reachedTp2 ? "TP2" : "TP1";
      }

      const now = Date.now();
      const alert = buildAlert({ symbol: symbolDef.symbol, timeframe: config.entryTimeframe, prevState, nextState, setup, risk, confidence, reasons, targetHit, lastAlert, now, config });

      let dailyRiskNext = dailyRisk;
      if ((nextState === "LONG_CONFIRMED" || nextState === "SHORT_CONFIRMED") && !openTradeRow && setup && risk?.valid && confidence) {
        await sb.from("scalp_paper_trades").insert(openPaperTradeRow(setup, risk, confidence.total, config));
        dailyRiskNext = updateDailyRisk(dailyRiskNext, config, { newTrade: true });
      } else if ((nextState === "STOP_HIT" || nextState === "TARGET_HIT") && openTradeRow) {
        const exitPrice = nextState === "STOP_HIT" ? Number(openTradeRow.stop_loss) : targetHit === "TP2" ? Number(openTradeRow.take_profit_2) : Number(openTradeRow.take_profit_1);
        const result = nextState === "STOP_HIT" ? "SL" : targetHit === "TP2" ? "TP2" : "TP1";
        const { pnl, pnlR } = closePnl(openTradeRow as never, exitPrice, usdRate);
        await sb.from("scalp_paper_trades").update({ closed_at: new Date(now).toISOString(), exit_price: exitPrice, result, pnl, pnl_r: pnlR }).eq("id", openTradeRow.id);
        dailyRiskNext = updateDailyRisk(dailyRiskNext, config, { closedLossR: pnlR < 0 ? pnlR : undefined });
      }

      await sb.from("scalp_signal_state").upsert({
        symbol: symbolDef.symbol, state: nextState, regime, setup, risk, confidence,
        daily_risk: dailyRiskNext, last_alert: alert ?? lastAlert, updated_at: new Date(now).toISOString(),
      });

      let pushResult: unknown = null;
      if (alert) {
        await sb.from("scalp_alerts").insert({
          id: alert.id, symbol: alert.symbol, timeframe: alert.timeframe, type: alert.type, state: alert.state,
          direction: alert.direction, entry_price: alert.entryPrice, stop_loss: alert.stopLoss,
          take_profit_1: alert.takeProfit1, take_profit_2: alert.takeProfit2, risk_amount: alert.riskAmount,
          reward_amount: alert.rewardAmount, risk_reward_ratio: alert.riskRewardRatio, confidence: alert.confidence,
          capital_currency: alert.capitalCurrency, reasons: alert.reasons, created_at: new Date(alert.timestamp).toISOString(),
        });
        pushResult = await sendPushToSubscribers(sb, alert);
      }

      results[symbolDef.symbol] = { state: nextState, alert: alert?.type ?? null, push: pushResult };
    }

    return new Response(JSON.stringify({ ok: true, results }), { headers: { "Content-Type": "application/json" }, status: 200 });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), { status: 500 });
  }
});
