import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BT_ASSETS } from '../constants/btAssets'
import { BT_PRESETS, type PresetKey } from '../../backtest/presets'
import type { BacktestResult, BacktestParams, BacktestProgress } from '../../backtest/engine'
import { readCustomDateRange, runBacktestSimulation } from '../../backtest/engine'
import { useI18n } from '../i18n/useI18n'
import { CollapsiblePanel } from './CollapsiblePanel'

function drawEquityCurve(canvas: HTMLCanvasElement, data: { time: number; equity: number }[]) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  canvas.width = canvas.offsetWidth * dpr
  canvas.height = canvas.offsetHeight * dpr
  ctx.scale(dpr, dpr)
  const w = canvas.offsetWidth
  const h = canvas.offsetHeight
  ctx.clearRect(0, 0, w, h)
  if (data.length < 2) return
  const sampled = data.length > 200 ? data.filter((_, i) => i % Math.ceil(data.length / 200) === 0) : data
  const values = sampled.map((d) => d.equity)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  ctx.beginPath()
  ctx.strokeStyle = values[values.length - 1] >= values[0] ? '#22c55e' : '#ef4444'
  ctx.lineWidth = 1.5
  for (let i = 0; i < values.length; i++) {
    const x = (i / (values.length - 1)) * w
    const y = h - ((values[i] - min) / range) * (h - 10) - 5
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()
}

export function BacktestSection() {
  const { t } = useI18n()
  const [presetKey, setPresetKey] = useState<PresetKey>('full')
  const [btInterval, setBtInterval] = useState('4h')
  const [period, setPeriod] = useState('90')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [buyT, setBuyT] = useState(45)
  const [sellT, setSellT] = useState(45)
  const [minC, setMinC] = useState(65)
  const [slM, setSlM] = useState(8)
  const [slA, setSlA] = useState(12)
  const [slMe, setSlMe] = useState(15)
  const [tpAct, setTpAct] = useState(35)
  const [tpStep, setTpStep] = useState(15)
  const [maxPos, setMaxPos] = useState(8)
  const [weights, setWeights] = useState({
    ema200: 25,
    rsiDiv: 20,
    rsi: 15,
    macd: 20,
    bb: 15,
    obv: 10,
    atr: 15,
  })
  const [indOn, setIndOn] = useState({
    ema200: true,
    rsiDiv: true,
    rsi: true,
    macd: true,
    bb: true,
    obv: true,
    atr: true,
  })
  const [assetsSel, setAssetsSel] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(BT_ASSETS.map((a) => [a.symbol, true])),
  )
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<BacktestProgress>({ pct: 0 })
  const [result, setResult] = useState<BacktestResult | null>(null)
  const chartRef = useRef<HTMLCanvasElement>(null)

  const applyPreset = useCallback((k: PresetKey) => {
    const p = BT_PRESETS[k]
    if (!p) return
    setPresetKey(k)
    setBtInterval(p.interval)
    setPeriod(String(p.days))
    setBuyT(p.buyThresh)
    setSellT(p.sellMag)
    setMinC(p.minConf)
    setSlM(p.slMajor)
    setSlA(p.slAlt)
    setSlMe(p.slMeme)
    setTpAct(p.tpAct)
    setTpStep(p.tpStep)
    setMaxPos(p.maxPos)
    setWeights({
      ema200: p.ind.ema200[1],
      rsiDiv: p.ind.rsiDiv[1],
      rsi: p.ind.rsi[1],
      macd: p.ind.macd[1],
      bb: p.ind.bb[1],
      obv: p.ind.obv[1],
      atr: p.ind.atr[1],
    })
    setIndOn({
      ema200: !!p.ind.ema200[0],
      rsiDiv: !!p.ind.rsiDiv[0],
      rsi: !!p.ind.rsi[0],
      macd: !!p.ind.macd[0],
      bb: !!p.ind.bb[0],
      obv: !!p.ind.obv[0],
      atr: !!p.ind.atr[0],
    })
    if (p.assets === 'all') setAssetsSel(Object.fromEntries(BT_ASSETS.map((a) => [a.symbol, true])))
    else setAssetsSel(Object.fromEntries(BT_ASSETS.map((a) => [a.symbol, p.assets.includes(a.symbol)])))
    setDateFrom('')
    setDateTo('')
  }, [])

  useEffect(() => {
    applyPreset('full')
  }, [applyPreset])

  useLayoutEffect(() => {
    if (result?.dailyEquity && chartRef.current) drawEquityCurve(chartRef.current, result.dailyEquity)
  }, [result])

  const buildParams = (): BacktestParams => {
    const selected = BT_ASSETS.filter((a) => assetsSel[a.symbol]).map((a) => a.symbol)
    const useCustom = period === 'custom'
    let daySpan: number | null = null
    if (!useCustom) {
      if (period === 'all') daySpan = 10_000
      else daySpan = +period
    }
    return {
      interval: btInterval,
      days: useCustom ? null : daySpan,
      useCustomRange: useCustom,
      dateFrom: useCustom ? dateFrom : null,
      dateTo: useCustom ? dateTo : null,
      buyThresh: buyT,
      sellThresh: -sellT,
      minConfidence: minC,
      stopLoss: { major: -slM, altcoin: -slA, meme: -slMe },
      trailingActivation: tpAct / 10,
      trailingStep: tpStep / 10,
      maxPositions: maxPos,
      weights: {
        ema200: indOn.ema200 ? weights.ema200 : 0,
        rsiDiv: indOn.rsiDiv ? weights.rsiDiv : 0,
        rsi: indOn.rsi ? weights.rsi : 0,
        macd: indOn.macd ? weights.macd : 0,
        bb: indOn.bb ? weights.bb : 0,
        obv: indOn.obv ? weights.obv : 0,
        atr: indOn.atr ? weights.atr : 0,
      },
      assets: selected,
    }
  }

  const run = async () => {
    const params = buildParams()
    if (params.assets.length === 0) {
      alert(t('backtest.alertSelectAsset'))
      return
    }
    if (params.useCustomRange) {
      const c = readCustomDateRange(params.dateFrom || '', params.dateTo || '')
      if (c === 'incomplete') {
        alert(t('backtest.alertCustomBoth'))
        return
      }
      if (c === 'invalid') {
        alert(t('backtest.alertCustomInvalid'))
        return
      }
      if (c === 'short') {
        alert(t('backtest.alertCustomShort'))
        return
      }
      if (c === 'long') {
        alert(t('backtest.alertCustomLong'))
        return
      }
    }
    setRunning(true)
    setResult(null)
    setProgress({ pct: 0 })
    try {
      const r = await runBacktestSimulation(params, (p) => setProgress(p))
      setResult(r)
    } catch (e) {
      const msg = (e as Error).message
      if (msg.startsWith('I18N:')) alert(t(msg.slice(5)))
      else alert(msg)
    }
    setRunning(false)
  }

  const pnlClass = (v: number) => (v >= 0 ? 'positive' : 'negative')
  const progressLine =
    progress.textKey && progress.textKey.length > 0 ? t(progress.textKey, progress.textParams) : '\u00a0'

  return (
    <CollapsiblePanel
      id="btPanel"
      sectionClassName="bt-panel"
      headerClassName="bt-panel-header"
      title={<div className="bt-panel-title">{t('backtest.title')}</div>}
      defaultCollapsed
    >
      <div className="bt-group">
        <div className="bt-group-title">{t('backtest.presetGroup')}</div>
        <label className="bt-field">
          {t('backtest.quickConfig')}
          <select
            value={presetKey}
            onChange={(e) => {
              const v = e.target.value as PresetKey
              if (BT_PRESETS[v]) applyPreset(v)
            }}
          >
            {(Object.keys(BT_PRESETS) as PresetKey[]).map((k) => (
              <option key={k} value={k}>
                {t(`preset.name.${k}`)}
              </option>
            ))}
          </select>
        </label>
        <p className="bt-preset-desc">{t(`preset.desc.${presetKey}`)}</p>
      </div>

      <div className="bt-group">
        <div className="bt-group-title">{t('backtest.tfPeriod')}</div>
        <div className="bt-row">
          <label className="bt-field">
            {t('backtest.kline')}
            <select value={btInterval} onChange={(e) => setBtInterval(e.target.value)}>
              <option value="1h">{t('backtest.k1h')}</option>
              <option value="4h">{t('backtest.k4h')}</option>
              <option value="1d">{t('backtest.k1d')}</option>
            </select>
          </label>
          <label className="bt-field">
            {t('backtest.period')}
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="7">{t('backtest.p7')}</option>
              <option value="30">{t('backtest.p30')}</option>
              <option value="90">{t('backtest.p90')}</option>
              <option value="180">{t('backtest.p180')}</option>
              <option value="365">{t('backtest.p365')}</option>
              <option value="1825">{t('backtest.p1825')}</option>
              <option value="all">{t('backtest.pAll')}</option>
              <option value="custom">{t('backtest.pCustom')}</option>
            </select>
          </label>
        </div>
        {period === 'custom' ? (
          <div className="bt-row" style={{ marginTop: 10 }}>
            <label className="bt-field">
              {t('backtest.dateFrom')}
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </label>
            <label className="bt-field">
              {t('backtest.dateTo')}
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </label>
          </div>
        ) : null}
      </div>

      <div className="bt-group">
        <div className="bt-group-title">{t('backtest.thresholds')}</div>
        <div className="bt-row">
          <label className="bt-field">
            {t('backtest.buyThresh', { v: buyT })}
            <input type="range" min={30} max={70} value={buyT} onChange={(e) => setBuyT(+e.target.value)} />
          </label>
          <label className="bt-field">
            {t('backtest.sellThresh', { v: sellT })}
            <input type="range" min={30} max={70} value={sellT} onChange={(e) => setSellT(+e.target.value)} />
          </label>
          <label className="bt-field">
            {t('backtest.minConf', { v: minC })}
            <input type="range" min={40} max={90} value={minC} onChange={(e) => setMinC(+e.target.value)} />
          </label>
        </div>
      </div>

      <div className="bt-group">
        <div className="bt-group-title">{t('backtest.assets')}</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <button
            type="button"
            className="bt-reset-btn"
            onClick={() => setAssetsSel(Object.fromEntries(BT_ASSETS.map((a) => [a.symbol, true])))}
          >
            {t('backtest.selectAll')}
          </button>
          <button
            type="button"
            className="bt-reset-btn"
            onClick={() => setAssetsSel(Object.fromEntries(BT_ASSETS.map((a) => [a.symbol, false])))}
          >
            {t('backtest.selectNone')}
          </button>
        </div>
        <div className="bt-assets-grid">
          {BT_ASSETS.map((a) => (
            <label key={a.symbol} className={`bt-asset-chip ${a.tier}`}>
              <input
                type="checkbox"
                checked={assetsSel[a.symbol]}
                onChange={(e) => setAssetsSel((s) => ({ ...s, [a.symbol]: e.target.checked }))}
              />{' '}
              {a.symbol}
            </label>
          ))}
        </div>
      </div>

      <div className="bt-actions">
        <button type="button" className="bt-run-btn" disabled={running} onClick={run}>
          {t('backtest.run')}
        </button>
        <button type="button" className="bt-reset-btn" onClick={() => applyPreset('full')}>
          {t('backtest.reset')}
        </button>
      </div>

      <div className={`bt-progress ${running ? 'active' : ''}`} id="btProgress">
        <div className="bt-progress-bar">
          <div className="bt-progress-fill" style={{ width: `${progress.pct}%` }} />
        </div>
        <div className="bt-progress-text">{progressLine}</div>
      </div>

      {result ? (
        <div className="bt-results active" id="btResults">
          <div className="bt-group-title" style={{ marginTop: 8 }}>
            {t('backtest.results')}
          </div>
          <div className="bt-summary-grid">
            <div className="bt-summary-item">
              <div className="bt-s-label">{t('backtest.totalPnl')}</div>
              <div className={`bt-s-value ${pnlClass(result.totalPnl)}`}>
                {result.totalPnl >= 0 ? '+' : ''}${result.totalPnl.toFixed(2)}
              </div>
            </div>
            <div className="bt-summary-item">
              <div className="bt-s-label">{t('backtest.pnlPct')}</div>
              <div className={`bt-s-value ${pnlClass(result.pnlPct)}`}>
                {result.pnlPct >= 0 ? '+' : ''}
                {result.pnlPct.toFixed(2)}%
              </div>
            </div>
            <div className="bt-summary-item">
              <div className="bt-s-label">{t('backtest.winRate')}</div>
              <div className="bt-s-value">{result.winRate.toFixed(1)}%</div>
            </div>
            <div className="bt-summary-item">
              <div className="bt-s-label">{t('backtest.trades')}</div>
              <div className="bt-s-value">{result.totalTrades}</div>
            </div>
            <div className="bt-summary-item">
              <div className="bt-s-label">{t('backtest.maxDd')}</div>
              <div className="bt-s-value negative">-{result.maxDrawdown.toFixed(2)}%</div>
            </div>
          </div>
          <div className="bt-group-title">{t('backtest.equity')}</div>
          <canvas className="bt-chart-canvas" ref={chartRef} height={160} />
        </div>
      ) : null}
    </CollapsiblePanel>
  )
}
