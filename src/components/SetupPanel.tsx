import { useEffect, useState } from 'react'
import { useI18n } from '../i18n/useI18n'
import { CollapsiblePanel } from './CollapsiblePanel'
import { getStrategyConfig, setStrategyConfig, type StrategyConfig } from '../config/strategyConfig'
import { syncConfigToServer } from '../lib/scalp/remoteConfig'
import {
  ALL_ALERT_TYPES,
  disableNotifications,
  enableNotifications,
  getPushStatus,
  sendTestNotification,
  updateAlertPreferences,
  type PushStatus,
} from '../lib/push/pushClient'
import type { AlertType } from '../types/scalpSignal'
import type { Currency } from '../types/domain'

interface Props {
  onConfigChange: (config: StrategyConfig) => void
}

export function SetupPanel({ onConfigChange }: Props) {
  const { t } = useI18n()
  const [config, setConfig] = useState<StrategyConfig>(() => getStrategyConfig())
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null)
  const [alertTypes, setAlertTypes] = useState<AlertType[]>(ALL_ALERT_TYPES)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const refreshPushStatus = async () => setPushStatus(await getPushStatus())

  useEffect(() => {
    void refreshPushStatus()
  }, [])

  const handleEnable = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await enableNotifications(alertTypes)
      await refreshPushStatus()
      setMessage(t('scalp.setup.enabledOk'))
    } catch (e) {
      const code = (e as Error).message
      setMessage(t(`scalp.setup.error.${code}`))
    } finally {
      setBusy(false)
    }
  }

  const handleDisable = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await disableNotifications()
      await refreshPushStatus()
      setMessage(t('scalp.setup.disabledOk'))
    } finally {
      setBusy(false)
    }
  }

  const handleTest = async () => {
    setBusy(true)
    setMessage(null)
    try {
      await sendTestNotification()
      setMessage(t('scalp.setup.testSent'))
    } catch {
      setMessage(t('scalp.setup.testFailed'))
    } finally {
      setBusy(false)
    }
  }

  const toggleAlertType = (type: AlertType) => {
    setAlertTypes((prev) => {
      const next = prev.includes(type) ? prev.filter((x) => x !== type) : [...prev, type]
      if (pushStatus?.subscribed) void updateAlertPreferences(next)
      return next
    })
  }

  const updateConfig = (patch: Partial<StrategyConfig>) => {
    const next = setStrategyConfig(patch)
    setConfig(next)
    onConfigChange(next)
    void syncConfigToServer(next)
  }

  const notifStatusKey = !pushStatus
    ? null
    : !pushStatus.supported
      ? 'unsupported'
      : !pushStatus.backendConfigured
        ? 'backendNotConfigured'
        : pushStatus.iosNeedsInstall
          ? 'iosNeedsInstall'
          : pushStatus.permission === 'denied'
            ? 'permissionDenied'
            : pushStatus.subscribed
              ? 'enabled'
              : 'disabled'

  return (
    <CollapsiblePanel
      id="scalpSetupPanel"
      sectionClassName="bt-panel"
      headerClassName="bt-panel-header"
      title={<div className="bt-panel-title">⚙️ {t('scalp.setup.title')}</div>}
      defaultCollapsed
    >
      <div className="bt-group">
        <div className="bt-group-title">{t('scalp.setup.notificationsGroup')}</div>
        {notifStatusKey ? <p className="bt-preset-desc">{t(`scalp.setup.status.${notifStatusKey}`)}</p> : null}

        <div className="bt-assets-grid scalp-alert-types">
          {ALL_ALERT_TYPES.map((type) => (
            <label key={type} className="bt-asset-chip">
              <input type="checkbox" checked={alertTypes.includes(type)} onChange={() => toggleAlertType(type)} />{' '}
              {t(`scalp.alertType.${type}`)}
            </label>
          ))}
        </div>

        <div className="bt-actions">
          {pushStatus?.subscribed ? (
            <>
              <button type="button" className="bt-run-btn" disabled={busy} onClick={handleTest}>
                {t('scalp.setup.testNotification')}
              </button>
              <button type="button" className="bt-reset-btn" disabled={busy} onClick={handleDisable}>
                {t('scalp.setup.disableNotifications')}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="bt-run-btn"
              disabled={busy || !pushStatus?.supported || !pushStatus?.backendConfigured || pushStatus?.iosNeedsInstall}
              onClick={handleEnable}
            >
              {t('scalp.setup.enableNotifications')}
            </button>
          )}
        </div>
        {message ? <p className="bt-preset-desc scalp-setup-message">{message}</p> : null}
      </div>

      <div className="bt-group">
        <div className="bt-group-title">{t('scalp.setup.riskGroup')}</div>
        <div className="scalp-mode-badge">{t('scalp.setup.modePrudent')}</div>

        <div className="bt-field-row">
          <label className="bt-field bt-field-control">
            {t('scalp.setup.capital')}
            <input
              type="number"
              min={0}
              value={config.capital}
              onChange={(e) => updateConfig({ capital: +e.target.value })}
            />
          </label>
          <p className="bt-field-hint">{t('scalp.setup.hint.capital')}</p>
        </div>

        <div className="bt-field-row">
          <label className="bt-field bt-field-control">
            {t('scalp.setup.capitalCurrency')}
            <select value={config.capitalCurrency} onChange={(e) => updateConfig({ capitalCurrency: e.target.value as Currency })}>
              <option value="usd">USD ($)</option>
              <option value="eur">EUR (€)</option>
              <option value="chf">CHF (Fr.)</option>
            </select>
          </label>
          <p className="bt-field-hint">{t('scalp.setup.hint.capitalCurrency')}</p>
        </div>

        <div className="bt-field-row">
          <label className="bt-field bt-field-control">
            {t('scalp.setup.riskPerTrade', { v: config.riskPerTradePct })}
            <input
              type="range"
              min={0.1}
              max={2}
              step={0.05}
              value={config.riskPerTradePct}
              onChange={(e) => updateConfig({ riskPerTradePct: +e.target.value })}
            />
          </label>
          <p className="bt-field-hint">{t('scalp.setup.hint.riskPerTrade')}</p>
        </div>

        <div className="bt-field-row">
          <label className="bt-field bt-field-control">
            {t('scalp.setup.minRiskReward', { v: config.minRiskReward })}
            <input
              type="range"
              min={1}
              max={5}
              step={0.1}
              value={config.minRiskReward}
              onChange={(e) => updateConfig({ minRiskReward: +e.target.value })}
            />
          </label>
          <p className="bt-field-hint">{t('scalp.setup.hint.minRiskReward')}</p>
        </div>

        <div className="bt-field-row">
          <label className="bt-field bt-field-control">
            {t('scalp.setup.maxTradesPerDay')}
            <input
              type="number"
              min={1}
              max={20}
              value={config.maxTradesPerDay}
              onChange={(e) => updateConfig({ maxTradesPerDay: +e.target.value })}
            />
          </label>
          <p className="bt-field-hint">{t('scalp.setup.hint.maxTradesPerDay')}</p>
        </div>

        <div className="bt-field-row">
          <label className="bt-field bt-field-control">
            {t('scalp.setup.maxDailyLossR')}
            <input
              type="number"
              min={0.5}
              max={10}
              step={0.5}
              value={config.maxDailyLossR}
              onChange={(e) => updateConfig({ maxDailyLossR: +e.target.value })}
            />
          </label>
          <p className="bt-field-hint">{t('scalp.setup.hint.maxDailyLossR')}</p>
        </div>
      </div>
    </CollapsiblePanel>
  )
}
