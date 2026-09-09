import { useI18n } from '../i18n/useI18n'
import { CollapsiblePanel } from './CollapsiblePanel'
import { CURRENCY_SYMBOLS } from '../lib/currency'
import type { PaperTrade } from '../types/scalpSignal'

interface Props {
  trades: PaperTrade[]
}

function fmtDate(ts: number, locale: string): string {
  return new Date(ts).toLocaleString(locale, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const RESULT_CLASS: Record<string, string> = { TP1: 'positive', TP2: 'positive', SL: 'negative', OPEN: '', EXPIRED: '' }

export function SignalHistoryPanel({ trades }: Props) {
  const { t, locale } = useI18n()
  const rows = [...trades].sort((a, b) => b.openedAt - a.openedAt).slice(0, 50)

  return (
    <CollapsiblePanel
      id="scalpHistoryPanel"
      sectionClassName="bt-panel"
      headerClassName="bt-panel-header"
      title={<div className="bt-panel-title">{t('scalp.history.title')}</div>}
      defaultCollapsed={rows.length === 0}
    >
      {rows.length === 0 ? (
        <p className="bt-preset-desc">{t('scalp.history.empty')}</p>
      ) : (
        <div className="scalp-table-wrap">
          <table className="scalp-history-table">
            <thead>
              <tr>
                <th>{t('scalp.history.date')}</th>
                <th>{t('scalp.history.symbol')}</th>
                <th>{t('scalp.history.direction')}</th>
                <th>{t('scalp.history.entry')}</th>
                <th>{t('scalp.history.stop')}</th>
                <th>{t('scalp.history.tp')}</th>
                <th>{t('scalp.history.confidence')}</th>
                <th>{t('scalp.history.result')}</th>
                <th>{t('scalp.history.pnl')}</th>
                <th>{t('scalp.history.rr')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((trade) => (
                <tr key={trade.id}>
                  <td>{fmtDate(trade.openedAt, locale)}</td>
                  <td>{trade.symbol}</td>
                  <td className={trade.direction === 'long' ? 'positive' : 'negative'}>
                    {trade.direction === 'long' ? t('scalp.long') : t('scalp.short')}
                  </td>
                  <td>${fmtUsd(trade.entryPrice)}</td>
                  <td>${fmtUsd(trade.stopLoss)}</td>
                  <td>${fmtUsd(trade.takeProfit1)}</td>
                  <td>{trade.confidence}%</td>
                  <td className={RESULT_CLASS[trade.result] || ''}>{t(`scalp.result.${trade.result}`)}</td>
                  <td className={(trade.pnl ?? 0) >= 0 ? 'positive' : 'negative'}>
                    {trade.pnl != null ? `${trade.pnl >= 0 ? '+' : ''}${CURRENCY_SYMBOLS[trade.capitalCurrency]}${fmtUsd(trade.pnl)}` : '—'}
                  </td>
                  <td className={(trade.pnlR ?? 0) >= 0 ? 'positive' : 'negative'}>
                    {trade.pnlR != null ? `${trade.pnlR >= 0 ? '+' : ''}${trade.pnlR.toFixed(2)}R` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </CollapsiblePanel>
  )
}
