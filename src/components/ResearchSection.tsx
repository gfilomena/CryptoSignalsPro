import { useI18n } from '../i18n/useI18n'
import { EQUITY_RESEARCH } from '../constants/equityResearch'
import type { ResearchVerdict } from '../types/domain'
import { CollapsiblePanel } from './CollapsiblePanel'

export function ResearchSection() {
  const { t } = useI18n()

  return (
    <CollapsiblePanel
      id="researchSection"
      sectionClassName="research-section"
      headerClassName="research-header"
      title={
        <div className="research-header-left">
          <div className="research-title">{t('research.title')}</div>
        </div>
      }
      rightSlot={<div className="research-count">{EQUITY_RESEARCH.length}</div>}
    >
      <div className="research-disclaimer">{t('research.disclaimer')}</div>
      <div className="research-list">
        {EQUITY_RESEARCH.map((note) => (
          <div key={note.ticker} className="research-card">
            <div className="research-card-head">
              <div className="research-card-name">
                <span className="research-ticker">{note.ticker}</span>
                <span className="research-company">{note.company}</span>
              </div>
              <span className={`research-verdict ${note.verdict as ResearchVerdict}`}>
                {t(`research.verdict.${note.verdict}`)}
              </span>
            </div>

            <div className="research-field">
              <span className="research-field-label">{t('research.chainPosition')}</span>
              <span>{note.chainPosition}</span>
            </div>
            <div className="research-field">
              <span className="research-field-label">{t('research.scarceLayer')}</span>
              <span>{note.scarceLayer}</span>
            </div>

            <p className="research-thesis">{note.thesis}</p>

            <div className="research-evidence">
              <div className="research-field-label">{t('research.evidence')}</div>
              <ul>
                {note.evidence.map((ev, i) => (
                  <li key={i}>
                    <span className={`research-strength ${ev.strength}`}>
                      {t(`research.strength.${ev.strength}`)}
                    </span>{' '}
                    {ev.claim} — <em>{ev.source}</em>
                  </li>
                ))}
              </ul>
            </div>

            <div className="research-field">
              <span className="research-field-label">{t('research.risk')}</span>
              <span>{note.risk}</span>
            </div>

            <div className="research-updated">{t('research.updated', { date: note.updated })}</div>
          </div>
        ))}
      </div>
    </CollapsiblePanel>
  )
}
