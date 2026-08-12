import type { EquityResearchNote } from '../types/domain'

/**
 * Static seed data generated with the serenity-skill methodology (value-chain
 * position -> scarce layer -> evidence -> risk) for a handful of crypto-adjacent
 * equities. Not live: refresh by asking Claude to re-run the skill against
 * current filings/news, then update this file.
 */
export const EQUITY_RESEARCH: EquityResearchNote[] = [
  {
    ticker: 'COIN',
    company: 'Coinbase Global',
    market: 'US',
    chainPosition: 'Regulated on-ramp / exchange layer where retail and institutional order flow clears',
    scarceLayer: 'Regulatory licensing and custody trust, not a physical bottleneck — the moat is compliance surface area',
    verdict: 'track',
    thesis:
      'Q2 2026 revenue of $1.2B missed the $1.35B consensus and posted a $359M net loss, but Coinbase hit a record 10.3% crypto trading-volume market share for a third straight quarter. BTC-linked revenue fell to just 12% of the total from over 50% historically, while subscription/services revenue hit a record 48% ($555M) and prediction-markets revenue more than doubled quarter over quarter, crossing $100M annualized. The real thesis is the diversification away from spot BTC trading, not the headline miss.',
    evidence: [
      { claim: 'Q2 2026 revenue $1.2B vs $1.35B consensus; net loss $359M', source: 'Coinbase Q2 2026 investor release', strength: 'primary' },
      { claim: 'Record 10.3% crypto trading volume market share, 3rd consecutive quarter of gains', source: 'Coinbase Q2 2026 shareholder letter', strength: 'primary' },
      { claim: 'Prediction markets revenue +106% QoQ, crossing $100M annualized', source: 'Coinbase Q2 2026 earnings coverage', strength: 'media' },
    ],
    risk: 'The diversification narrative still leans on discretionary trading revenue in down markets; a sustained miss on subscription/services growth removes the main re-rating argument.',
    updated: '2026-08-12',
  },
  {
    ticker: 'MSTR',
    company: 'Strategy Inc (formerly MicroStrategy)',
    market: 'US',
    chainPosition: 'Not a value-chain operator — a leveraged, liquid equity+debt wrapper for spot bitcoin exposure',
    scarceLayer: 'Access to cheap capital markets (converts/ATM issuance) to keep accumulating BTC faster than a spot buyer could',
    verdict: 'high',
    thesis:
      'Holds roughly 847,363 BTC as of late June 2026 — over 4% of total BTC supply — at a cost basis near $64.0B (~$75,651/BTC average). Holdings grew 22% year-to-date in 2026 after raising $25.3B of capital in 2025, making Strategy the largest US equity issuer that year. It functions as a leveraged BTC proxy for accounts that cannot hold spot, so this is a bitcoin-beta bet wrapped in issuance capacity, not a fundamentals thesis.',
    evidence: [
      { claim: '~847,363 BTC held as of late June 2026, ~4%+ of total 21M supply', source: 'Strategy Inc 8-K filings, 2026', strength: 'primary' },
      { claim: '22% YTD growth in BTC holdings in 2026; $25.3B capital raised in 2025', source: 'Strategy Inc 8-K filings / investor coverage', strength: 'primary' },
    ],
    risk: 'The market-cap premium to BTC NAV can compress or invert; continued equity/converts issuance dilutes shareholders; a sustained BTC drawdown pressures the debt-service assumptions built into the strategy.',
    updated: '2026-08-12',
  },
  {
    ticker: 'MARA',
    company: 'MARA Holdings',
    market: 'US',
    chainPosition: 'Bitcoin mining / hashrate supply, with an emerging pivot toward AI and HPC data-center capacity',
    scarceLayer: 'Energized power capacity and grid interconnection (~1.9GW across 19 data centers) — the constraint is siting and power contracts, not ASIC supply',
    verdict: 'lead',
    thesis:
      'Energized hashrate reached 70.3 EH/s as of June 30, 2026 (+22% YoY), with fleet efficiency improving to 17.3 J/TH from 18.3. But Q2 2026 posted a $611M loss on revenue down 27% YoY, and MARA sold $1.63B of BTC from treasury in 2026 to fund expansion and cut debt to $2.4B. Capacity is scaling faster than profitability — the buildout is real, the earnings case is not yet proven.',
    evidence: [
      { claim: 'Energized hashrate 70.3 EH/s at June 30 2026, +22% YoY; efficiency 17.3 J/TH', source: 'MARA Holdings Q2 2026 10-Q', strength: 'primary' },
      { claim: 'Q2 2026 net loss $611M, revenue -27% YoY; sold $1.63B BTC from treasury, debt down to $2.4B', source: 'MARA Holdings Q2 2026 earnings coverage', strength: 'media' },
    ],
    risk: 'Funding expansion via BTC treasury sales rather than operating cash flow is a warning sign if BTC price stays flat or falls; margins remain highly exposed to network difficulty growth.',
    updated: '2026-08-12',
  },
  {
    ticker: 'RIOT',
    company: 'Riot Platforms',
    market: 'US',
    chainPosition: 'Bitcoin mining and power infrastructure, now directly monetizing site/power assets as AI compute capacity',
    scarceLayer: 'Low-cost, already-interconnected power (3.0c/kWh vs a 4-5c peer range) at Texas and Kentucky sites — the hard-to-replicate asset is the power contract and grid tie-in, not the miners',
    verdict: 'top',
    thesis:
      'Deployed hashrate reached 42.5 EH/s in Q1 2026 (+26% YoY). On August 11, 2026 Riot signed a $9B, 20-year compute lease with Anthropic for 191MW at its Rockdale, TX campus — third-party evidence, from a named counterparty, that the power/site asset has value beyond mining margins alone. This is the strongest evidence in this set: a signed contract, not a narrative.',
    evidence: [
      { claim: '$9B, 20-year, 191MW compute lease with Anthropic at Rockdale, TX', source: 'CNBC, Aug 11 2026', strength: 'media' },
      { claim: 'Deployed hashrate 42.5 EH/s (+26% YoY); all-in power cost 3.0c/kWh vs 4-5c peer range', source: 'Riot Platforms Q1 2026 shareholder letter', strength: 'primary' },
    ],
    risk: 'Execution risk on the data-center conversion timeline; the legacy mining segment stays exposed to BTC price and difficulty; a single large counterparty contract concentrates revenue.',
    updated: '2026-08-12',
  },
  {
    ticker: 'CLSK',
    company: 'CleanSpark',
    market: 'US',
    chainPosition: 'Vertically integrated bitcoin miner that owns/contracts its own power rather than colocating',
    scarceLayer: 'Contracted power headroom (1.8GW contracted vs 808MW utilized) plus fleet efficiency — the exploitable asset is undrawn capacity already under contract',
    verdict: 'track',
    thesis:
      'Operational hashrate hit a record 50 EH/s in June 2026 (42.6 EH/s average), with peak fleet efficiency of 16.07 J/TH — the best of this peer set. Produced 3,724 BTC through June 30, 2026 and holds 13,924 BTC in treasury, among the largest of public miners. The company is still building Texas and Sandersville sites into its 1.8GW contracted power envelope, so most of the growth runway is already secured on paper.',
    evidence: [
      { claim: 'Record operational hashrate 50 EH/s, June 2026; peak efficiency 16.07 J/TH', source: 'CleanSpark June 2026 operational update', strength: 'primary' },
      { claim: '1.8GW power under contract, 808MW utilized; 13,924 BTC held in treasury', source: 'CleanSpark June 2026 operational update', strength: 'primary' },
    ],
    risk: 'Large gap between contracted (1.8GW) and utilized (808MW) power means the growth case depends on execution, not just existing contracts; still a single-asset (BTC) revenue model, unlike miners pivoting to AI leasing.',
    updated: '2026-08-12',
  },
]
