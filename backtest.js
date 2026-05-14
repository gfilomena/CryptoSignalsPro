/**
 * backtest.js — Sandbox backtest con dati REALI Binance (ultime 24h)
 *
 * Scarica klines storiche reali, ricalcola indicatori tecnici ad ogni tick,
 * e simula la strategia completa (trailing TP, timeout, scaling-in, F&G filter).
 *
 * Eseguire:  node backtest.js
 */

// ─── CONFIG (identica a bot_config in DB) ───────────────────────────────────
const CONFIG = {
  initialCapital: 10000,
  maxPositions: 8,
  minConfidence: 65,
  trailingActivationPct: 3.5,
  trailingStepPct: 1.5,
  timeoutMs: 8 * 3600_000,
  timeoutExtendedMs: 12 * 3600_000,
  tiers: {
    major:   { maxPerAsset: 3, scalingDropPct: 3.0, sizeMultiplier: 1.0, scalingMultipliers: [1, 1.5, 2] },
    altcoin: { maxPerAsset: 2, scalingDropPct: 4.5, sizeMultiplier: 0.75, scalingMultipliers: [1, 1.5] },
    meme:    { maxPerAsset: 1, scalingDropPct: 7.0, sizeMultiplier: 0.5, scalingMultipliers: [1] }
  },
  fearGreedFilter: { extremeFear: 25, fear: 40, greed: 75, extremeGreed: 85 }
};

const BTC = { symbol: 'BTC', name: 'Bitcoin', tier: 'major' };

// ─── INDICATORI TECNICI (stessa logica di bot-cycle) ────────────────────────

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain / avgLoss));
}

function calculateEMA(prices, period) {
  if (prices.length < period) return prices[prices.length - 1];
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateMACDSeries(prices) {
  if (prices.length < 26) return [];
  const k12 = 2 / 13, k26 = 2 / 27;
  let ema12 = prices.slice(0, 12).reduce((a, b) => a + b, 0) / 12;
  let ema26 = prices.slice(0, 26).reduce((a, b) => a + b, 0) / 26;
  const series = [];
  for (let i = 12; i < 26; i++) ema12 = prices[i] * k12 + ema12 * (1 - k12);
  for (let i = 26; i < prices.length; i++) {
    ema12 = prices[i] * k12 + ema12 * (1 - k12);
    ema26 = prices[i] * k26 + ema26 * (1 - k26);
    series.push(ema12 - ema26);
  }
  return series;
}

function calculateMACD(prices) {
  const series = calculateMACDSeries(prices);
  if (series.length === 0) return { macd: 0, signal: 0, histogram: 0 };
  const macd = series[series.length - 1];
  const signalPeriod = 9;
  let signal;
  if (series.length < signalPeriod) {
    signal = series.reduce((a, b) => a + b, 0) / series.length;
  } else {
    const kSig = 2 / (signalPeriod + 1);
    signal = series.slice(0, signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod;
    for (let i = signalPeriod; i < series.length; i++) signal = series[i] * kSig + signal * (1 - kSig);
  }
  return { macd, signal, histogram: macd - signal };
}

function calculateBollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.map(p => Math.pow(p - middle, 2)).reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(variance);
  return { upper: middle + std * stdDev, middle, lower: middle - std * stdDev };
}

function calculateOBV(closes, volumes) {
  if (closes.length < 2 || closes.length !== volumes.length) return { trend: 0, divergence: 'none' };
  let obv = 0;
  const obvSeries = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv += volumes[i];
    else if (closes[i] < closes[i - 1]) obv -= volumes[i];
    obvSeries.push(obv);
  }
  const period = Math.min(14, obvSeries.length - 1);
  const recentObv = obvSeries.slice(-period);
  const recentPrice = closes.slice(-period);
  const obvTrend = recentObv[recentObv.length - 1] - recentObv[0];
  const priceTrend = recentPrice[recentPrice.length - 1] - recentPrice[0];
  let divergence = 'none';
  if (priceTrend > 0 && obvTrend < 0) divergence = 'bearish';
  if (priceTrend < 0 && obvTrend > 0) divergence = 'bullish';
  return { trend: obvTrend > 0 ? 1 : obvTrend < 0 ? -1 : 0, divergence };
}

function detectRSIDivergence(prices, period = 14, lookback = 5) {
  if (prices.length < period + lookback + 1) return 'none';
  const rsiSeries = [];
  for (let end = period + 1; end <= prices.length; end++) {
    rsiSeries.push(calculateRSI(prices.slice(0, end), period));
  }
  const recentPrices = prices.slice(-lookback);
  const recentRsi = rsiSeries.slice(-lookback);
  if (recentPrices[recentPrices.length-1] < recentPrices[0] && recentRsi[recentRsi.length-1] > recentRsi[0]) return 'bullish';
  if (recentPrices[recentPrices.length-1] > recentPrices[0] && recentRsi[recentRsi.length-1] < recentRsi[0]) return 'bearish';
  return 'none';
}

const STOP_LOSS_PCT = { major: -8, altcoin: -12, meme: -15 };

function analyzeSignal(data) {
  let score = 0;
  const reasons = [];

  const aboveEma200 = data.ema200 && data.price > data.ema200;
  const belowEma200 = data.ema200 && data.price < data.ema200;
  if (aboveEma200) { score += 25; reasons.push('Above EMA-200 (uptrend)'); }
  else if (belowEma200) { score -= 25; reasons.push('Below EMA-200 (downtrend)'); }

  if (data.rsiDivergence === 'bullish') { score += 20; reasons.push('RSI bullish divergence'); }
  else if (data.rsiDivergence === 'bearish') { score -= 20; reasons.push('RSI bearish divergence'); }

  if (data.rsi < 30) { score += 15; reasons.push(`RSI oversold (${data.rsi.toFixed(1)})`); }
  else if (data.rsi > 70) { score -= 15; reasons.push(`RSI overbought (${data.rsi.toFixed(1)})`); }

  if (data.macdHist > 0) { score += 20; reasons.push('MACD bullish'); }
  else if (data.macdHist < 0) { score -= 20; reasons.push('MACD bearish'); }

  if (data.price < data.bb.lower) { score += 15; reasons.push('Below lower BB'); }
  else if (data.price > data.bb.upper) { score -= 15; reasons.push('Above upper BB'); }

  if (data.obvDivergence === 'bullish') { score += 10; reasons.push('OBV bullish divergence'); }
  else if (data.obvDivergence === 'bearish') { score -= 10; reasons.push('OBV bearish divergence'); }

  const atrPct = data.atrPct || 3;
  const chg = data.priceChange;
  if (chg < -(atrPct * 2)) { score += 15; reasons.push(`Pullback ${chg.toFixed(1)}% (>2x ATR)`); }
  else if (chg < -atrPct) { score += 8; reasons.push(`Moderate pullback ${chg.toFixed(1)}%`); }
  else if (chg > atrPct * 2) { score -= 15; reasons.push(`Rally +${chg.toFixed(1)}% (>2x ATR)`); }
  else if (chg > atrPct) { score -= 8; reasons.push(`Moderate rally +${chg.toFixed(1)}%`); }

  let type = 'neutral';
  if (score >= 45) {
    type = belowEma200 ? 'neutral' : 'buy';
  } else if (score <= -45) {
    type = aboveEma200 ? 'neutral' : 'sell';
  }
  return { type, score, confidence: Math.min(100, Math.abs(score)), reasons };
}

// ─── BINANCE API ────────────────────────────────────────────────────────────

async function fetchKlines(symbol, interval, limit) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
  return res.json();
}

async function fetchFearGreed() {
  try {
    const res = await fetch('https://api.alternative.me/fng/');
    const data = await res.json();
    return { value: parseInt(data.data[0].value), label: data.data[0].value_classification };
  } catch {
    return { value: 50, label: 'Neutral' };
  }
}

// ─── BACKTEST ENGINE ────────────────────────────────────────────────────────

async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║   BTC 24H BACKTEST — Real Binance Data + Our Strategy      ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  // 1. Fetch Fear & Greed (current, used as constant for the simulation)
  const fg = await fetchFearGreed();
  console.log(`Fear & Greed Index: ${fg.value} (${fg.label})\n`);

  // 2. Fetch 4h klines: 200 candles for proper EMA-200 warmup + signal generation
  console.log('Fetching 4h klines from Binance (200 candles for indicator warmup)...');
  const hourlyRaw = await fetchKlines('BTCUSDT', '4h', 200);
  const hourlyCandles = hourlyRaw.map(k => ({
    openTime: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], closeTime: k[6]
  }));

  // 3. Fetch 5m klines for the last 24h (288 candles) — granular price ticks
  console.log('Fetching 5-minute klines for last 24h (288 ticks)...\n');
  const fiveMinRaw = await fetchKlines('BTCUSDT', '5m', 288);
  const ticks = fiveMinRaw.map(k => ({
    time: k[0], close: +k[4], high: +k[2], low: +k[3], open: +k[1], volume: +k[5]
  }));

  const simStart = ticks[0].time;
  const simEnd = ticks[ticks.length - 1].time;
  console.log(`Simulation period: ${new Date(simStart).toISOString()} → ${new Date(simEnd).toISOString()}`);
  console.log(`BTC range: $${Math.min(...ticks.map(t=>t.low)).toLocaleString()} – $${Math.max(...ticks.map(t=>t.high)).toLocaleString()}`);
  console.log(`Start price: $${ticks[0].open.toLocaleString()}  |  End price: $${ticks[ticks.length-1].close.toLocaleString()}`);

  const buyAndHoldPct = ((ticks[ticks.length-1].close - ticks[0].open) / ticks[0].open * 100);
  console.log(`Buy & Hold return: ${buyAndHoldPct >= 0 ? '+' : ''}${buyAndHoldPct.toFixed(2)}%\n`);

  // F&G size modifier
  const fgMod = fg.value <= CONFIG.fearGreedFilter.extremeFear ? 1.3
    : fg.value <= CONFIG.fearGreedFilter.fear ? 1.15
    : fg.value >= CONFIG.fearGreedFilter.greed ? 0.5 : 1.0;

  // State
  const openTrades = [];
  const closedTrades = [];
  let tradeIdCounter = 0;
  const events = [];

  // Get the 24h start boundary to compute priceChange
  const firstTickPrice = ticks[0].open;

  // 4. Simulate at each 5-min tick
  for (let i = 0; i < ticks.length; i++) {
    const tick = ticks[i];
    const tickTime = tick.time;
    const price = tick.close;

    // Build hourly close array up to this tick (for indicators)
    const relevantHourly = hourlyCandles.filter(h => h.closeTime <= tickTime);
    if (relevantHourly.length < 26) continue;
    const hourlyCloses = relevantHourly.map(h => h.close);
    const hourlyVolumes = relevantHourly.map(h => h.volume);
    hourlyCloses.push(price);
    hourlyVolumes.push(tick.volume || hourlyVolumes[hourlyVolumes.length - 1] || 0);

    // Calculate indicators
    const rsi = calculateRSI(hourlyCloses);
    const macdData = calculateMACD(hourlyCloses);
    const ema20 = calculateEMA(hourlyCloses, 20);
    const ema50 = calculateEMA(hourlyCloses, 50);
    const ema200 = hourlyCloses.length >= 200 ? calculateEMA(hourlyCloses, 200) : null;
    const bb = calculateBollingerBands(hourlyCloses);
    const obv = calculateOBV(hourlyCloses, hourlyVolumes);
    const rsiDivergence = detectRSIDivergence(hourlyCloses);
    const priceChange = ((price - firstTickPrice) / firstTickPrice) * 100;

    // ATR from hourly highs/lows
    const recentCandles = relevantHourly.slice(-14);
    const atrValues = [];
    for (let a = 1; a < recentCandles.length; a++) {
      atrValues.push(Math.max(
        recentCandles[a].high - recentCandles[a].low,
        Math.abs(recentCandles[a].high - recentCandles[a-1].close),
        Math.abs(recentCandles[a].low - recentCandles[a-1].close)
      ));
    }
    const atr = atrValues.length > 0 ? atrValues.reduce((a, b) => a + b, 0) / atrValues.length : 0;
    const atrPct = price > 0 ? (atr / price) * 100 : 3;

    const signal = analyzeSignal({
      price, rsi, macdHist: macdData.histogram, ema20, ema50, ema200, bb,
      priceChange, atrPct, rsiDivergence,
      obvDivergence: obv.divergence
    });

    // ── CHECK EXITS ──
    for (let j = openTrades.length - 1; j >= 0; j--) {
      const trade = openTrades[j];
      const pnlPct = trade.direction === 'long'
        ? ((price - trade.entryPrice) / trade.entryPrice) * 100
        : ((trade.entryPrice - price) / trade.entryPrice) * 100;
      const pnl = trade.direction === 'long'
        ? (price - trade.entryPrice) * trade.quantity
        : (trade.entryPrice - price) * trade.quantity;
      const elapsed = tickTime - trade.entryTime;

      if (pnlPct > trade.highWaterMark) trade.highWaterMark = pnlPct;

      const trailingActive = trade.highWaterMark >= CONFIG.trailingActivationPct;
      let exitReason = null;

      if (trailingActive && (trade.highWaterMark - pnlPct) >= CONFIG.trailingStepPct) {
        exitReason = 'trailing_tp';
      } else if (!trailingActive) {
        const timeoutLimit = pnlPct > 0 ? CONFIG.timeoutExtendedMs : CONFIG.timeoutMs;
        if (elapsed > timeoutLimit) exitReason = 'timeout';
      }

      if (!exitReason) {
        const stopLoss = STOP_LOSS_PCT[BTC.tier] || -8;
        if (pnlPct <= stopLoss) exitReason = 'stop_loss';
      }

      if (!exitReason) {
        if ((trade.direction === 'long' && signal.type === 'sell' && signal.confidence >= CONFIG.minConfidence) ||
            (trade.direction === 'short' && signal.type === 'buy' && signal.confidence >= CONFIG.minConfidence)) {
          exitReason = 'signal_reversal';
        }
      }

      if (exitReason) {
        trade.exitPrice = price;
        trade.exitTime = tickTime;
        trade.pnl = pnl;
        trade.pnlPct = pnlPct;
        trade.exitReason = exitReason;
        trade.hwmAtExit = trade.highWaterMark;
        closedTrades.push(trade);
        openTrades.splice(j, 1);
        events.push({
          time: new Date(tickTime).toISOString().slice(11, 19),
          type: 'CLOSE',
          reason: exitReason,
          price: price.toFixed(2),
          pnl: pnl.toFixed(2),
          pnlPct: pnlPct.toFixed(2) + '%',
          hwm: trade.highWaterMark.toFixed(2) + '%'
        });
      }
    }

    // ── CHECK ENTRIES ──
    if (openTrades.length < CONFIG.maxPositions) {
      if (signal.confidence >= CONFIG.minConfidence && signal.type !== 'neutral') {
        const direction = signal.type === 'buy' ? 'long' : 'short';
        if (!(direction === 'long' && fg.value >= CONFIG.fearGreedFilter.extremeGreed)) {
          const tierCfg = CONFIG.tiers.major;
          const existingOnBTC = openTrades.filter(t => t.symbol === 'BTC');
          const level = existingOnBTC.length;

          let canOpen = level < tierCfg.maxPerAsset;
          if (canOpen && level > 0) {
            const lastEntry = existingOnBTC[existingOnBTC.length - 1];
            const drop = ((lastEntry.entryPrice - price) / lastEntry.entryPrice) * 100;
            if (direction === 'long' && drop < tierCfg.scalingDropPct) canOpen = false;
            if (direction === 'short' && -drop < tierCfg.scalingDropPct) canOpen = false;
            if (lastEntry.direction !== direction) canOpen = false;
          }

          if (canOpen) {
            const realizedPnl = closedTrades.reduce((s, t) => s + t.pnl, 0);
            const investedCapital = openTrades.reduce((s, t) => s + t.quantity * t.entryPrice, 0);
            const availableCapital = CONFIG.initialCapital + realizedPnl - investedCapital;
            const slotsLeft = CONFIG.maxPositions - openTrades.length;
            const baseValue = Math.max(0, availableCapital / slotsLeft);
            const scalingMul = (tierCfg.scalingMultipliers || [1])[level] || 1;
            const positionValue = Math.min(baseValue * scalingMul * tierCfg.sizeMultiplier * fgMod, availableCapital * 0.4);

            if (positionValue >= 10) {
              const quantity = positionValue / price;
              const trade = {
                id: ++tradeIdCounter,
                symbol: 'BTC',
                direction,
                entryPrice: price,
                entryTime: tickTime,
                quantity,
                positionValue,
                level: level + 1,
                highWaterMark: 0,
                entryScore: signal.score,
                entryConfidence: signal.confidence,
                entryReasons: signal.reasons
              };
              openTrades.push(trade);
              events.push({
                time: new Date(tickTime).toISOString().slice(11, 19),
                type: 'OPEN',
                direction,
                level: level + 1,
                price: price.toFixed(2),
                value: positionValue.toFixed(2),
                confidence: signal.confidence,
                reasons: signal.reasons.join(', ')
              });
            }
          }
        }
      }
    }
  }

  // 5. Close remaining open trades at final price (session end)
  const finalPrice = ticks[ticks.length - 1].close;
  for (const trade of openTrades) {
    const pnlPct = trade.direction === 'long'
      ? ((finalPrice - trade.entryPrice) / trade.entryPrice) * 100
      : ((trade.entryPrice - finalPrice) / trade.entryPrice) * 100;
    const pnl = trade.direction === 'long'
      ? (finalPrice - trade.entryPrice) * trade.quantity
      : (trade.entryPrice - finalPrice) * trade.quantity;
    trade.exitPrice = finalPrice;
    trade.exitTime = simEnd;
    trade.pnl = pnl;
    trade.pnlPct = pnlPct;
    trade.exitReason = 'session_end';
    trade.hwmAtExit = trade.highWaterMark;
    closedTrades.push(trade);
    events.push({
      time: new Date(simEnd).toISOString().slice(11, 19),
      type: 'CLOSE',
      reason: 'session_end',
      price: finalPrice.toFixed(2),
      pnl: pnl.toFixed(2),
      pnlPct: pnlPct.toFixed(2) + '%'
    });
  }
  openTrades.length = 0;

  // ─── PRINT RESULTS ────────────────────────────────────────────────────────

  console.log('━'.repeat(64));
  console.log('  TRADE LOG');
  console.log('━'.repeat(64));
  for (const ev of events) {
    if (ev.type === 'OPEN') {
      console.log(`  ${ev.time} │ 🟢 OPEN ${ev.direction.toUpperCase()} L${ev.level} @ $${ev.price} │ $${ev.value} │ conf: ${ev.confidence}`);
      console.log(`           │    → ${ev.reasons}`);
    } else {
      const icon = parseFloat(ev.pnl) >= 0 ? '🟩' : '🟥';
      console.log(`  ${ev.time} │ ${icon} CLOSE [${ev.reason}] @ $${ev.price} │ P&L: $${ev.pnl} (${ev.pnlPct})${ev.hwm ? ' │ HWM: ' + ev.hwm : ''}`);
    }
  }

  console.log('\n' + '═'.repeat(64));
  console.log('  SUMMARY');
  console.log('═'.repeat(64));

  const totalTrades = closedTrades.length;
  const winners = closedTrades.filter(t => t.pnl >= 0);
  const losers = closedTrades.filter(t => t.pnl < 0);
  const totalPnl = closedTrades.reduce((s, t) => s + t.pnl, 0);
  const totalPnlPct = (totalPnl / CONFIG.initialCapital) * 100;
  const avgWin = winners.length > 0 ? winners.reduce((s, t) => s + t.pnl, 0) / winners.length : 0;
  const avgLoss = losers.length > 0 ? losers.reduce((s, t) => s + t.pnl, 0) / losers.length : 0;
  const maxWin = winners.length > 0 ? Math.max(...winners.map(t => t.pnl)) : 0;
  const maxLoss = losers.length > 0 ? Math.min(...losers.map(t => t.pnl)) : 0;

  const byReason = {};
  for (const t of closedTrades) {
    if (!byReason[t.exitReason]) byReason[t.exitReason] = { count: 0, pnl: 0 };
    byReason[t.exitReason].count++;
    byReason[t.exitReason].pnl += t.pnl;
  }

  console.log(`  Initial Capital:    $${CONFIG.initialCapital.toLocaleString()}`);
  console.log(`  Final Capital:      $${(CONFIG.initialCapital + totalPnl).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Total P&L:          ${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)} (${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%)`);
  console.log(`  Buy & Hold:         ${buyAndHoldPct >= 0 ? '+' : ''}${buyAndHoldPct.toFixed(2)}%`);
  console.log(`  Alpha vs B&H:       ${(totalPnlPct - buyAndHoldPct) >= 0 ? '+' : ''}${(totalPnlPct - buyAndHoldPct).toFixed(2)}%`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Total Trades:       ${totalTrades}`);
  console.log(`  Winners:            ${winners.length} (${totalTrades > 0 ? (winners.length/totalTrades*100).toFixed(0) : 0}%)`);
  console.log(`  Losers:             ${losers.length} (${totalTrades > 0 ? (losers.length/totalTrades*100).toFixed(0) : 0}%)`);
  console.log(`  Avg Win:            +$${avgWin.toFixed(2)}`);
  console.log(`  Avg Loss:           $${avgLoss.toFixed(2)}`);
  console.log(`  Best Trade:         +$${maxWin.toFixed(2)}`);
  console.log(`  Worst Trade:        $${maxLoss.toFixed(2)}`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Exit Reasons:`);
  for (const [reason, data] of Object.entries(byReason)) {
    console.log(`    ${reason.padEnd(18)} ${String(data.count).padStart(3)} trades │ P&L: ${data.pnl >= 0 ? '+' : ''}$${data.pnl.toFixed(2)}`);
  }
  console.log(`  ─────────────────────────────────────`);
  console.log(`  Fear & Greed:       ${fg.value} (${fg.label}) → size mod: ${fgMod}x`);

  console.log('\n' + '═'.repeat(64));
  console.log('  TRADE DETAILS');
  console.log('═'.repeat(64));
  console.log('  #  │ Dir   │ Lvl │ Entry$      │ Exit$       │ P&L$       │ P&L%    │ Reason');
  console.log('  ───┼───────┼─────┼─────────────┼─────────────┼────────────┼─────────┼────────────────');
  for (const t of closedTrades) {
    const dir = t.direction.toUpperCase().padEnd(5);
    const entry = ('$' + t.entryPrice.toFixed(2)).padStart(11);
    const exit = ('$' + t.exitPrice.toFixed(2)).padStart(11);
    const pnl = ((t.pnl >= 0 ? '+' : '') + '$' + t.pnl.toFixed(2)).padStart(10);
    const pct = ((t.pnlPct >= 0 ? '+' : '') + t.pnlPct.toFixed(2) + '%').padStart(7);
    console.log(`  ${String(t.id).padStart(2)} │ ${dir} │  L${t.level}  │ ${entry} │ ${exit} │ ${pnl} │ ${pct} │ ${t.exitReason}`);
  }
  console.log('═'.repeat(64));
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
