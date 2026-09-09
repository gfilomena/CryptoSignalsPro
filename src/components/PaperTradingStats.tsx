import { useI18n } from '../i18n/useI18n'
import { CollapsiblePanel } from './CollapsiblePanel'
import type { PaperStats } from '../types/scalpSignal'

interface Props {
  stats: PaperStats
}

export function PaperTradingStats({ stats }: Props) {
  const { t } = useI18n()

  const pnlClass = (v: number) => (v >= 0 ? 'positive' : 'negative')

  return (
    <CollapsiblePanel
      id="scalpPaperStatsPanel"
      sectionClassName="bt-panel"
      headerClassName="bt-panel-header"
      title={<div className="bt-panel-title">{t('scalp.paper.title')}</div>}
      defaultCollapsed={stats.totalTrades === 0}
    >
      {stats.totalTrades === 0 ? (
        <p className="bt-preset-desc">{t('scalp.paper.empty')}</p>
      ) : (
        <div className="bt-summary-grid">
          <div className="bt-summary-item">
            <div className="bt-s-label">{t('scalp.paper.trades')}</div>
            <div className="bt-s-value">{stats.totalTrades}</div>
          </div>
          <div className="bt-summary-item">
            <div className="bt-s-label">{t('scalp.paper.winRate')}</div>
            <div className="bt-s-value">{stats.winRate.toFixed(1)}%</div>
          </div>
          <div className="bt-summary-item">
            <div className="bt-s-label">{t('scalp.paper.profitFactor')}</div>
            <div className="bt-s-value">{stats.profitFactor.toFixed(2)}</div>
          </div>
          <div className="bt-summary-item">
            <div className="bt-s-label">{t('scalp.paper.expectancy')}</div>
            <div className={`bt-s-value ${pnlClass(stats.expectancy)}`}>
              {stats.expectancy >= 0 ? '+' : ''}
              {stats.expectancy.toFixed(2)}
            </div>
          </div>
          <div className="bt-summary-item">
            <div className="bt-s-label">{t('scalp.paper.avgWin')}</div>
            <div className="bt-s-value positive">+{stats.avgWin.toFixed(2)}</div>
          </div>
          <div className="bt-summary-item">
            <div className="bt-s-label">{t('scalp.paper.avgLoss')}</div>
            <div className="bt-s-value negative">-{stats.avgLoss.toFixed(2)}</div>
          </div>
          <div className="bt-summary-item">
            <div className="bt-s-label">{t('scalp.paper.maxDrawdown')}</div>
            <div className="bt-s-value negative">-{stats.maxDrawdown.toFixed(2)}</div>
          </div>
          <div className="bt-summary-item">
            <div className="bt-s-label">{t('scalp.paper.avgRR')}</div>
            <div className="bt-s-value">1:{stats.avgRR.toFixed(2)}</div>
          </div>
          <div className="bt-summary-item">
            <div className="bt-s-label">{t('scalp.paper.totalPnl')}</div>
            <div className={`bt-s-value ${pnlClass(stats.totalPnl)}`}>
              {stats.totalPnl >= 0 ? '+' : ''}
              {stats.totalPnl.toFixed(2)}
            </div>
          </div>
        </div>
      )}
    </CollapsiblePanel>
  )
}
