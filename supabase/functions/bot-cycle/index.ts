import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin', tier: 'major', pairs: { usd: 'BTCUSDT', eur: 'BTCEUR' } },
  { symbol: 'ETH', name: 'Ethereum', tier: 'major', pairs: { usd: 'ETHUSDT', eur: 'ETHEUR' } },
  { symbol: 'SOL', name: 'Solana', tier: 'major', pairs: { usd: 'SOLUSDT', eur: 'SOLEUR' } },
  { symbol: 'BNB', name: 'Binance Coin', tier: 'major', pairs: { usd: 'BNBUSDT', eur: 'BNBEUR' } },
  { symbol: 'XRP', name: 'Ripple', tier: 'altcoin', pairs: { usd: 'XRPUSDT', eur: 'XRPEUR' } },
  { symbol: 'ADA', name: 'Cardano', tier: 'altcoin', pairs: { usd: 'ADAUSDT', eur: 'ADAEUR' } },
  { symbol: 'DOGE', name: 'Dogecoin', tier: 'meme', pairs: { usd: 'DOGEUSDT', eur: 'DOGEEUR' } },
  { symbol: 'AVAX', name: 'Avalanche', tier: 'altcoin', pairs: { usd: 'AVAXUSDT', eur: 'AVAXEUR' } },
  { symbol: 'LINK', name: 'Chainlink', tier: 'altcoin', pairs: { usd: 'LINKUSDT', eur: 'LINKEUR' } },
  { symbol: 'DOT', name: 'Polkadot', tier: 'altcoin', pairs: { usd: 'DOTUSDT', eur: 'DOTEUR' } },
  { symbol: 'SHIB', name: 'Shiba Inu', tier: 'meme', pairs: { usd: 'SHIBUSDT', eur: 'SHIBEUR' } },
  { symbol: 'MATIC', name: 'Polygon', tier: 'altcoin', pairs: { usd: 'MATICUSDT', eur: 'MATICEUR' } },
  { symbol: 'LTC', name: 'Litecoin', tier: 'altcoin', pairs: { usd: 'LTCUSDT', eur: 'LTCEUR' } },
  { symbol: 'UNI', name: 'Uniswap', tier: 'altcoin', pairs: { usd: 'UNIUSDT', eur: 'UNIEUR' } },
  { symbol: 'NEAR', name: 'NEAR Protocol', tier: 'altcoin', pairs: { usd: 'NEARUSDT', eur: 'NEAREUR' } },
  { symbol: 'SUI', name: 'Sui', tier: 'altcoin', pairs: { usd: 'SUIUSDT', eur: 'SUIEUR' } },
  { symbol: 'PEPE', name: 'Pepe', tier: 'meme', pairs: { usd: 'PEPEUSDT', eur: 'PEPEEUR' } },
  { symbol: 'TRX', name: 'Tron', tier: 'altcoin', pairs: { usd: 'TRXUSDT', eur: 'TRXEUR' } },
  { symbol: 'XLM', name: 'Stellar', tier: 'altcoin', pairs: { usd: 'XLMUSDT', eur: 'XLMEUR' } },
  { symbol: 'APT', name: 'Aptos', tier: 'altcoin', pairs: { usd: 'APTUSDT', eur: 'APTEUR' } }
];

function getBinancePair(asset: any, currency: string): string {
  if (currency === 'chf') return asset.pairs.usd;
  return asset.pairs[currency] || asset.pairs.usd;
}

function calculateRSI(prices: number[], period = 14): number {
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

function calculateEMA(prices: number[], period: number): number {
  if (prices.length < period) return prices[prices.length - 1];
  const k = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}

function calculateMACDSeries(prices: number[]): number[] {
  if (prices.length < 26) return [];
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
  return series;
}

function calculateMACD(prices: number[]) {
  const series = calculateMACDSeries(prices);
  if (series.length === 0) return { macd: 0, signal: 0, histogram: 0 };
  const macd = series[series.length - 1];
  const signalPeriod = 9;
  let signal: number;
  if (series.length < signalPeriod) {
    signal = series.reduce((a, b) => a + b, 0) / series.length;
  } else {
    const kSig = 2 / (signalPeriod + 1);
    signal = series.slice(0, signalPeriod).reduce((a, b) => a + b, 0) / signalPeriod;
    for (let i = signalPeriod; i < series.length; i++) signal = series[i] * kSig + signal * (1 - kSig);
  }
  return { macd, signal, histogram: macd - signal };
}

function calculateOBV(closes: number[], volumes: number[]): { trend: number; divergence: string } {
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

function calculateBollingerBands(prices: number[], period = 20, stdDev = 2) {
  if (prices.length < period) return { upper: 0, middle: 0, lower: 0 };
  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.map(p => Math.pow(p - middle, 2)).reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(variance);
  return { upper: middle + std * stdDev, middle, lower: middle - std * stdDev };
}

const STOP_LOSS_PCT: Record<string, number> = { major: -8, altcoin: -12, meme: -15 };

function analyzeSignal(data: any) {
  let score = 0;
  const reasons: string[] = [];

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
  const chg = data.priceChange24h;
  if (chg < -(atrPct * 2)) { score += 15; reasons.push(`Pullback (${chg.toFixed(1)}%, >2x ATR)`); }
  else if (chg < -atrPct) { score += 8; reasons.push(`Moderate pullback (${chg.toFixed(1)}%)`); }
  else if (chg > atrPct * 2) { score -= 15; reasons.push(`Rally (+${chg.toFixed(1)}%, >2x ATR)`); }
  else if (chg > atrPct) { score -= 8; reasons.push(`Moderate rally (+${chg.toFixed(1)}%)`); }

  if (data.seasonality > 3) { score += 10; reasons.push(`Seasonal bullish (+${data.seasonality.toFixed(1)}%)`); }
  else if (data.seasonality < -3) { score -= 10; reasons.push(`Seasonal bearish (${data.seasonality.toFixed(1)}%)`); }

  if (data.fundingRate !== undefined && data.fundingRate !== null) {
    if (data.fundingRate < -0.0002) { score += 10; reasons.push('Funding negative'); }
    else if (data.fundingRate > 0.0005) { score -= 10; reasons.push('Funding overleveraged'); }
  }

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

async function fetchSeasonality(): Promise<Record<number, number>> {
  try {
    const endTime = Date.now();
    const startTime = endTime - 4 * 365.25 * 24 * 3600 * 1000;
    const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1M&startTime=${Math.floor(startTime)}&endTime=${endTime}&limit=48`);
    const klines = await res.json();
    if (!Array.isArray(klines) || klines.length === 0) return {};
    const monthlyReturns: Record<number, number[]> = {};
    for (const k of klines) {
      const open = parseFloat(k[1]);
      const close = parseFloat(k[4]);
      const month = new Date(k[0]).getMonth();
      const ret = ((close - open) / open) * 100;
      if (!monthlyReturns[month]) monthlyReturns[month] = [];
      monthlyReturns[month].push(ret);
    }
    const averages: Record<number, number> = {};
    for (const [m, returns] of Object.entries(monthlyReturns)) {
      averages[Number(m)] = returns.reduce((a, b) => a + b, 0) / returns.length;
    }
    return averages;
  } catch { return {}; }
}

async function fetchFundingRates(): Promise<Record<string, number>> {
  const rates: Record<string, number> = {};
  const symbols = ASSETS.map(a => a.symbol + 'USDT');
  try {
    const fetches = symbols.map(async (sym) => {
      try {
        const res = await fetch(`https://fapi.binance.com/fapi/v1/fundingRate?symbol=${sym}&limit=1`);
        const data = await res.json();
        if (Array.isArray(data) && data.length > 0) {
          rates[sym.replace('USDT', '')] = parseFloat(data[0].fundingRate);
        }
      } catch { /* skip */ }
    });
    await Promise.allSettled(fetches);
  } catch { /* keep empty */ }
  return rates;
}

async function fetchNewsSentiment(): Promise<Record<string, number>> {
  const sentiments: Record<string, number> = {};
  try {
    const res = await fetch('https://cryptopanic.com/api/free/v1/posts/?kind=news&filter=hot&public=true');
    if (!res.ok) return sentiments;
    const data = await res.json();
    const posts = data.results || [];
    for (const post of posts) {
      const currencies = (post.currencies || []).map((c: any) => c.code);
      const vote = post.votes || {};
      const bullish = (vote.positive || 0) + (vote.liked || 0);
      const bearish = (vote.negative || 0) + (vote.disliked || 0);
      const total = bullish + bearish;
      const sentiment = total > 0 ? (bullish - bearish) / total : 0;
      for (const sym of currencies) {
        if (!sentiments[sym]) sentiments[sym] = 0;
        sentiments[sym] = (sentiments[sym] + sentiment) / 2;
      }
    }
  } catch { /* keep empty */ }
  return sentiments;
}

function calculateATR(klines: any[], period = 14): number {
  if (klines.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < klines.length; i++) {
    const high = parseFloat(klines[i][2]);
    const low = parseFloat(klines[i][3]);
    const prevClose = parseFloat(klines[i - 1][4]);
    trs.push(Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose)));
  }
  const recentTrs = trs.slice(-period);
  return recentTrs.reduce((a, b) => a + b, 0) / recentTrs.length;
}

function detectRSIDivergence(prices: number[], period = 14, lookback = 5): string {
  if (prices.length < period + lookback + 1) return 'none';
  const rsiSeries: number[] = [];
  for (let end = period + 1; end <= prices.length; end++) {
    const slice = prices.slice(0, end);
    rsiSeries.push(calculateRSI(slice, period));
  }
  const recentPrices = prices.slice(-lookback);
  const recentRsi = rsiSeries.slice(-lookback);
  const priceDown = recentPrices[recentPrices.length - 1] < recentPrices[0];
  const rsiUp = recentRsi[recentRsi.length - 1] > recentRsi[0];
  const priceUp = recentPrices[recentPrices.length - 1] > recentPrices[0];
  const rsiDown = recentRsi[recentRsi.length - 1] < recentRsi[0];
  if (priceDown && rsiUp) return 'bullish';
  if (priceUp && rsiDown) return 'bearish';
  return 'none';
}

async function fetchMarketData(
  asset: any, currency: string, chfRate: number | null,
  seasonality: number, fundingRate: number | null, newsSentiment: number | null
) {
  const pair = getBinancePair(asset, currency);
  const [tickerRes, klinesRes] = await Promise.all([
    fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${pair}`),
    fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=4h&limit=200`)
  ]);
  const ticker = await tickerRes.json();
  const klines = await klinesRes.json();
  const prices = klines.map((k: any) => parseFloat(k[4]));
  const volumes = klines.map((k: any) => parseFloat(k[5]));
  let currentPrice = parseFloat(ticker.lastPrice);
  let high24h = parseFloat(ticker.highPrice);
  let low24h = parseFloat(ticker.lowPrice);
  const volume24h = parseFloat(ticker.volume);
  if (currency === 'chf' && chfRate) {
    currentPrice *= chfRate;
    high24h *= chfRate;
    low24h *= chfRate;
    for (let i = 0; i < prices.length; i++) prices[i] *= chfRate;
  }
  prices.push(currentPrice);
  volumes.push(volume24h);
  const rsi = calculateRSI(prices);
  const macdData = calculateMACD(prices);
  const ema20 = calculateEMA(prices, 20);
  const ema50 = calculateEMA(prices, 50);
  const ema200 = calculateEMA(prices, 200);
  const bb = calculateBollingerBands(prices);
  const obv = calculateOBV(prices.slice(0, -1), volumes.slice(0, -1));
  const atr = calculateATR(klines, 14);
  const atrPct = currentPrice > 0 ? (atr / currentPrice) * 100 : 0;
  const rsiDivergence = detectRSIDivergence(prices);
  const signal = analyzeSignal({
    price: currentPrice, rsi, macdHist: macdData.histogram,
    ema20, ema50, ema200, bb,
    priceChange24h: parseFloat(ticker.priceChangePercent),
    obvDivergence: obv.divergence,
    atrPct,
    rsiDivergence,
    seasonality,
    fundingRate,
    newsSentiment
  });
  return {
    symbol: asset.symbol, name: asset.name, tier: asset.tier,
    price: currentPrice, priceChange24h: parseFloat(ticker.priceChangePercent),
    volume24h, high24h, low24h, rsi, macd: macdData, ema20, ema50, ema200, bb, obv,
    atrPct, signal
  };
}

function calcPnlPct(trade: any, price: number): number {
  return trade.direction === 'long'
    ? ((price - trade.entry_price) / trade.entry_price) * 100
    : ((trade.entry_price - price) / trade.entry_price) * 100;
}

function calcPnl(trade: any, price: number): number {
  return trade.direction === 'long'
    ? (price - trade.entry_price) * trade.quantity
    : (trade.entry_price - price) * trade.quantity;
}

Deno.serve(async (req: Request) => {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const sb = createClient(supabaseUrl, serviceKey);

    const { data: cfgRow } = await sb.from('bot_config').select('*').limit(1).single();
    if (!cfgRow) return new Response(JSON.stringify({ ok: false, reason: 'no_config' }), { status: 200 });

    const config = {
      initialCapital: Number(cfgRow.initial_capital),
      maxPositions: cfgRow.max_positions,
      minConfidence: cfgRow.min_confidence,
      sessionDurationMs: Number(cfgRow.session_duration_ms),
      trailingActivationPct: Number(cfgRow.trailing_activation_pct),
      trailingStepPct: Number(cfgRow.trailing_step_pct),
      tiers: cfgRow.tier_config as Record<string, any>,
      fearGreedFilter: cfgRow.fear_greed_filter as Record<string, number>,
      currency: cfgRow.currency
    };

    const { data: sessions } = await sb.from('bot_sessions').select('*').eq('status', 'running').limit(1);
    const session = sessions && sessions.length > 0 ? sessions[0] : null;
    if (!session) return new Response(JSON.stringify({ ok: true, reason: 'no_active_session' }), { status: 200 });

    const sessionStart = new Date(session.started_at).getTime();

    let chfRate: number | null = null;
    if (config.currency === 'chf') {
      try {
        const r = await fetch('https://api.frankfurter.app/latest?from=USD&to=CHF');
        const d = await r.json();
        chfRate = d.rates.CHF;
      } catch { chfRate = 0.88; }
    }

    const [seasonalityMap, fundingRates, newsSentiments] = await Promise.all([
      fetchSeasonality(),
      fetchFundingRates(),
      fetchNewsSentiment()
    ]);
    const currentMonth = new Date().getMonth();
    const seasonality = seasonalityMap[currentMonth] ?? 0;

    const marketResults = await Promise.allSettled(
      ASSETS.map(a => fetchMarketData(a, config.currency, chfRate, seasonality, fundingRates[a.symbol] ?? null, newsSentiments[a.symbol] ?? null))
    );
    const marketData: Record<string, any> = {};
    for (const r of marketResults) {
      if (r.status === 'fulfilled' && r.value) marketData[r.value.symbol] = r.value;
    }
    if (Object.keys(marketData).length === 0) {
      return new Response(JSON.stringify({ ok: false, reason: 'no_market_data' }), { status: 200 });
    }

    let fgValue = 50;
    let fgLabel = 'Neutral';
    try {
      const fgRes = await fetch('https://api.alternative.me/fng/');
      const fgData = await fgRes.json();
      fgValue = parseInt(fgData.data[0].value);
      fgLabel = fgData.data[0].value_classification;
    } catch { /* keep defaults */ }

    await sb.from('market_snapshots').insert({
      session_id: session.id,
      data: marketData,
      fear_greed_value: fgValue,
      fear_greed_label: fgLabel,
      chf_rate: chfRate
    });

    const { data: oldSnaps } = await sb.from('market_snapshots')
      .select('id').order('created_at', { ascending: false }).range(100, 10000);
    if (oldSnaps && oldSnaps.length > 0) {
      await sb.from('market_snapshots').delete().in('id', oldSnaps.map((s: any) => s.id));
    }

    if (Date.now() - sessionStart > config.sessionDurationMs) {
      const { data: allOpen } = await sb.from('bot_trades')
        .select('*').eq('session_id', session.id).eq('status', 'open');
      let closedCount = 0;
      let stillOpenCount = 0;
      if (allOpen) {
        for (const t of allOpen) {
          const md = marketData[t.symbol];
          if (!md) continue;
          const pnl = calcPnl(t, md.price);
          const pnlPct = calcPnlPct(t, md.price);
          if (pnlPct >= 0) {
            await sb.from('bot_trades').update({
              exit_price: md.price, exit_time: new Date().toISOString(),
              pnl, pnl_percent: pnlPct, exit_reason: 'session_end', status: 'closed'
            }).eq('id', t.id);
            closedCount++;
          } else {
            stillOpenCount++;
          }
        }
      }
      const { data: closed } = await sb.from('bot_trades')
        .select('pnl').eq('session_id', session.id).eq('status', 'closed');
      const realizedPnl = (closed || []).reduce((s: number, t: any) => s + (Number(t.pnl) || 0), 0);
      const finalStatus = stillOpenCount > 0 ? 'completed_with_open' : 'completed';
      await sb.from('bot_sessions').update({
        ended_at: new Date().toISOString(), status: finalStatus, final_pnl: realizedPnl
      }).eq('id', session.id);
      return new Response(JSON.stringify({
        ok: true, action: 'session_ended', status: finalStatus,
        pnl: realizedPnl, closed: closedCount, still_open: stillOpenCount
      }), { status: 200 });
    }

    const { data: orphanTrades } = await sb.from('bot_trades')
      .select('*').eq('status', 'open').neq('session_id', session.id);
    if (orphanTrades && orphanTrades.length > 0) {
      for (const t of orphanTrades) {
        await sb.from('bot_trades').update({ session_id: session.id }).eq('id', t.id);
      }
    }

    const { data: openTrades } = await sb.from('bot_trades')
      .select('*').eq('session_id', session.id).eq('status', 'open');
    const { data: closedTrades } = await sb.from('bot_trades')
      .select('*').eq('session_id', session.id).eq('status', 'closed');
    const open = openTrades || [];
    const closedArr = closedTrades || [];

    let tradesOpened = 0;
    let tradesClosed = 0;

    for (const trade of open) {
      const md = marketData[trade.symbol];
      if (!md) continue;
      const price = md.price;
      const pnlPct = calcPnlPct(trade, price);
      const pnl = calcPnl(trade, price);

      let hwm = Number(trade.high_water_mark) || 0;
      if (pnlPct > hwm) hwm = pnlPct;
      if (hwm !== Number(trade.high_water_mark)) {
        await sb.from('bot_trades').update({ high_water_mark: hwm }).eq('id', trade.id);
      }

      const trailingActive = hwm >= config.trailingActivationPct;
      let exitReason: string | null = null;

      if (trailingActive && (hwm - pnlPct) >= config.trailingStepPct) {
        exitReason = 'trailing_tp';
      }

      if (!exitReason) {
        const tradeTier = trade.tier || 'altcoin';
        const stopLoss = STOP_LOSS_PCT[tradeTier] || -12;
        if (pnlPct <= stopLoss) {
          exitReason = 'stop_loss';
        }
      }

      if (!exitReason && pnlPct >= 0 &&
        ((trade.direction === 'long' && md.signal.type === 'sell' && md.signal.confidence >= config.minConfidence) ||
         (trade.direction === 'short' && md.signal.type === 'buy' && md.signal.confidence >= config.minConfidence))
      ) {
        exitReason = 'signal_reversal';
      }

      if (exitReason) {
        await sb.from('bot_trades').update({
          exit_price: price, exit_time: new Date().toISOString(),
          pnl, pnl_percent: pnlPct, exit_reason: exitReason, status: 'closed'
        }).eq('id', trade.id);
        tradesClosed++;
      }
    }

    const { data: currentOpen } = await sb.from('bot_trades')
      .select('*').eq('session_id', session.id).eq('status', 'open');
    const liveOpen = currentOpen || [];

    const realizedPnl = closedArr.reduce((s: number, t: any) => s + (Number(t.pnl) || 0), 0);
    let unrealizedPnl = 0;
    for (const t of liveOpen) {
      const md = marketData[t.symbol];
      if (md) unrealizedPnl += calcPnl(t, md.price);
    }
    const totalPnlNow = realizedPnl + unrealizedPnl;
    const drawdownPct = (totalPnlNow / config.initialCapital) * 100;
    const maxDrawdownLimit = -15;

    if (liveOpen.length < config.maxPositions && drawdownPct > maxDrawdownLimit) {
      const fgMod = fgValue <= config.fearGreedFilter.extremeFear ? 1.3
        : fgValue <= config.fearGreedFilter.fear ? 1.15
        : fgValue >= config.fearGreedFilter.greed ? 0.5 : 1.0;

      const investedCapital = liveOpen.reduce((s: number, t: any) => s + Number(t.quantity) * Number(t.entry_price), 0);
      let availableCapital = config.initialCapital + realizedPnl - investedCapital;

      const { data: recentExits } = await sb.from('bot_trades')
        .select('symbol, exit_time')
        .eq('session_id', session.id).eq('status', 'closed')
        .order('exit_time', { ascending: false }).limit(50);
      const cooldownMs = 2 * 3600_000;
      const cooldownSymbols = new Set<string>();
      if (recentExits) {
        for (const t of recentExits) {
          if (t.exit_time && (Date.now() - new Date(t.exit_time).getTime()) < cooldownMs) {
            cooldownSymbols.add(t.symbol);
          }
        }
      }

      const sortedAssets = (Object.values(marketData) as any[])
        .filter(md => md.signal.confidence >= config.minConfidence && md.signal.type !== 'neutral')
        .sort((a, b) => b.signal.confidence - a.signal.confidence);

      for (const md of sortedAssets) {
        if (liveOpen.length + tradesOpened >= config.maxPositions) break;
        if (cooldownSymbols.has(md.symbol)) continue;

        const sig = md.signal;
        const direction = sig.type === 'buy' ? 'long' : 'short';
        if (direction === 'long' && fgValue >= config.fearGreedFilter.extremeGreed) continue;

        const assetDef = ASSETS.find(a => a.symbol === md.symbol);
        const tier = assetDef ? assetDef.tier : 'altcoin';
        const tierCfg = config.tiers[tier] || config.tiers['altcoin'];
        const existingOnAsset = liveOpen.filter((t: any) => t.symbol === md.symbol);
        const level = existingOnAsset.length;
        if (level >= tierCfg.maxPerAsset) continue;

        if (level > 0) {
          const lastEntry = existingOnAsset[existingOnAsset.length - 1];
          const drop = ((Number(lastEntry.entry_price) - md.price) / Number(lastEntry.entry_price)) * 100;
          if (direction === 'long' && drop < tierCfg.scalingDropPct) continue;
          if (direction === 'short' && -drop < tierCfg.scalingDropPct) continue;
          if (lastEntry.direction !== direction) continue;
        }

        const slotsLeft = config.maxPositions - liveOpen.length - tradesOpened;
        const baseValue = Math.max(0, availableCapital / slotsLeft);
        const scalingMul = (tierCfg.scalingMultipliers || [1])[level] || 1;
        const positionValue = Math.min(baseValue * scalingMul * tierCfg.sizeMultiplier * fgMod, availableCapital * 0.4);
        if (positionValue < 10) continue;

        const quantity = positionValue / md.price;
        await sb.from('bot_trades').insert({
          session_id: session.id, symbol: md.symbol, direction,
          entry_price: md.price, quantity,
          entry_score: sig.score, entry_confidence: sig.confidence,
          status: 'open', tier, level: level + 1, high_water_mark: 0
        });
        availableCapital -= positionValue;
        tradesOpened++;
      }
    }

    return new Response(JSON.stringify({
      ok: true, session_id: session.id,
      trades_opened: tradesOpened, trades_closed: tradesClosed,
      assets_analyzed: Object.keys(marketData).length,
      fear_greed: fgValue
    }), { headers: { 'Content-Type': 'application/json' }, status: 200 });

  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: err.message }), { status: 500 });
  }
});
