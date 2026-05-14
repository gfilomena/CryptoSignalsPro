import type { LiveAsset } from '../types/domain'

/** Binance pairs for live monitor (USD + EUR; CHF uses USDT + conversion) */
export const LIVE_ASSETS: LiveAsset[] = [
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
  { symbol: 'APT', name: 'Aptos', tier: 'altcoin', pairs: { usd: 'APTUSDT', eur: 'APTEUR' } },
]
