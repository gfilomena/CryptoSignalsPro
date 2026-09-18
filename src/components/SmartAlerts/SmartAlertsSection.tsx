import { useEffect, useMemo, useRef, useState } from 'react'
import { useI18n } from '../../i18n/useI18n'
import type { SmartAlert } from '../../types/smartAlert'
import { useSmartAlerts } from './useSmartAlerts'
import { AlertCard } from './AlertCard'
import { PresetGrid } from './PresetGrid'
import { HistoryList } from './HistoryList'
import { AlertBuilderModal } from './AlertBuilderModal'
import { createAlertFromPreset, getPreset, type PresetId } from '../../lib/smartAlerts/presets'

const ESSENTIAL_PRESETS: PresetId[] = ['reversal_watch', 'strong_momentum', 'overheated_market']

/** Fixed ids: saving is an upsert by id (local store and server), so re-running quick-start — double tap,
 * tap before the list has loaded, or from a second device — overwrites instead of duplicating. */
const ESSENTIAL_IDS: Record<string, string> = {
  reversal_watch: '5e1a0001-0000-4000-8000-00000000b7c1',
  strong_momentum: '5e1a0002-0000-4000-8000-00000000b7c1',
  overheated_market: '5e1a0003-0000-4000-8000-00000000b7c1',
}
import {
  disableNotifications,
  enableNotifications,
  getPushStatus,
  sendTestNotification,
  updateSmartAlertsPushPreference,
  type PushStatus,
} from '../../lib/push/pushClient'

type Tab = 'active' | 'triggered' | 'presets'

function isToday(timestamp: number): boolean {
  const d = new Date(timestamp)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

export function SmartAlertsSection() {
  const { t } = useI18n()
  const { alerts, history, snapshots, loading, saveAlert, deleteAlert, toggleAlert, markRead, deleteHistory } = useSmartAlerts()

  const [tab, setTab] = useState<Tab>('active')
  const [builderState, setBuilderState] = useState<{ initial?: SmartAlert; presetId?: PresetId } | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null)
  const [smartAlertsPushEnabled, setSmartAlertsPushEnabled] = useState(true)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [testMessage, setTestMessage] = useState<string | null>(null)

  useEffect(() => {
    void getPushStatus().then(setPushStatus)
  }, [showSettings])

  const activeAlerts = useMemo(() => alerts.filter((a) => a.enabled && !a.sessionExpired), [alerts])
  const triggeredToday = useMemo(() => history.filter((e) => isToday(e.timestamp)), [history])
  const btcMonitoring = useMemo(() => alerts.some((a) => a.symbol === 'BTC' && a.enabled), [alerts])
  const unreadCount = useMemo(() => history.filter((e) => !e.read).length, [history])

  const overallActive = activeAlerts.length > 0

  const handleUsePreset = (presetId: PresetId) => {
    setBuilderState({ presetId })
    setTab('active')
  }

  // Language-independent: an essential preset counts as present if any BTC alert already has its category.
  const missingEssentials = useMemo(
    () => ESSENTIAL_PRESETS.filter((id) => !alerts.some((a) => a.symbol === 'BTC' && a.category === getPreset(id).category)),
    [alerts],
  )
  const quickStartBusy = useRef(false)

  const handleQuickStart = async () => {
    if (quickStartBusy.current) return // ignore double taps while the first run is still saving
    quickStartBusy.current = true
    try {
      for (const id of missingEssentials) {
        await saveAlert({ ...createAlertFromPreset(id, t(`smartAlerts.preset.${id}.name`), { symbol: 'BTC', mode: 'ALWAYS' }), id: ESSENTIAL_IDS[id] })
      }
      setTab('active')
    } finally {
      quickStartBusy.current = false
    }
  }

  const quickStart = (
    <div className="bt-group">
      <p className="bt-field-hint" style={{ marginBottom: 8 }}>{t('smartAlerts.builder.quickStartHint')}</p>
      <button type="button" className="bt-run-btn" disabled={loading || missingEssentials.length === 0} onClick={handleQuickStart}>
        {missingEssentials.length === 0 ? t('smartAlerts.builder.quickStartDone') : t('smartAlerts.builder.quickStartBtn')}
      </button>
    </div>
  )

  const handleEnablePush = async () => {
    setSettingsBusy(true)
    try {
      await enableNotifications()
      setPushStatus(await getPushStatus())
    } catch {
      /* getPushStatus below still reflects the real state */
      setPushStatus(await getPushStatus())
    } finally {
      setSettingsBusy(false)
    }
  }

  const handleTestAlert = async () => {
    setSettingsBusy(true)
    setTestMessage(null)
    try {
      await sendTestNotification('smart_alert')
      setTestMessage(t('scalp.setup.testSent'))
    } catch {
      setTestMessage(t('scalp.setup.testFailed'))
    } finally {
      setSettingsBusy(false)
    }
  }

  const handleDisablePush = async () => {
    setSettingsBusy(true)
    try {
      await disableNotifications()
      setPushStatus(await getPushStatus())
    } finally {
      setSettingsBusy(false)
    }
  }

  return (
    <div className="sa-section" id="smartAlertsSection">
      <div className="sa-header">
        <div>
          <div className="sa-title">{t('smartAlerts.title')}</div>
          <div className="sa-subtitle">{t('smartAlerts.subtitle')}</div>
          <div className={`sa-status ${overallActive ? 'active' : 'paused'}`}>
            {overallActive ? t('smartAlerts.statusActive') : t('smartAlerts.statusPaused')}
          </div>
        </div>
        <div className="sa-header-actions">
          <button type="button" className="sa-create-btn" onClick={() => setBuilderState({})}>
            {t('smartAlerts.createCta')}
          </button>
          <button type="button" className="sa-secondary-btn" onClick={() => setShowSettings((s) => !s)}>
            {t('smartAlerts.notificationSettings')}
          </button>
        </div>
      </div>

      {showSettings ? (
        <div className="bt-group">
          <div className="bt-group-title">{t('smartAlerts.notificationSettings')}</div>
          {pushStatus ? (
            <div className="bt-field-row">
              <p className="bt-field-hint" style={{ flex: 1 }}>
                {pushStatus.subscribed
                  ? t('scalp.setup.status.enabled')
                  : !pushStatus.supported
                    ? t('scalp.setup.status.unsupported')
                    : t('scalp.setup.status.disabled')}
              </p>
              {pushStatus.subscribed ? (
                <button type="button" className="bt-reset-btn" disabled={settingsBusy} onClick={handleDisablePush}>
                  {t('scalp.setup.disableNotifications')}
                </button>
              ) : (
                <button type="button" className="bt-run-btn" disabled={settingsBusy || !pushStatus.supported} onClick={handleEnablePush}>
                  {t('scalp.setup.enableNotifications')}
                </button>
              )}
            </div>
          ) : null}
          {pushStatus?.subscribed ? (
            <div className="bt-field-row">
              <button type="button" className="bt-run-btn" disabled={settingsBusy} onClick={handleTestAlert}>
                {t('smartAlerts.push.testBtn')}
              </button>
              {testMessage ? <p className="bt-field-hint">{testMessage}</p> : null}
            </div>
          ) : null}
          {pushStatus?.subscribed ? (
            <label className="bt-asset-chip" style={{ padding: '6px 10px' }}>
              <input
                type="checkbox"
                checked={smartAlertsPushEnabled}
                onChange={(e) => {
                  setSmartAlertsPushEnabled(e.target.checked)
                  void updateSmartAlertsPushPreference(e.target.checked)
                }}
              />{' '}
              {t('smartAlerts.push.label')}
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="sa-summary-grid">
        <div className="sa-summary-item">
          <div className="sa-s-label">{t('smartAlerts.summary.activeAlerts')}</div>
          <div className="sa-s-value">{activeAlerts.length}</div>
        </div>
        <div className="sa-summary-item">
          <div className="sa-s-label">{t('smartAlerts.summary.triggeredToday')}</div>
          <div className="sa-s-value">{triggeredToday.length}</div>
        </div>
        <div className="sa-summary-item">
          <div className="sa-s-label">{t('smartAlerts.summary.monitoring', { symbol: 'BTC' })}</div>
          <div className={`sa-s-value ${btcMonitoring ? 'on' : 'off'}`}>{btcMonitoring ? t('smartAlerts.summary.on') : t('smartAlerts.summary.off')}</div>
        </div>
        <div className="sa-summary-item">
          <div className="sa-s-label">{t('smartAlerts.summary.push')}</div>
          <div className={`sa-s-value ${pushStatus?.subscribed ? 'on' : 'off'}`}>{pushStatus?.subscribed ? t('smartAlerts.summary.on') : t('smartAlerts.summary.off')}</div>
        </div>
      </div>

      <div className="sa-tabs">
        <button type="button" className={`sa-tab ${tab === 'active' ? 'active' : ''}`} onClick={() => setTab('active')}>
          {t('smartAlerts.tabs.active')} ({alerts.length})
        </button>
        <button type="button" className={`sa-tab ${tab === 'triggered' ? 'active' : ''}`} onClick={() => setTab('triggered')}>
          {t('smartAlerts.tabs.triggered')} {unreadCount > 0 ? `(${unreadCount})` : ''}
        </button>
        <button type="button" className={`sa-tab ${tab === 'presets' ? 'active' : ''}`} onClick={() => setTab('presets')}>
          {t('smartAlerts.tabs.presets')}
        </button>
      </div>

      {tab === 'active' ? (
        alerts.length === 0 ? (
          <>
            <p className="sa-empty">{t('smartAlerts.empty.active')}</p>
            {quickStart}
          </>
        ) : (
          <div className="sa-cards-grid">
            {alerts.map((alert) => (
              <AlertCard
                key={alert.id}
                alert={alert}
                snapshot={snapshots[alert.symbol]}
                onEdit={() => setBuilderState({ initial: alert })}
                onTogglePause={() => toggleAlert(alert.id, !(alert.enabled && !alert.sessionExpired))}
                onDelete={() => deleteAlert(alert.id)}
              />
            ))}
          </div>
        )
      ) : null}

      {tab === 'triggered' ? <HistoryList events={history} onMarkRead={markRead} onDelete={deleteHistory} /> : null}

      {tab === 'presets' ? (
        <>
          {quickStart}
          <PresetGrid onUsePreset={handleUsePreset} />
        </>
      ) : null}

      <p className="sa-disclaimer">{t('smartAlerts.disclaimer')}</p>

      {builderState ? (
        <AlertBuilderModal
          initial={builderState.initial}
          presetId={builderState.presetId}
          presetName={builderState.presetId ? t(`smartAlerts.preset.${builderState.presetId}.name`) : undefined}
          onClose={() => setBuilderState(null)}
          onSave={saveAlert}
        />
      ) : null}
    </div>
  )
}
