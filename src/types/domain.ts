export type Currency = 'usd' | 'eur' | 'chf'

export type AssetTier = 'major' | 'altcoin' | 'meme'

export type SignalType = 'buy' | 'sell' | 'neutral'

export interface LiveAsset {
  symbol: string
  name: string
  tier: AssetTier
  pairs: { usd: string; eur: string }
}

export interface BtAsset {
  symbol: string
  name: string
  tier: AssetTier
  pair: string
}

export interface MacdData {
  macd: number
  signal: number
  histogram: number
}

export interface BollingerBands {
  upper: number
  middle: number
  lower: number
}

export interface ObvResult {
  trend: number
  divergence: 'none' | 'bullish' | 'bearish'
}

export interface SignalReasonEntry {
  k: string
  v?: Record<string, string | number>
}

export interface SignalResult {
  type: SignalType
  score: number
  confidence: number
  reasons: SignalReasonEntry[]
}

export interface CryptoSnapshot {
  symbol: string
  name: string
  price: number
  priceChange24h: number
  volume24h: number
  high24h: number
  low24h: number
  support: number
  resistance: number
  rsi: number
  macd: MacdData
  ema20: number
  ema50: number
  ema200: number
  bb: BollingerBands
  atrPct: number
  obv: ObvResult
  rsiDivergence: 'none' | 'bullish' | 'bearish'
  signal: SignalResult
  timestamp: number
}

export interface FearGreedState {
  value: number
  classification: string
}

export type WhaleCategory = 'hodl' | 'sell' | 'volume' | 'supply'

export interface WhaleAlert {
  timestamp: number
  text?: string
  emoticons?: string
  amounts?: { symbol?: string; amount: number; value_usd?: number }[]
  _category?: WhaleCategory
}

export type ResearchVerdict = 'top' | 'high' | 'track' | 'lead'

export type EvidenceStrength = 'primary' | 'media' | 'analysis' | 'social'

export interface ResearchEvidence {
  claim: string
  source: string
  strength: EvidenceStrength
}

/** Serenity-skill-style equity research note: chain position, scarce layer, evidence, risk. */
export interface EquityResearchNote {
  ticker: string
  company: string
  market: string
  chainPosition: string
  scarceLayer: string
  verdict: ResearchVerdict
  thesis: string
  evidence: ResearchEvidence[]
  risk: string
  updated: string
}
