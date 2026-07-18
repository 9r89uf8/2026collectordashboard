import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import { AriaComponent, GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

import { financialChartNumber, formatCurrency, toDecimalOrNull } from '../domain/decimalFormat.js'
import { formatElapsed, formatUtcTimestamp } from './catchupChartOptions.js'

echarts.use([LineChart, AriaComponent, GridComponent, TooltipComponent, CanvasRenderer])

export const FORECAST_ERROR_SERIES_NAME = 'Signed forecast error'

function readPalette(element) {
  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return {
      panel: '#111821',
      panelRaised: '#16202b',
      grid: '#263341',
      text: '#ecf2f8',
      muted: '#8d9aaa',
      projected: '#f4b860',
      positive: '#4fd18b',
      negative: '#ff7474',
    }
  }
  const style = window.getComputedStyle(element)
  const token = (name, fallback) => style.getPropertyValue(name).trim() || fallback
  return {
    panel: token('--panel', '#111821'),
    panelRaised: token('--panel-raised', '#16202b'),
    grid: token('--grid', '#263341'),
    text: token('--text', '#ecf2f8'),
    muted: token('--muted', '#8d9aaa'),
    projected: token('--projected', '#f4b860'),
    positive: token('--positive', '#4fd18b'),
    negative: token('--negative', '#ff7474'),
  }
}

function targetMsOf(item) {
  return item?.targetMs ?? item?.target_ms ?? null
}

function exactErrorOf(item) {
  return item?.persistedForecastErrorDecimal ?? item?.forecast_error ?? item?.decimal ?? item?.point?.persistedForecastErrorDecimal ?? null
}

function errorData(model, market) {
  const source = model?.shadowSeries?.error ?? model?.error ?? []
  return source
    .map((item) => {
      const targetMs = targetMsOf(item)
      if (!Number.isSafeInteger(targetMs) || targetMs < market.startMs || targetMs >= market.endMs) {
        return null
      }
      const exact = exactErrorOf(item)
      const plotValue = item?.plotValue === null || item?.value === null
        ? null
        : Number.isFinite(item?.plotValue)
          ? item.plotValue
          : financialChartNumber(exact)
      return {
        value: [targetMs, plotValue],
        exact,
        raw: item?.point ?? item,
      }
    })
    .filter(Boolean)
    .sort((left, right) => left.value[0] - right.value[0])
}

function symmetricBound(data) {
  const maximum = data.reduce((current, datum) => {
    const value = datum.value[1]
    return Number.isFinite(value) ? Math.max(current, Math.abs(value)) : current
  }, 0)
  return Math.max(maximum * 1.18, 0.01)
}

function errorTooltip(params) {
  const datum = params?.data
  const error = toDecimalOrNull(datum?.exact)
  if (!datum || error === null) return ''
  const direction = error.isZero()
    ? 'Forecast matched the causal actual'
    : error.isPositive()
      ? 'Projection was above actual'
      : 'Projection was below actual'
  return `<div class="chart-tooltip chart-tooltip--compact">
    <div class="chart-tooltip__title">Signed forecast error</div>
    <div class="chart-tooltip__row"><span class="chart-tooltip__label">Target</span><span class="chart-tooltip__value">${formatUtcTimestamp(datum.value[0])}</span></div>
    <div class="chart-tooltip__row"><span class="chart-tooltip__label">Persisted error</span><span class="chart-tooltip__value">${formatCurrency(datum.exact, { sign: 'always' })}</span></div>
    <div class="chart-tooltip__row"><span class="chart-tooltip__label">Meaning</span><span class="chart-tooltip__value">${direction}</span></div>
  </div>`
}

export function createForecastErrorChartOptions(model, runtime = {}) {
  const marketValue = model?.market ?? {}
  const startMs = marketValue.marketStartMs ?? marketValue.market_start_ms
  const endMs = marketValue.marketEndMs ?? marketValue.market_end_ms
  if (!Number.isSafeInteger(startMs) || !Number.isSafeInteger(endMs) || endMs <= startMs) {
    throw new TypeError('Forecast error chart requires a valid market window.')
  }
  const market = { startMs, endMs }
  const data = errorData(model, market)
  const bound = symmetricBound(data)
  const palette = runtime.palette ?? {
    panel: '#111821',
    panelRaised: '#16202b',
    grid: '#263341',
    text: '#ecf2f8',
    muted: '#8d9aaa',
    projected: '#f4b860',
    positive: '#4fd18b',
    negative: '#ff7474',
  }
  const compact = runtime.compact === true
  const reducedMotion = runtime.reducedMotion === true

  return {
    backgroundColor: 'transparent',
    useUTC: true,
    animation: !reducedMotion,
    animationDuration: reducedMotion ? 0 : 180,
    aria: {
      show: true,
      enabled: true,
      label: {
        enabled: true,
        description: `Signed forecast errors at target time. Positive values mean projection above actual; negative values mean projection below actual. ${data.filter((datum) => datum.value[1] !== null).length} scored errors are visible.`,
      },
    },
    grid: {
      top: 9,
      right: compact ? 12 : 22,
      bottom: 27,
      left: compact ? 10 : 18,
      containLabel: true,
    },
    tooltip: {
      trigger: 'item',
      confine: true,
      backgroundColor: palette.panelRaised,
      borderColor: palette.grid,
      borderWidth: 1,
      padding: 0,
      extraCssText: 'border-radius:8px;box-shadow:0 16px 42px rgba(0,0,0,.42);',
      formatter: errorTooltip,
    },
    xAxis: {
      type: 'time',
      min: startMs,
      max: endMs,
      minInterval: 60_000,
      maxInterval: 60_000,
      splitNumber: 5,
      boundaryGap: false,
      axisLine: { lineStyle: { color: palette.grid } },
      axisTick: { show: false },
      axisLabel: {
        color: palette.muted,
        fontSize: 9,
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        formatter: (value) => formatElapsed(value, startMs),
      },
      splitLine: { show: false },
    },
    yAxis: {
      type: 'value',
      min: -bound,
      max: bound,
      splitNumber: 2,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: palette.muted,
        fontSize: 9,
        fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        formatter: (value) => `${value > 0 ? '+' : value < 0 ? '−' : ''}$${Math.abs(value).toFixed(value === 0 ? 0 : 2)}`,
      },
      splitLine: { show: false },
    },
    series: [
      {
        name: 'Exact match',
        type: 'line',
        data: [[startMs, 0], [endMs, 0]],
        showSymbol: false,
        silent: true,
        animation: false,
        lineStyle: { color: palette.grid, width: 1, type: 'dashed', opacity: 0.9 },
        z: 1,
      },
      {
        name: FORECAST_ERROR_SERIES_NAME,
        type: 'line',
        data,
        showSymbol: true,
        symbol: 'circle',
        symbolSize: 4,
        smooth: false,
        connectNulls: false,
        animation: false,
        lineStyle: { color: palette.projected, width: 1.5 },
        itemStyle: {
          color(params) {
            const value = params?.data?.value?.[1]
            return value < 0 ? palette.negative : value > 0 ? palette.positive : palette.projected
          },
        },
        areaStyle: { color: palette.projected, opacity: 0.06 },
        z: 3,
      },
    ],
  }
}

export function createForecastErrorChart(container, options = {}) {
  if (!(container instanceof HTMLElement)) {
    throw new TypeError('createForecastErrorChart requires a chart container element.')
  }
  const chart = echarts.getInstanceByDom(container) ?? echarts.init(container, null, {
    renderer: 'canvas',
    useDirtyRect: true,
  })
  let model = null
  let disposed = false
  const reducedMotion = options.reducedMotionMedia ?? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')

  const render = (nextModel = model) => {
    if (disposed || !nextModel) return
    model = nextModel
    const width = container.getBoundingClientRect?.().width ?? container.clientWidth ?? 900
    chart.setOption(createForecastErrorChartOptions(model, {
      palette: readPalette(container),
      compact: width < 680,
      reducedMotion: reducedMotion?.matches === true,
    }), { notMerge: true, lazyUpdate: false })
  }

  const resize = () => {
    if (disposed) return
    chart.resize({ animation: { duration: 0 } })
    if (model) render()
  }
  const ResizeObserverConstructor = options.ResizeObserver ?? globalThis.ResizeObserver
  const observer = ResizeObserverConstructor ? new ResizeObserverConstructor(resize) : null
  observer?.observe(container)
  if (!observer) globalThis.addEventListener?.('resize', resize, { passive: true })

  return {
    chart,
    update: render,
    render,
    clear() {
      model = null
      chart.clear()
    },
    dispose() {
      if (disposed) return
      disposed = true
      observer?.disconnect()
      if (!observer) globalThis.removeEventListener?.('resize', resize)
      chart.dispose()
    },
  }
}

export default createForecastErrorChart
