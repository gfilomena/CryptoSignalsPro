import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { Currency, LiveAsset } from '../types/domain'
import { useI18n } from '../i18n/useI18n'
import { localeTag } from '../i18n/utils'
import {
  type ChartBar,
  type ChartTfKey,
  drawPriceChart,
  fetchChartData,
  formatTooltipDate,
} from '../lib/chart'
import { formatPrice, formatPriceShort } from '../lib/currency'

const TF_KEYS: ChartTfKey[] = ['24H', '1S', '1M', '3M', '1A', '5Y', 'ALL']
const TF_I18N: Record<ChartTfKey, string> = {
  '24H': 'chart.tf24H',
  '1S': 'chart.tf1S',
  '1M': 'chart.tf1M',
  '3M': 'chart.tf3M',
  '1A': 'chart.tf1A',
  '5Y': 'chart.tf5Y',
  'ALL': 'chart.tfAll',
}

interface Props {
  symbol: string
  timeframe: ChartTfKey
  onTimeframe: (tf: ChartTfKey) => void
  assets: LiveAsset[]
  currency: Currency
  chfRate: number | null
}

export function PriceChartBlock({ symbol, timeframe, onTimeframe, assets, currency, chfRate }: Props) {
  const { t, locale } = useI18n()
  const dateLc = localeTag(locale)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [klines, setKlines] = useState<ChartBar[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchChartData(symbol, timeframe, assets, currency, chfRate).then((data) => {
      if (!cancelled) {
        setKlines(data)
        setLoading(false)
      }
    })
    return () => {
      cancelled = true
    }
  }, [symbol, timeframe, assets, currency, chfRate])

  const redraw = () => {
    const canvas = canvasRef.current
    if (!canvas || klines.length < 2) return
    const isPos = klines[klines.length - 1].close >= klines[0].close
    drawPriceChart(canvas, klines, isPos, currency, timeframe, dateLc)
  }

  useLayoutEffect(() => {
    redraw()
  }, [klines, currency, timeframe, dateLc])

  useEffect(() => {
    const onResize = () => redraw()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [klines, currency, timeframe, dateLc])

  useEffect(() => {
    const wrap = wrapRef.current
    const canvas = canvasRef.current
    if (!wrap || !canvas) return

    const onMove = (e: MouseEvent) => {
      const data = canvas._chartData
      if (!data) return
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const ratio = (mx - data.pad.left) / data.cW
      const idx = Math.max(0, Math.min(data.n - 1, Math.round(ratio * (data.n - 1))))
      const pt = data.points[idx]
      const price = data.closes[idx]
      const time = data.times[idx]

      const cx = document.getElementById('crosshairX')
      const cy = document.getElementById('crosshairY')
      if (cx && cy) {
        cx.style.display = 'block'
        cx.style.left = `${pt.x}px`
        cy.style.display = 'block'
        cy.style.top = `${pt.y}px`
      }
      const tt = document.getElementById('chartTooltip')
      if (tt) {
        tt.style.display = 'block'
        if (pt.x > data.W * 0.6) {
          tt.style.left = 'auto'
          tt.style.right = '12px'
        } else {
          tt.style.left = '12px'
          tt.style.right = 'auto'
        }
      }
      const ttPrice = document.getElementById('ttPrice')
      const ttDate = document.getElementById('ttDate')
      const ttChange = document.getElementById('ttChange')
      if (ttPrice) ttPrice.textContent = formatPrice(price, currency)
      if (ttDate) ttDate.textContent = formatTooltipDate(time, dateLc)
      const firstP = data.closes[0]
      const chg = ((price - firstP) / firstP) * 100
      if (ttChange) {
        ttChange.textContent = (chg >= 0 ? '+' : '') + chg.toFixed(2) + '%'
        ttChange.style.color = chg >= 0 ? '#22c55e' : '#ef4444'
      }
      const ptag = document.getElementById('priceTag')
      if (ptag) {
        ptag.style.display = 'block'
        ptag.style.top = `${pt.y}px`
        ptag.textContent = formatPriceShort(price, currency)
      }
    }

    const onLeave = () => {
      document.getElementById('crosshairX')?.style.setProperty('display', 'none')
      document.getElementById('crosshairY')?.style.setProperty('display', 'none')
      document.getElementById('chartTooltip')?.style.setProperty('display', 'none')
      document.getElementById('priceTag')?.style.setProperty('display', 'none')
    }

    wrap.addEventListener('mousemove', onMove)
    wrap.addEventListener('mouseleave', onLeave)
    return () => {
      wrap.removeEventListener('mousemove', onMove)
      wrap.removeEventListener('mouseleave', onLeave)
    }
  }, [klines, currency, dateLc])

  return (
    <div className="chart-section">
      <div className="chart-toolbar">
        <div className="chart-timeframes">
          {TF_KEYS.map((tf) => (
            <button
              key={tf}
              type="button"
              className={`chart-tf-btn ${timeframe === tf ? 'active' : ''}`}
              onClick={() => onTimeframe(tf)}
            >
              {t(TF_I18N[tf])}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-canvas-wrap" id="chartWrap" ref={wrapRef}>
        <canvas id="priceChart" ref={canvasRef} />
        <div className="chart-crosshair-x" id="crosshairX" />
        <div className="chart-crosshair-y" id="crosshairY" />
        <div className="chart-tooltip" id="chartTooltip">
          <div className="chart-tooltip-price" id="ttPrice" />
          <div className="chart-tooltip-date" id="ttDate" />
          <div className="chart-tooltip-change" id="ttChange" />
        </div>
        <div className="chart-price-tag" id="priceTag" />
        <div className="chart-loading" id="chartLoading" style={{ display: loading ? 'flex' : 'none' }}>
          {t('chart.loading')}
        </div>
      </div>
    </div>
  )
}
