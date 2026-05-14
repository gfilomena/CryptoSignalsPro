import type { BtAsset } from '../types/domain'

/** Backtest uses USDT pairs only */
export const BT_ASSETS: BtAsset[] = [
  { symbol: 'BTC', name: 'Bitcoin', tier: 'major', pair: 'BTCUSDT' },
  { symbol: 'ETH', name: 'Ethereum', tier: 'major', pair: 'ETHUSDT' },
  { symbol: 'SOL', name: 'Solana', tier: 'major', pair: 'SOLUSDT' },
  { symbol: 'BNB', name: 'BNB', tier: 'major', pair: 'BNBUSDT' },
  { symbol: 'XRP', name: 'Ripple', tier: 'altcoin', pair: 'XRPUSDT' },
  { symbol: 'ADA', name: 'Cardano', tier: 'altcoin', pair: 'ADAUSDT' },
  { symbol: 'DOGE', name: 'Dogecoin', tier: 'meme', pair: 'DOGEUSDT' },
  { symbol: 'AVAX', name: 'Avalanche', tier: 'altcoin', pair: 'AVAXUSDT' },
  { symbol: 'LINK', name: 'Chainlink', tier: 'altcoin', pair: 'LINKUSDT' },
  { symbol: 'DOT', name: 'Polkadot', tier: 'altcoin', pair: 'DOTUSDT' },
  { symbol: 'SHIB', name: 'Shiba Inu', tier: 'meme', pair: 'SHIBUSDT' },
  { symbol: 'LTC', name: 'Litecoin', tier: 'altcoin', pair: 'LTCUSDT' },
  { symbol: 'UNI', name: 'Uniswap', tier: 'altcoin', pair: 'UNIUSDT' },
  { symbol: 'NEAR', name: 'NEAR', tier: 'altcoin', pair: 'NEARUSDT' },
  { symbol: 'SUI', name: 'Sui', tier: 'altcoin', pair: 'SUIUSDT' },
  { symbol: 'PEPE', name: 'Pepe', tier: 'meme', pair: 'PEPEUSDT' },
  { symbol: 'TRX', name: 'Tron', tier: 'altcoin', pair: 'TRXUSDT' },
  { symbol: 'XLM', name: 'Stellar', tier: 'altcoin', pair: 'XLMUSDT' },
  { symbol: 'APT', name: 'Aptos', tier: 'altcoin', pair: 'APTUSDT' },
]
