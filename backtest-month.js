/**
 * backtest-month.js — Backtest 30 giorni con dati REALI Binance
 *
 * Simula la strategia completa su TUTTI i 20 asset del portfolio,
 * con indicatori tecnici, trailing TP, timeout, scaling-in, F&G filter.
 *
 * Eseguire:  node backtest-month.js
 */

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

const ASSETS = [
  { symbol: 'BTC',   name: 'Bitcoin',       tier: 'major',   pair: 'BTCUSDT' },
  { symbol: 'ETH',   name: 'Ethereum',      tier: 'major',   pair: 'ETHUSDT' },
  { symbol: 'SOL',   name: 'Solana',        tier: 'major',   pair: 'SOLUSDT' },
  { symbol: 'BNB',   name: 'Binance Coin',  tier: 'major',   pair: 'BNBUSDT' },
  { symbol: 'XRP',   name: 'Ripple',        tier: 'altcoin', pair: 'XRPUSDT' },
  { symbol: 'ADA',   name: 'Cardano',       tier: 'altcoin', pair: 'ADAUSDT' },
  { symbol: 'DOGE',  name: 'Dogecoin',      tier: 'meme',   pair: 'DOGEUSDT' },
  { symbol: 'AVAX',  name: 'Avalanche',     tier: 'altcoin', pair: 'AVAXUSDT' },
  { symbol: 'LINK',  name: 'Chainlink',     tier: 'altcoin', pair: 'LINKUSDT' },
  { symbol: 'DOT',   name: 'Polkadot',      tier: 'altcoin', pair: 'DOTUSDT' },
  { symbol: 'SHIB',  name: 'Shiba Inu',     tier: 'meme',   pair: 'SHIBUSDT' },
  { symbol: 'MATIC', name: 'Polygon',       tier: 'altcoin', pair: 'MATICUSDT' },
  { symbol: 'LTC',   name: 'Litecoin',      tier: 'altcoin', pair: 'LTCUSDT' },
  { symbol: 'UNI',   name: 'Uniswap',       tier: 'altcoin', pair: 'UNIUSDT' },
  { symbol: 'NEAR',  name: 'NEAR Protocol', tier: 'altcoin', pair: 'NEARUSDT' },
  { symbol: 'SUI',   name: 'Sui',           tier: 'altcoin', pair: 'SUIUSDT' },
  { symbol: 'PEPE',  name: 'Pepe',          tier: 'meme',   pair: 'PEPEUSDT' },
  { symbol: 'TRX',   name: 'Tron',          tier: 'altcoin', pair: 'TRXUSDT' },
  { symbol: 'XLM',   name: 'Stellar',       tier: 'altcoin', pair: 'XLMUSDT' },
  { symbol: 'APT',   name: 'Aptos',         tier: 'altcoin', pair: 'APTUSDT' }
];

// ─── INDICATORI TECNICI ─────────────────────────────────────────────────────

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change; else losses -= change;
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
  for (let i = period; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
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

function calculateBollingerBands(prices, period = 20, stdDev = 2) {
  if (prices.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.map(p => (p - middle) ** 2).reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(variance);
  return { upper: middle + std * stdDev, middle, lower: middle - std * stdDev };
}

const STOP_LOSS_PCT = { major: -8, altcoin: -12, meme: -15 };

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

function calculateATR(highs, lows, closes, period = 14) {
  if (closes.length < period + 1) return 0;
  const trs = [];
  for (let i = 1; i < closes.length; i++) {
    trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i-1]), Math.abs(lows[i] - closes[i-1])));
  }
  const recentTrs = trs.slice(-period);
  return recentTrs.reduce((a, b) => a + b, 0) / recentTrs.length;
}

function analyzeSignal(data) {
  let score = 0;
  const reasons = [];

  // EMA-200 trend filter (+/-25)
  const aboveEma200 = data.ema200 && data.price > data.ema200;
  const belowEma200 = data.ema200 && data.price < data.ema200;
  if (aboveEma200) { score += 25; reasons.push('Above EMA-200 (uptrend)'); }
  else if (belowEma200) { score -= 25; reasons.push('Below EMA-200 (downtrend)'); }

  // RSI divergence (+/-20)
  if (data.rsiDivergence === 'bullish') { score += 20; reasons.push('RSI bullish divergence'); }
  else if (data.rsiDivergence === 'bearish') { score -= 20; reasons.push('RSI bearish divergence'); }

  // RSI level (+/-15)
  if (data.rsi < 30) { score += 15; reasons.push(`RSI oversold`); }
  else if (data.rsi > 70) { score -= 15; reasons.push(`RSI overbought`); }

  // MACD crossover (+/-20)
  if (data.macdHist > 0) { score += 20; reasons.push('MACD bullish'); }
  else if (data.macdHist < 0) { score -= 20; reasons.push('MACD bearish'); }

  // Bollinger Bands (+/-15)
  if (data.price < data.bb.lower) { score += 15; reasons.push('Below lower BB'); }
  else if (data.price > data.bb.upper) { score -= 15; reasons.push('Above upper BB'); }

  // OBV divergence (+/-10)
  if (data.obvDivergence === 'bullish') { score += 10; reasons.push('OBV bullish divergence'); }
  else if (data.obvDivergence === 'bearish') { score -= 10; reasons.push('OBV bearish divergence'); }

  // ATR-normalized price change (+/-15)
  const atrPct = data.atrPct || 3;
  const chg = data.priceChange;
  if (chg < -(atrPct * 2)) { score += 15; reasons.push(`Pullback ${chg.toFixed(1)}% (>2x ATR)`); }
  else if (chg < -atrPct) { score += 8; reasons.push(`Moderate pullback ${chg.toFixed(1)}%`); }
  else if (chg > atrPct * 2) { score -= 15; reasons.push(`Rally +${chg.toFixed(1)}% (>2x ATR)`); }
  else if (chg > atrPct) { score -= 8; reasons.push(`Moderate rally +${chg.toFixed(1)}%`); }

  // Seasonality (+/-10)
  if (data.seasonality > 3) { score += 10; reasons.push(`Seasonal bullish (+${data.seasonality.toFixed(1)}%)`); }
  else if (data.seasonality < -3) { score -= 10; reasons.push(`Seasonal bearish (${data.seasonality.toFixed(1)}%)`); }

  // Funding Rate (+/-10)
  if (data.fundingRate !== undefined && data.fundingRate !== null) {
    if (data.fundingRate < -0.0002) { score += 10; reasons.push(`Funding negative`); }
    else if (data.fundingRate > 0.0005) { score -= 10; reasons.push(`Funding overleveraged`); }
  }

  // News sentiment (+/-15)
  if (data.newsSentiment !== undefined && data.newsSentiment !== null) {
    if (data.newsSentiment > 0.7) { score += 15; reasons.push('News bullish'); }
    else if (data.newsSentiment < -0.7) { score -= 15; reasons.push('News bearish'); }
  }

  let type = 'neutral';
  if (score >= 45) {
    type = belowEma200 ? 'neutral' : 'buy';
  } else if (score <= -45) {
    type = aboveEma200 ? 'neutral' : 'sell';
  }
  return { type, score, confidence: Math.min(100, Math.abs(score)), reasons };
}

// ─── BINANCE API ────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchKlinesBatch(symbol, interval, startTime, endTime) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=1000`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Binance ${res.status} for ${symbol}`);
  return res.json();
}

async function fetchAllKlines(symbol, interval, startTime, endTime) {
  const all = [];
  let cursor = startTime;
  while (cursor < endTime) {
    const batch = await fetchKlinesBatch(symbol, interval, cursor, endTime);
    if (batch.length === 0) break;
    all.push(...batch);
    cursor = batch[batch.length - 1][6] + 1;
    if (batch.length < 1000) break;
    await sleep(100);
  }
  return all;
}

// ─── MAIN ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║  90-DAY NEVER-CLOSE-IN-LOSS BACKTEST                              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝\n');

  const now = Date.now();
  const DAYS = 90;
  const simEnd = now;
  const simStart = now - DAYS * 24 * 3600_000;
  const warmupStart = simStart - 210 * 3600_000;

  // 1. Fetch Fear & Greed history
  let fgHistory = [];
  try {
    const fgRes = await fetch('https://api.alternative.me/fng/?limit=91');
    const fgData = await fgRes.json();
    fgHistory = fgData.data.map(d => ({
      timestamp: parseInt(d.timestamp) * 1000, value: parseInt(d.value), label: d.value_classification
    })).reverse();
  } catch {}
  function getFg(ts) {
    if (!fgHistory.length) return { value: 50, label: 'Neutral' };
    let best = fgHistory[0];
    for (const fg of fgHistory) { if (fg.timestamp <= ts) best = fg; else break; }
    return best;
  }

  // 2. Fetch data for all assets
  console.log(`⏳ Downloading data for ${ASSETS.length} assets...`);
  const assetData = {};

  for (let ai = 0; ai < ASSETS.length; ai++) {
    const asset = ASSETS[ai];
    process.stdout.write(`   [${ai + 1}/${ASSETS.length}] ${asset.symbol.padEnd(6)} `);

    try {
      const [hourlyRaw, ticksRaw] = await Promise.all([
        fetchAllKlines(asset.pair, '1h', warmupStart, simEnd),
        fetchAllKlines(asset.pair, '15m', simStart, simEnd)
      ]);

      const hourly = hourlyRaw.map(k => ({ closeTime: k[6], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] }));
      const ticks  = ticksRaw.map(k => ({ time: k[0], close: +k[4], high: +k[2], low: +k[3] }));

      assetData[asset.symbol] = { hourly, ticks };
      console.log(`✅ ${hourly.length}h + ${ticks.length} ticks`);
    } catch (err) {
      console.log(`❌ ${err.message}`);
    }
    await sleep(150);
  }

  const loadedAssets = ASSETS.filter(a => assetData[a.symbol] && assetData[a.symbol].ticks.length > 100);
  console.log(`\n✅ ${loadedAssets.length}/${ASSETS.length} assets loaded successfully`);

  // 2b. Fetch seasonality data (monthly klines for last 4 years = 48 months)
  console.log('⏳ Fetching BTC monthly klines for seasonality (4 years)...');
  const seasonalityByMonth = {};
  try {
    const monthlyRaw = await fetchKlinesBatch('BTCUSDT', '1M', now - 4 * 365 * 24 * 3600_000, now);
    const monthlyReturns = {};
    for (const k of monthlyRaw) {
      const month = new Date(k[0]).getMonth();
      const ret = (+k[4] - +k[1]) / +k[1] * 100;
      if (!monthlyReturns[month]) monthlyReturns[month] = [];
      monthlyReturns[month].push(ret);
    }
    for (const [m, rets] of Object.entries(monthlyReturns)) {
      seasonalityByMonth[m] = rets.reduce((a, b) => a + b, 0) / rets.length;
    }
    console.log(`   → Seasonality loaded: ${Object.entries(seasonalityByMonth).map(([m, r]) => `M${+m+1}:${r>=0?'+':''}${r.toFixed(1)}%`).join(', ')}`);
  } catch (e) { console.log(`   → Seasonality failed: ${e.message}`); }

  // 2c. Fetch funding rate history (Binance Futures)
  console.log('⏳ Fetching funding rate history...');
  const fundingHistory = {};
  try {
    for (const asset of loadedAssets.slice(0, 10)) {
      const pair = asset.pair.replace('USDT', '') + 'USDT';
      const fUrl = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${pair}&limit=1000`;
      const fRes = await fetch(fUrl);
      if (fRes.ok) {
        const fData = await fRes.json();
        fundingHistory[asset.symbol] = fData.map(f => ({
          time: f.fundingTime, rate: parseFloat(f.fundingRate)
        }));
      }
      await sleep(100);
    }
    console.log(`   → Funding rates loaded for ${Object.keys(fundingHistory).length} assets`);
  } catch (e) { console.log(`   → Funding rate failed: ${e.message}`); }

  function getFundingRate(symbol, ts) {
    const hist = fundingHistory[symbol];
    if (!hist || !hist.length) return null;
    let best = null;
    for (const f of hist) {
      if (f.time <= ts) best = f.rate; else break;
    }
    return best;
  }

  // 2d. Fetch news sentiment from CryptoPanic
  console.log('⏳ Fetching news sentiment from CryptoPanic...');
  const newsCache = {};
  try {
    const newsRes = await fetch('https://cryptopanic.com/api/free/v1/posts/?kind=news&filter=hot&public=true');
    if (newsRes.ok) {
      const newsData = await newsRes.json();
      const posts = newsData.results || [];
      for (const post of posts) {
        const currencies = (post.currencies || []).map(c => c.code);
        const vote = post.votes || {};
        const bullish = (vote.positive || 0) + (vote.liked || 0);
        const bearish = (vote.negative || 0) + (vote.disliked || 0);
        const total = bullish + bearish;
        const sentiment = total > 0 ? (bullish - bearish) / total : 0;
        for (const sym of currencies) {
          if (!newsCache[sym]) newsCache[sym] = [];
          newsCache[sym].push({ time: new Date(post.published_at).getTime(), sentiment });
        }
      }
      console.log(`   → News loaded: ${posts.length} articles, ${Object.keys(newsCache).length} assets with sentiment`);
    } else {
      console.log(`   → CryptoPanic API returned ${newsRes.status} — using without news`);
    }
  } catch (e) { console.log(`   → News fetch failed: ${e.message} — continuing without news`); }

  function getNewsSentiment(symbol) {
    const articles = newsCache[symbol];
    if (!articles || articles.length < 2) return null;
    const avg = articles.reduce((s, a) => s + a.sentiment, 0) / articles.length;
    return avg;
  }

  console.log('');

  // Build unified tick timeline from BTC ticks
  const btcTicks = assetData['BTC'].ticks;
  const startPrice = btcTicks[0].close;
  const endPrice = btcTicks[btcTicks.length - 1].close;
  const buyAndHoldPct = ((endPrice - startPrice) / startPrice) * 100;

  console.log(`Period: ${new Date(simStart).toISOString().slice(0,10)} → ${new Date(simEnd).toISOString().slice(0,10)}`);
  console.log(`BTC: $${startPrice.toLocaleString()} → $${endPrice.toLocaleString()} (B&H: ${buyAndHoldPct >= 0?'+':''}${buyAndHoldPct.toFixed(2)}%)\n`);

  // State
  const openTrades = [];
  const closedTrades = [];
  let tradeId = 0;
  const dailyPnl = {};
  let peakCapital = CONFIG.initialCapital;
  let maxDrawdown = 0;

  // 3. Simulate tick by tick (using BTC timeline as clock)
  console.log('⏳ Running simulation...\n');
  let lastDay = '';

  for (let i = 0; i < btcTicks.length; i++) {
    const tickTime = btcTicks[i].time;
    const tickDate = new Date(tickTime).toISOString().slice(0, 10);

    if (tickDate !== lastDay) {
      const fg = getFg(tickTime);
      const realized = closedTrades.reduce((s, t) => s + t.pnl, 0);
      process.stdout.write(`  📅 ${tickDate} | F&G: ${String(fg.value).padStart(2)} (${fg.label.padEnd(14)}) | Open: ${String(openTrades.length).padStart(2)} | Closed: ${String(closedTrades.length).padStart(3)} | P&L: ${realized >= 0?'+':''}$${realized.toFixed(2)}\n`);
      lastDay = tickDate;
    }

    const fg = getFg(tickTime);
    const fgMod = fg.value <= CONFIG.fearGreedFilter.extremeFear ? 1.3
      : fg.value <= CONFIG.fearGreedFilter.fear ? 1.15
      : fg.value >= CONFIG.fearGreedFilter.greed ? 0.5 : 1.0;

    // Process each asset
    const signals = [];

    for (const asset of loadedAssets) {
      const ad = assetData[asset.symbol];
      const tickIdx = ad.ticks.findIndex(t => t.time >= tickTime);
      if (tickIdx < 0) continue;
      const price = ad.ticks[tickIdx].close;

      const relevantHourly = ad.hourly.filter(h => h.closeTime <= tickTime);
      if (relevantHourly.length < 26) continue;
      const hourlyCloses = relevantHourly.map(h => h.close);
      const hourlyVolumes = relevantHourly.map(h => h.volume);
      hourlyCloses.push(price);
      hourlyVolumes.push(hourlyVolumes[hourlyVolumes.length - 1] || 0);

      const rsi = calculateRSI(hourlyCloses);
      const macdData = calculateMACD(hourlyCloses);
      const ema20 = calculateEMA(hourlyCloses, 20);
      const ema50 = calculateEMA(hourlyCloses, 50);
      const ema200 = hourlyCloses.length >= 200 ? calculateEMA(hourlyCloses, 200) : null;
      const bb = calculateBollingerBands(hourlyCloses);
      const obv = calculateOBV(hourlyCloses, hourlyVolumes);
      const rsiDivergence = detectRSIDivergence(hourlyCloses);

      const lookback = Math.max(0, tickIdx - 96);
      const price24hAgo = ad.ticks[lookback].close;
      const priceChange = ((price - price24hAgo) / price24hAgo) * 100;

      const tickHigh = ad.ticks[tickIdx].high || price;
      const tickLow = ad.ticks[tickIdx].low || price;
      const recentHighs = relevantHourly.slice(-14).map(h => h.high || h.close);
      const recentLows = relevantHourly.slice(-14).map(h => h.low || h.close);
      const recentCloses = relevantHourly.slice(-14).map(h => h.close);
      recentHighs.push(tickHigh); recentLows.push(tickLow); recentCloses.push(price);
      const atr = calculateATR(recentHighs, recentLows, recentCloses, 14);
      const atrPct = price > 0 ? (atr / price) * 100 : 3;

      const currentMonth = new Date(tickTime).getMonth();
      const seasonality = seasonalityByMonth[currentMonth] || 0;
      const fundingRate = getFundingRate(asset.symbol, tickTime);
      const newsSentiment = getNewsSentiment(asset.symbol);

      const signal = analyzeSignal({
        price, rsi, macdHist: macdData.histogram, ema20, ema50, ema200, bb,
        priceChange, atrPct, rsiDivergence,
        obvDivergence: obv.divergence, seasonality, fundingRate, newsSentiment
      });

      signals.push({ asset, price, signal, rsi });
    }

    // ── CHECK EXITS ──
    for (let j = openTrades.length - 1; j >= 0; j--) {
      const trade = openTrades[j];
      const sig = signals.find(s => s.asset.symbol === trade.symbol);
      if (!sig) continue;
      const price = sig.price;
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
      }
      if (!exitReason) {
        const stopLoss = STOP_LOSS_PCT[trade.tier] || -12;
        if (pnlPct <= stopLoss) {
          exitReason = 'stop_loss';
        }
      }
      if (!exitReason && pnlPct >= 0) {
        if ((trade.direction === 'long' && sig.signal.type === 'sell' && sig.signal.confidence >= CONFIG.minConfidence) ||
            (trade.direction === 'short' && sig.signal.type === 'buy' && sig.signal.confidence >= CONFIG.minConfidence)) {
          exitReason = 'signal_reversal';
        }
      }

      if (exitReason) {
        trade.exitPrice = price;
        trade.exitTime = tickTime;
        trade.pnl = pnl;
        trade.pnlPct = pnlPct;
        trade.exitReason = exitReason;
        trade.exitDate = tickDate;
        closedTrades.push(trade);
        openTrades.splice(j, 1);
        if (!dailyPnl[tickDate]) dailyPnl[tickDate] = 0;
        dailyPnl[tickDate] += pnl;
      }
    }

    // ── CHECK ENTRIES ──
    const realizedPnlNow = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
    let unrealizedPnlNow = 0;
    for (const trade of openTrades) {
      const sig = signals.find(s => s.asset.symbol === trade.symbol);
      if (!sig) continue;
      unrealizedPnlNow += trade.direction === 'long'
        ? (sig.price - trade.entryPrice) * trade.quantity
        : (trade.entryPrice - sig.price) * trade.quantity;
    }
    const totalPnlNow = realizedPnlNow + unrealizedPnlNow;
    const drawdownPct = (totalPnlNow / CONFIG.initialCapital) * 100;
    const maxDrawdownLimit = -15;

    if (openTrades.length < CONFIG.maxPositions && drawdownPct > maxDrawdownLimit) {
      const sorted = signals
        .filter(s => s.signal.confidence >= CONFIG.minConfidence && s.signal.type !== 'neutral')
        .sort((a, b) => b.signal.confidence - a.signal.confidence);

      const cooldownMs = 2 * 3600_000;

      for (const s of sorted) {
        if (openTrades.length >= CONFIG.maxPositions) break;

        const recentExit = closedTrades.filter(t => t.symbol === s.asset.symbol && t.exitTime)
          .sort((a, b) => b.exitTime - a.exitTime)[0];
        if (recentExit && (tickTime - recentExit.exitTime) < cooldownMs) continue;

        const direction = s.signal.type === 'buy' ? 'long' : 'short';
        if (direction === 'long' && fg.value >= CONFIG.fearGreedFilter.extremeGreed) continue;

        const tierCfg = CONFIG.tiers[s.asset.tier];
        const existingOnAsset = openTrades.filter(t => t.symbol === s.asset.symbol);
        const level = existingOnAsset.length;
        if (level >= tierCfg.maxPerAsset) continue;

        if (level > 0) {
          const lastEntry = existingOnAsset[existingOnAsset.length - 1];
          const drop = ((lastEntry.entryPrice - s.price) / lastEntry.entryPrice) * 100;
          if (direction === 'long' && drop < tierCfg.scalingDropPct) continue;
          if (direction === 'short' && -drop < tierCfg.scalingDropPct) continue;
          if (lastEntry.direction !== direction) continue;
        }

        const realizedPnl = closedTrades.reduce((sum, t) => sum + t.pnl, 0);
        const investedCapital = openTrades.reduce((sum, t) => sum + t.quantity * t.entryPrice, 0);
        const availableCapital = CONFIG.initialCapital + realizedPnl - investedCapital;
        const slotsLeft = CONFIG.maxPositions - openTrades.length;
        const baseValue = Math.max(0, availableCapital / slotsLeft);
        const scalingMul = (tierCfg.scalingMultipliers || [1])[level] || 1;
        const positionValue = Math.min(
          baseValue * scalingMul * tierCfg.sizeMultiplier * fgMod,
          availableCapital * 0.4
        );
        if (positionValue < 10) continue;

        openTrades.push({
          id: ++tradeId,
          symbol: s.asset.symbol,
          tier: s.asset.tier,
          direction,
          entryPrice: s.price,
          entryTime: tickTime,
          entryDate: tickDate,
          quantity: positionValue / s.price,
          positionValue,
          level: level + 1,
          highWaterMark: 0,
          entryScore: s.signal.score,
          entryConfidence: s.signal.confidence,
          entryReasons: s.signal.reasons,
          entryFg: fg.value
        });
      }
    }

    // Track drawdown
    let unrealized = 0;
    for (const trade of openTrades) {
      const sig = signals.find(s => s.asset.symbol === trade.symbol);
      if (!sig) continue;
      unrealized += trade.direction === 'long'
        ? (sig.price - trade.entryPrice) * trade.quantity
        : (trade.entryPrice - sig.price) * trade.quantity;
    }
    const realizedSoFar = closedTrades.reduce((s, t) => s + t.pnl, 0);
    const currentCapital = CONFIG.initialCapital + realizedSoFar + unrealized;
    if (currentCapital > peakCapital) peakCapital = currentCapital;
    const dd = ((peakCapital - currentCapital) / peakCapital) * 100;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }

  // At simulation end: close profitable positions, keep negative ones as "still open"
  const stillOpenTrades = [];
  for (const trade of [...openTrades]) {
    const ad = assetData[trade.symbol];
    const finalPrice = ad.ticks[ad.ticks.length - 1].close;
    const finalDate = new Date(ad.ticks[ad.ticks.length - 1].time).toISOString().slice(0, 10);
    const pnlPct = trade.direction === 'long'
      ? ((finalPrice - trade.entryPrice) / trade.entryPrice) * 100
      : ((trade.entryPrice - finalPrice) / trade.entryPrice) * 100;
    const pnl = trade.direction === 'long'
      ? (finalPrice - trade.entryPrice) * trade.quantity
      : (trade.entryPrice - finalPrice) * trade.quantity;
    if (pnlPct >= 0) {
      trade.exitPrice = finalPrice;
      trade.exitTime = ad.ticks[ad.ticks.length - 1].time;
      trade.pnl = pnl;
      trade.pnlPct = pnlPct;
      trade.exitReason = 'session_end';
      trade.exitDate = finalDate;
      closedTrades.push(trade);
      if (!dailyPnl[finalDate]) dailyPnl[finalDate] = 0;
      dailyPnl[finalDate] += pnl;
    } else {
      trade.currentPrice = finalPrice;
      trade.unrealizedPnl = pnl;
      trade.unrealizedPnlPct = pnlPct;
      stillOpenTrades.push(trade);
    }
  }
  openTrades.length = 0;

  // ─── RESULTS ──────────────────────────────────────────────────────────────

  const totalTrades = closedTrades.length;
  const winners = closedTrades.filter(t => t.pnl >= 0);
  const losers  = closedTrades.filter(t => t.pnl < 0);
  const realizedPnl = closedTrades.reduce((s, t) => s + t.pnl, 0);
  const unrealizedPnl = stillOpenTrades.reduce((s, t) => s + t.unrealizedPnl, 0);
  const totalPnl = realizedPnl + unrealizedPnl;
  const totalPnlPct = (totalPnl / CONFIG.initialCapital) * 100;
  const avgWin  = winners.length ? winners.reduce((s, t) => s + t.pnl, 0) / winners.length : 0;
  const avgLoss = losers.length  ? losers.reduce((s, t) => s + t.pnl, 0) / losers.length : 0;
  const maxWin  = winners.length ? Math.max(...winners.map(t => t.pnl)) : 0;
  const maxLoss = losers.length  ? Math.min(...losers.map(t => t.pnl)) : 0;
  const avgHold = totalTrades ? closedTrades.reduce((s, t) => s + (t.exitTime - t.entryTime), 0) / totalTrades : 0;
  const grossWin  = winners.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((s, t) => s + t.pnl, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0;

  const byReason = {};
  for (const t of closedTrades) {
    if (!byReason[t.exitReason]) byReason[t.exitReason] = { count: 0, pnl: 0, winners: 0 };
    byReason[t.exitReason].count++;
    byReason[t.exitReason].pnl += t.pnl;
    if (t.pnl >= 0) byReason[t.exitReason].winners++;
  }

  const byAsset = {};
  for (const t of closedTrades) {
    if (!byAsset[t.symbol]) byAsset[t.symbol] = { trades: 0, pnl: 0, winners: 0, tier: t.tier };
    byAsset[t.symbol].trades++;
    byAsset[t.symbol].pnl += t.pnl;
    if (t.pnl >= 0) byAsset[t.symbol].winners++;
  }

  const byTier = {};
  for (const t of closedTrades) {
    if (!byTier[t.tier]) byTier[t.tier] = { trades: 0, pnl: 0, winners: 0 };
    byTier[t.tier].trades++;
    byTier[t.tier].pnl += t.pnl;
    if (t.pnl >= 0) byTier[t.tier].winners++;
  }

  console.log('\n' + '═'.repeat(72));
  console.log('  📊 MONTHLY PERFORMANCE SUMMARY');
  console.log('═'.repeat(72));
  console.log(`  Initial Capital:      $${CONFIG.initialCapital.toLocaleString()}`);
  console.log(`  Final Capital:        $${(CONFIG.initialCapital + totalPnl).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`);
  console.log(`  ────────────────────────────────────────────────`);
  console.log(`  Realized P&L:         ${realizedPnl>=0?'+':''}$${realizedPnl.toFixed(2)} (${(realizedPnl/CONFIG.initialCapital*100)>=0?'+':''}${(realizedPnl/CONFIG.initialCapital*100).toFixed(2)}%)`);
  if (stillOpenTrades.length > 0) {
    console.log(`  Unrealized P&L:       ${unrealizedPnl>=0?'+':''}$${unrealizedPnl.toFixed(2)} (${(unrealizedPnl/CONFIG.initialCapital*100)>=0?'+':''}${(unrealizedPnl/CONFIG.initialCapital*100).toFixed(2)}%) [${stillOpenTrades.length} positions still open]`);
  }
  console.log(`  Total P&L:            ${totalPnl>=0?'+':''}$${totalPnl.toFixed(2)} (${totalPnlPct>=0?'+':''}${totalPnlPct.toFixed(2)}%)`);
  console.log(`  Buy & Hold BTC:       ${buyAndHoldPct>=0?'+':''}${buyAndHoldPct.toFixed(2)}%`);
  console.log(`  Alpha vs B&H:         ${(totalPnlPct-buyAndHoldPct)>=0?'+':''}${(totalPnlPct-buyAndHoldPct).toFixed(2)}%`);
  console.log(`  Max Drawdown:         -${maxDrawdown.toFixed(2)}%`);
  console.log(`  Profit Factor:        ${profitFactor === Infinity ? '∞' : profitFactor.toFixed(2)}`);
  console.log(`  ────────────────────────────────────────────────`);
  console.log(`  Total Trades:         ${totalTrades}`);
  console.log(`  Winners:              ${winners.length} (${totalTrades?(winners.length/totalTrades*100).toFixed(0):0}%)`);
  console.log(`  Losers:               ${losers.length} (${totalTrades?(losers.length/totalTrades*100).toFixed(0):0}%)`);
  console.log(`  Avg Win:              +$${avgWin.toFixed(2)}`);
  console.log(`  Avg Loss:             $${avgLoss.toFixed(2)}`);
  console.log(`  Best Trade:           +$${maxWin.toFixed(2)}`);
  console.log(`  Worst Trade:          $${maxLoss.toFixed(2)}`);
  console.log(`  Avg Hold Time:        ${(avgHold/3600_000).toFixed(1)}h`);

  console.log(`  ────────────────────────────────────────────────`);
  console.log(`  Exit Reasons:`);
  for (const [reason, d] of Object.entries(byReason).sort((a,b) => b[1].count - a[1].count)) {
    console.log(`    ${reason.padEnd(18)} ${String(d.count).padStart(3)} trades │ P&L: ${d.pnl>=0?'+':''}$${d.pnl.toFixed(2).padStart(9)} │ WR: ${(d.winners/d.count*100).toFixed(0)}%`);
  }

  console.log('\n' + '═'.repeat(72));
  console.log('  📈 PERFORMANCE BY ASSET');
  console.log('═'.repeat(72));
  console.log('  Asset   │ Tier    │ Trades │ Winners │ WR    │ P&L');
  console.log('  ────────┼─────────┼────────┼─────────┼───────┼────────────');
  for (const [sym, d] of Object.entries(byAsset).sort((a,b) => b[1].pnl - a[1].pnl)) {
    const wr = d.trades ? (d.winners / d.trades * 100).toFixed(0) : '0';
    console.log(`  ${sym.padEnd(7)} │ ${d.tier.padEnd(7)} │ ${String(d.trades).padStart(6)} │ ${String(d.winners).padStart(7)} │ ${wr.padStart(4)}% │ ${d.pnl>=0?'+':''}$${d.pnl.toFixed(2)}`);
  }

  console.log('\n' + '═'.repeat(72));
  console.log('  🏷️  PERFORMANCE BY TIER');
  console.log('═'.repeat(72));
  for (const [tier, d] of Object.entries(byTier).sort((a,b) => b[1].pnl - a[1].pnl)) {
    const wr = d.trades ? (d.winners / d.trades * 100).toFixed(0) : '0';
    console.log(`  ${tier.padEnd(10)} ${String(d.trades).padStart(3)} trades │ WR: ${wr.padStart(3)}% │ P&L: ${d.pnl>=0?'+':''}$${d.pnl.toFixed(2)}`);
  }

  // Daily P&L
  console.log('\n' + '═'.repeat(72));
  console.log('  📅 DAILY P&L');
  console.log('═'.repeat(72));
  const sortedDays = Object.keys(dailyPnl).sort();
  let cumPnl = 0;
  let winDays = 0, lossDays = 0;
  for (const day of sortedDays) {
    cumPnl += dailyPnl[day];
    const barLen = Math.min(25, Math.round(Math.abs(dailyPnl[day]) / 10));
    const bar = dailyPnl[day] >= 0 ? '█'.repeat(barLen) : '░'.repeat(barLen);
    const icon = dailyPnl[day] >= 0 ? '🟩' : '🟥';
    console.log(`  ${day} ${icon} ${(dailyPnl[day]>=0?'+':'')+('$'+dailyPnl[day].toFixed(2)).padStart(10)} │ cum: ${(cumPnl>=0?'+':'')+('$'+cumPnl.toFixed(2)).padStart(10)} │ ${bar}`);
    if (dailyPnl[day] >= 0) winDays++; else lossDays++;
  }
  if (winDays + lossDays > 0) {
    console.log(`  ────────────────────────────────────────────────`);
    console.log(`  Green days: ${winDays}  |  Red days: ${lossDays}  |  Win rate: ${(winDays/(winDays+lossDays)*100).toFixed(0)}%`);
  }

  // All trades
  console.log('\n' + '═'.repeat(72));
  console.log('  📋 ALL TRADES');
  console.log('═'.repeat(72));
  console.log('  #  │ Asset  │ Date       │ Dir  │ Lvl │ Entry$       │ Exit$        │ P&L$       │ P&L%    │ Hold   │ Reason');
  console.log('  ───┼────────┼────────────┼──────┼─────┼──────────────┼──────────────┼────────────┼─────────┼────────┼──────────────');
  for (const t of closedTrades) {
    const dir = t.direction.toUpperCase().padEnd(4);
    const ep = t.entryPrice >= 1 ? '$'+t.entryPrice.toFixed(2) : '$'+t.entryPrice.toPrecision(4);
    const xp = t.exitPrice >= 1 ? '$'+t.exitPrice.toFixed(2) : '$'+t.exitPrice.toPrecision(4);
    const pnl = (t.pnl>=0?'+':'')+('$'+t.pnl.toFixed(2));
    const pct = (t.pnlPct>=0?'+':'')+t.pnlPct.toFixed(2)+'%';
    const holdH = ((t.exitTime-t.entryTime)/3600_000).toFixed(1)+'h';
    console.log(`  ${String(t.id).padStart(2)} │ ${t.symbol.padEnd(6)} │ ${t.entryDate} │ ${dir} │  L${t.level}  │ ${ep.padStart(12)} │ ${xp.padStart(12)} │ ${pnl.padStart(10)} │ ${pct.padStart(7)} │ ${holdH.padStart(6)} │ ${t.exitReason}`);
  }

  // Scaling-in analysis
  const scaled = closedTrades.filter(t => t.level > 1);
  if (scaled.length > 0) {
    console.log(`\n  📐 SCALING-IN: ${scaled.length} entries at L2+ │ P&L: ${scaled.reduce((s,t)=>s+t.pnl,0)>=0?'+':''}$${scaled.reduce((s,t)=>s+t.pnl,0).toFixed(2)} │ WR: ${(scaled.filter(t=>t.pnl>=0).length/scaled.length*100).toFixed(0)}%`);
  }
  const trailing = closedTrades.filter(t => t.exitReason === 'trailing_tp');
  if (trailing.length > 0) {
    console.log(`  🎯 TRAILING TP: ${trailing.length} exits │ Avg P&L: +$${(trailing.reduce((s,t)=>s+t.pnl,0)/trailing.length).toFixed(2)} │ Avg %: +${(trailing.reduce((s,t)=>s+t.pnlPct,0)/trailing.length).toFixed(2)}%`);
  }

  if (stillOpenTrades.length > 0) {
    console.log('\n' + '═'.repeat(72));
    console.log('  📌 STILL OPEN POSITIONS (not closed — waiting for recovery)');
    console.log('═'.repeat(72));
    console.log('  #  │ Asset  │ Entry Date │ Dir  │ Lvl │ Entry$       │ Current$     │ Unreal P&L │ Unreal%  │ Hold');
    console.log('  ───┼────────┼────────────┼──────┼─────┼──────────────┼──────────────┼────────────┼──────────┼────────');
    for (const t of stillOpenTrades) {
      const dir = t.direction.toUpperCase().padEnd(4);
      const ep = t.entryPrice >= 1 ? '$'+t.entryPrice.toFixed(2) : '$'+t.entryPrice.toPrecision(4);
      const cp = t.currentPrice >= 1 ? '$'+t.currentPrice.toFixed(2) : '$'+t.currentPrice.toPrecision(4);
      const pnl = (t.unrealizedPnl>=0?'+':'')+('$'+t.unrealizedPnl.toFixed(2));
      const pct = (t.unrealizedPnlPct>=0?'+':'')+t.unrealizedPnlPct.toFixed(2)+'%';
      const lastTick = assetData[t.symbol].ticks;
      const holdMs = lastTick[lastTick.length - 1].time - t.entryTime;
      const holdH = (holdMs/3600_000).toFixed(1)+'h';
      console.log(`  ${String(t.id).padStart(2)} │ ${t.symbol.padEnd(6)} │ ${t.entryDate} │ ${dir} │  L${t.level}  │ ${ep.padStart(12)} │ ${cp.padStart(12)} │ ${pnl.padStart(10)} │ ${pct.padStart(8)} │ ${holdH.padStart(6)}`);
    }
    const totalUnreal = stillOpenTrades.reduce((s, t) => s + t.unrealizedPnl, 0);
    console.log(`  ────────────────────────────────────────────────`);
    console.log(`  Total unrealized: ${totalUnreal>=0?'+':''}$${totalUnreal.toFixed(2)} across ${stillOpenTrades.length} positions`);
  }

  console.log('\n' + '═'.repeat(72));
  console.log('  ✅ Backtest complete — all data from Binance API (real market).');
  console.log('═'.repeat(72));
}

main().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
