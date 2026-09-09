import { useI18n } from '../i18n/useI18n'
import { CURRENCY_SYMBOLS } from '../lib/currency'
import type { PaperTrade, SignalSnapshot } from '../types/scalpSignal'

interface Props {
  snapshot: SignalSnapshot | null
  loading: boolean
  whaleContext?: 'bullish' | 'bearish' | null
  openTrade?: PaperTrade | null
}

const STATE_ICON: Record<string, string> = {
  NO_TRADE: '⚪',
  WATCH: '🟡',
  LONG_SETUP: '🟢',
  LONG_CONFIRMED: '🟢',
  SHORT_SETUP: '🔴',
  SHORT_CONFIRMED: '🔴',
  TRADE_ACTIVE: '🔵',
  TARGET_HIT: '🟢',
  STOP_HIT: '🔴',
  EXPIRED: '⚪',
}

function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function SignalCard({ snapshot, loading, whaleContext, openTrade }: Props) {
  const { t } = useI18n()

  const state = snapshot?.state ?? 'NO_TRADE'
  const icon = STATE_ICON[state] ?? '⚪'
  const setup = snapshot?.setup ?? null
  const risk = snapshot?.risk ?? null
  const confidence = snapshot?.confidence?.total ?? null
  const currencySym = risk?.capitalCurrency ? CURRENCY_SYMBOLS[risk.capitalCurrency] : '$'

  const cardClass = state.startsWith('LONG') || state === 'TARGET_HIT' ? 'buy' : state.startsWith('SHORT') || state === 'STOP_HIT' ? 'sell' : 'neutral'

  return (
    <div className="signals-section current-signal-section">
      <div className="signals-header">{t('scalp.currentSignal.title')}</div>
      <div className={`signal-card current-signal-card ${cardClass}`}>
        <div className="signal-title">
          {icon} {t(`scalp.state.${state}`)}
          <span className="current-signal-symbol">{snapshot?.symbol ?? 'BTC'}/USDT</span>
          {setup ? <span className="scalp-setup-type-badge">{t(`scalp.setupType.${setup.setupType}`)}</span> : null}
        </div>

        {openTrade?.result === 'OPEN' && openTrade.exitSuggested ? (
          <div className="current-signal-exit-suggested">⚠️ {t('scalp.exitSuggested')}</div>
        ) : null}

        {loading ? <div className="current-signal-loading">{t('scalp.loading')}</div> : null}

        {setup && risk?.valid ? (
          <div className="bt-summary-grid current-signal-grid">
            <div className="bt-summary-item">
              <div className="bt-s-label">{t('scalp.entry')}</div>
              <div className="bt-s-value">${fmtUsd(setup.entryPrice)}</div>
            </div>
            <div className="bt-summary-item">
              <div className="bt-s-label">{t('scalp.stopLoss')}</div>
              <div className="bt-s-value negative">${fmtUsd(risk.stopLoss)}</div>
            </div>
            <div className="bt-summary-item">
              <div className="bt-s-label">{t('scalp.tp1')}</div>
              <div className="bt-s-value positive">${fmtUsd(risk.takeProfit1)}</div>
            </div>
            <div className="bt-summary-item">
              <div className="bt-s-label">{t('scalp.tp2')}</div>
              <div className="bt-s-value positive">${fmtUsd(risk.takeProfit2)}</div>
            </div>
            <div className="bt-summary-item">
              <div className="bt-s-label">{t('scalp.riskReward')}</div>
              <div className="bt-s-value">1:{risk.riskRewardRatio}</div>
            </div>
            <div className="bt-summary-item">
              <div className="bt-s-label">{t('scalp.confidence')}</div>
              <div className="bt-s-value">{confidence ?? 0}/100</div>
            </div>
            <div className="bt-summary-item">
              <div className="bt-s-label">{t('scalp.risk')}</div>
              <div className="bt-s-value negative">
                {currencySym}
                {fmtUsd(risk.riskAmount)}
              </div>
            </div>
            <div className="bt-summary-item">
              <div className="bt-s-label">{t('scalp.reward')}</div>
              <div className="bt-s-value positive">
                {currencySym}
                {fmtUsd(risk.rewardAmount)}
              </div>
            </div>
          </div>
        ) : (
          <div className="signal-details">
            <div className="signal-detail">{t('scalp.noSetupHint')}</div>
          </div>
        )}

        {setup && risk?.valid ? <div className="current-signal-quality-note">{t('scalp.qualityDisclaimer')}</div> : null}

        {risk && !risk.valid && risk.reasonInvalid ? (
          <div className="signal-detail current-signal-blocked">{t(`scalp.riskBlocked.${risk.reasonInvalid}`)}</div>
        ) : null}

        {snapshot?.lastAlert && snapshot.lastAlert.state === state && snapshot.lastAlert.reasons.length > 0 ? (
          <div className="current-signal-reasons">
            <strong>{t('scalp.reasonsTitle')}</strong>
            <ul>
              {snapshot.lastAlert.reasons.map((reason) => (
                <li key={reason}>{t(`scalp.reason.${reason}`)}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {whaleContext ? (
          <div className="current-signal-whale-context">
            🐋 {t(`scalp.whaleContext.${whaleContext}`)}
          </div>
        ) : null}
      </div>
    </div>
  )
}
