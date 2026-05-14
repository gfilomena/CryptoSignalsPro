import type { Currency, LiveAsset } from '../types/domain'
import { applyChfConversion, formatPriceShort, getBinancePair } from './currency'

export interface ChartBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export const CHART_TIMEFRAMES: Record<string, { interval: string; limit: number }> = {
  '24H': { interval: '15m', limit: 96 },
  '1S': { interval: '1h', limit: 168 },
  '1M': { interval: '4h', limit: 180 },
  '3M': { interval: '1d', limit: 90 },
  '1A': { interval: '1d', limit: 365 },
  /** ~5 anni, candele settimanali (un solo request, limite Binance 1000) */
  '5Y': { interval: '1w', limit: 270 },
  /** Storico lungo: mensili fino a 1000 barre (~83 anni, tutto ciò che l’API restituisce in una chiamata) */
  'ALL': { interval: '1M', limit: 1000 },
}

export type ChartTfKey = keyof typeof CHART_TIMEFRAMES

export async function fetchChartData(
  symbol: string,
  timeframe: ChartTfKey,
  assets: LiveAsset[],
  currency: Currency,
  chfRate: number | null,
): Promise<ChartBar[]> {
  const asset = assets.find((a) => a.symbol === symbol)
  if (!asset) return []
  const pair = getBinancePair(asset, currency)
  const tf = CHART_TIMEFRAMES[timeframe]
  const url = `https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${tf.interval}&limit=${tf.limit}`
  try {
    const res = await fetch(url)
    const data = (await res.json()) as number[][]
    return data.map((k) => ({
      time: k[0],
      open: applyChfConversion(parseFloat(String(k[1])), currency, chfRate),
      high: applyChfConversion(parseFloat(String(k[2])), currency, chfRate),
      low: applyChfConversion(parseFloat(String(k[3])), currency, chfRate),
      close: applyChfConversion(parseFloat(String(k[4])), currency, chfRate),
      volume: parseFloat(String(k[5])),
    }))
  } catch (e) {
    console.error('Chart data error:', e)
    return []
  }
}

export function formatChartLabel(timestamp: number, timeframe: ChartTfKey, dateLocale = 'en-US'): string {
  const d = new Date(timestamp)
  if (timeframe === '24H') return d.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
  if (timeframe === '1S') return d.toLocaleDateString(dateLocale, { day: '2-digit', month: 'short' })
  if (timeframe === '1M') return d.toLocaleDateString(dateLocale, { day: '2-digit', month: 'short' })
  if (timeframe === '3M' || timeframe === '1A') return d.toLocaleDateString(dateLocale, { month: 'short' })
  if (timeframe === '5Y' || timeframe === 'ALL')
    return d.toLocaleDateString(dateLocale, { month: 'short', year: 'numeric' })
  return d.toLocaleDateString(dateLocale, { day: '2-digit', month: 'short' })
}

export function formatTooltipDate(timestamp: number, dateLocale = 'en-US'): string {
  const d = new Date(timestamp)
  return (
    d.toLocaleDateString(dateLocale, { day: '2-digit', month: 'long', year: 'numeric' }) +
    ' ' +
    d.toLocaleTimeString(dateLocale, { hour: '2-digit', minute: '2-digit' })
  )
}

export interface ChartStoredData {
  points: { x: number; y: number }[]
  closes: number[]
  times: number[]
  pad: { top: number; right: number; bottom: number; left: number }
  cW: number
  cH: number
  viewMin: number
  viewMax: number
  viewRange: number
  W: number
  H: number
  lineColor: string
  n: number
}

declare global {
  interface HTMLCanvasElement {
    _chartData?: ChartStoredData
  }
}

export function drawPriceChart(
  canvas: HTMLCanvasElement,
  klines: ChartBar[],
  isPositive: boolean,
  currency: Currency,
  timeframe: ChartTfKey,
  dateLocale = 'en-US',
): void {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const dpr = window.devicePixelRatio || 1
  const wrap = canvas.parentElement
  if (!wrap) return
  const W = wrap.clientWidth
  const H = wrap.clientHeight

  canvas.width = W * dpr
  canvas.height = H * dpr
  canvas.style.width = `${W}px`
  canvas.style.height = `${H}px`
  ctx.scale(dpr, dpr)

  const pad = { top: 25, right: 75, bottom: 35, left: 15 }
  const cW = W - pad.left - pad.right
  const cH = H - pad.top - pad.bottom

  const closes = klines.map((k) => k.close)
  const times = klines.map((k) => k.time)
  const n = closes.length
  if (n < 2) return

  const minP = Math.min(...closes)
  const maxP = Math.max(...closes)
  const range = maxP - minP || maxP * 0.01
  const viewMin = minP - range * 0.05
  const viewMax = maxP + range * 0.05
  const viewRange = viewMax - viewMin

  ctx.clearRect(0, 0, W, H)

  const gridN = 5
  ctx.font = '11px -apple-system, BlinkMacSystemFont, sans-serif'
  ctx.textAlign = 'left'
  for (let i = 0; i <= gridN; i++) {
    const y = pad.top + (cH / gridN) * i
    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.lineWidth = 1
    ctx.setLineDash([])
    ctx.beginPath()
    ctx.moveTo(pad.left, y)
    ctx.lineTo(W - pad.right, y)
    ctx.stroke()

    const price = viewMax - (viewRange / gridN) * i
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.fillText(formatPriceShort(price, currency), W - pad.right + 8, y + 4)
  }

  const labelCount = W < 500 ? 4 : 6
  const step = Math.floor(n / labelCount)
  ctx.fillStyle = 'rgba(255,255,255,0.3)'
  ctx.font = '10px -apple-system, sans-serif'
  ctx.textAlign = 'center'
  for (let i = 0; i <= labelCount; i++) {
    const idx = Math.min(i * step, n - 1)
    const x = pad.left + (idx / (n - 1)) * cW
    ctx.fillText(formatChartLabel(times[idx], timeframe, dateLocale), x, H - 10)

    ctx.strokeStyle = 'rgba(255,255,255,0.03)'
    ctx.beginPath()
    ctx.moveTo(x, pad.top)
    ctx.lineTo(x, H - pad.bottom)
    ctx.stroke()
  }

  const points = closes.map((p, i) => ({
    x: pad.left + (i / (n - 1)) * cW,
    y: pad.top + ((viewMax - p) / viewRange) * cH,
  }))

  const lineColor = isPositive ? '#22c55e' : '#ef4444'
  const alphaBase = isPositive ? '34,197,94' : '239,68,68'

  const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom)
  grad.addColorStop(0, `rgba(${alphaBase},0.28)`)
  grad.addColorStop(0.7, `rgba(${alphaBase},0.05)`)
  grad.addColorStop(1, `rgba(${alphaBase},0.0)`)

  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  ctx.lineTo(points[n - 1].x, H - pad.bottom)
  ctx.lineTo(points[0].x, H - pad.bottom)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()

  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  ctx.strokeStyle = lineColor
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.setLineDash([])
  ctx.stroke()

  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  ctx.strokeStyle = `rgba(${alphaBase},0.3)`
  ctx.lineWidth = 6
  ctx.stroke()

  const lastY = points[n - 1].y
  ctx.strokeStyle = `rgba(${alphaBase},0.4)`
  ctx.lineWidth = 1
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.moveTo(pad.left, lastY)
  ctx.lineTo(W - pad.right, lastY)
  ctx.stroke()
  ctx.setLineDash([])

  ctx.beginPath()
  ctx.arc(points[n - 1].x, lastY, 5, 0, Math.PI * 2)
  ctx.fillStyle = lineColor
  ctx.fill()
  ctx.beginPath()
  ctx.arc(points[n - 1].x, lastY, 8, 0, Math.PI * 2)
  ctx.strokeStyle = `rgba(${alphaBase},0.4)`
  ctx.lineWidth = 2
  ctx.stroke()

  const curLabel = wrap.querySelector('.chart-current-label')
  if (curLabel) curLabel.remove()
  const tag = document.createElement('div')
  tag.className = 'chart-current-label'
  tag.style.top = `${lastY}px`
  tag.textContent = formatPriceShort(closes[n - 1], currency)
  wrap.appendChild(tag)

  canvas._chartData = {
    points,
    closes,
    times,
    pad,
    cW,
    cH,
    viewMin,
    viewMax,
    viewRange,
    W,
    H,
    lineColor,
    n,
  }
}
