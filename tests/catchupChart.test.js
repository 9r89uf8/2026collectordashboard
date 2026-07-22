import { beforeEach, describe, expect, it, vi } from 'vitest'

const echartsMocks = vi.hoisted(() => {
  const listeners = new Map()
  const chart = {
    setOption: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
    dispatchAction: vi.fn(),
    on: vi.fn((name, listener) => listeners.set(name, listener)),
    off: vi.fn(),
  }
  return {
    chart,
    dataZoomComponent: { kind: 'data-zoom-component' },
    listeners,
    getInstanceByDom: vi.fn(() => null),
    init: vi.fn(() => chart),
    use: vi.fn(),
  }
})

vi.mock('echarts/core', () => ({
  getInstanceByDom: echartsMocks.getInstanceByDom,
  init: echartsMocks.init,
  use: echartsMocks.use,
}))
vi.mock('echarts/charts', () => ({ LineChart: {}, ScatterChart: {} }))
vi.mock('echarts/components', () => ({
  AriaComponent: {},
  DataZoomComponent: echartsMocks.dataZoomComponent,
  GraphicComponent: {},
  GridComponent: {},
  LegendComponent: {},
  TooltipComponent: {},
}))
vi.mock('echarts/renderers', () => ({ CanvasRenderer: {} }))

import { CHART_SERIES_NAMES } from '../src/charts/catchupChartOptions.js'
import { createCatchupChart } from '../src/charts/catchupChart.js'

class FakeResizeObserver {
  observe() {}
  disconnect() {}
}

function chartModel(
  marketId,
  {
    evaluations = true,
    mode = 'live',
    targetOffsetMs = 1_000,
    marketStartMs = marketId * 300_000,
  } = {},
) {
  const startMs = marketStartMs
  const targetMs = startMs + targetOffsetMs
  const point = { targetMs, actualDecimal: null, projectedDecimal: '100.00' }
  return {
    mode,
    market: {
      marketId,
      marketStartMs: startMs,
      marketEndMs: startMs + 300_000,
    },
    shadowSeries: {
      actual: evaluations
        ? [{ targetMs, decimal: null, plotValue: null, value: null }]
        : [],
      futures: [],
      projected: evaluations
        ? [{ targetMs, decimal: '100.00', plotValue: 100, value: 100 }]
        : [],
      baseline: [],
      points: evaluations ? [point] : [],
      projectionVisible: true,
      identity: { projectionVisible: true },
    },
    contextualActual: [
      { targetMs, decimal: '99.00', actualDecimal: '99.00', plotValue: 99, value: 99 },
    ],
  }
}

function lastChartOptions() {
  return echartsMocks.chart.setOption.mock.calls.at(-1)[0]
}

function sliderWindow() {
  const slider = lastChartOptions().dataZoom.find((zoom) => zoom.type === 'slider')
  return { startValue: slider.startValue, endValue: slider.endValue }
}

function createController(container) {
  return createCatchupChart(container, {
    ResizeObserver: FakeResizeObserver,
    reducedMotionMedia: { matches: false, addEventListener() {}, removeEventListener() {} },
  })
}

describe('catch-up chart lifecycle', () => {
  beforeEach(() => {
    echartsMocks.chart.setOption.mockClear()
    echartsMocks.chart.resize.mockClear()
    echartsMocks.chart.clear.mockClear()
    echartsMocks.chart.dispose.mockClear()
    echartsMocks.chart.dispatchAction.mockClear()
    echartsMocks.chart.on.mockClear()
    echartsMocks.chart.off.mockClear()
    echartsMocks.listeners.clear()
  })

  it('registers the modular DataZoom component', () => {
    expect(echartsMocks.use).toHaveBeenCalled()
    expect(echartsMocks.use.mock.calls[0][0]).toContain(echartsMocks.dataZoomComponent)
  })

  it('follows the latest point until the user changes the horizontal window', () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ width: 900 })
    const controller = createController(container)
    const marketStartMs = 300_000

    controller.update(chartModel(1, { targetOffsetMs: 120_000 }))
    expect(sliderWindow()).toEqual({
      startValue: marketStartMs + 60_000,
      endValue: marketStartMs + 120_000,
    })

    controller.update(chartModel(1, { targetOffsetMs: 180_000 }))
    expect(sliderWindow()).toEqual({
      startValue: marketStartMs + 120_000,
      endValue: marketStartMs + 180_000,
    })
    controller.dispose()
  })

  it('preserves a user datazoom window across same-market updates and layout rebuilds', () => {
    const container = document.createElement('div')
    let width = 900
    container.getBoundingClientRect = () => ({ width })
    const controller = createController(container)
    const marketStartMs = 300_000

    controller.update(chartModel(1, { targetOffsetMs: 180_000 }))
    echartsMocks.listeners.get('datazoom')({ batch: [{ start: 10, end: 30 }] })
    expect(echartsMocks.chart.dispatchAction).toHaveBeenCalledWith({ type: 'hideTip' })
    controller.update(chartModel(1, { targetOffsetMs: 240_000 }))
    expect(sliderWindow()).toEqual({
      startValue: marketStartMs + 30_000,
      endValue: marketStartMs + 90_000,
    })

    width = 760
    controller.resize()
    expect(sliderWindow()).toEqual({
      startValue: marketStartMs + 30_000,
      endValue: marketStartMs + 90_000,
    })
    controller.dispose()
  })

  it('resets user zoom on mode, market, or fixed-window context changes', () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ width: 900 })
    const controller = createController(container)

    controller.update(chartModel(1, { targetOffsetMs: 180_000 }))
    echartsMocks.listeners.get('datazoom')({ startValue: 310_000, endValue: 370_000 })
    controller.update(chartModel(1, { mode: 'recent', targetOffsetMs: 180_000 }))
    expect(sliderWindow()).toEqual({ startValue: 420_000, endValue: 480_000 })

    echartsMocks.listeners.get('datazoom')({ startValue: 310_000, endValue: 370_000 })
    controller.update(chartModel(2, { mode: 'recent', targetOffsetMs: 180_000 }))
    expect(sliderWindow()).toEqual({ startValue: 720_000, endValue: 780_000 })

    echartsMocks.listeners.get('datazoom')({ startValue: 610_000, endValue: 670_000 })
    controller.update(chartModel(2, {
      mode: 'recent',
      targetOffsetMs: 180_000,
      marketStartMs: 900_000,
    }))
    expect(sliderWindow()).toEqual({ startValue: 1_020_000, endValue: 1_080_000 })
    controller.dispose()
  })

  it('clear forgets the user zoom before the next render', () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ width: 900 })
    const controller = createController(container)

    controller.update(chartModel(1, { targetOffsetMs: 180_000 }))
    echartsMocks.listeners.get('datazoom')({ startValue: 310_000, endValue: 370_000 })
    controller.clear()
    controller.update(chartModel(1, { targetOffsetMs: 180_000 }))

    expect(sliderWindow()).toEqual({ startValue: 420_000, endValue: 480_000 })
    expect(echartsMocks.chart.clear).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('resets persisted legend choices when the market context changes', () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ width: 900 })
    const controller = createController(container)

    controller.update(chartModel(1))
    expect(
      echartsMocks.chart.setOption.mock.calls.at(-1)[0].legend.selected[
        CHART_SERIES_NAMES.contextualActual
      ],
    ).toBe(false)

    echartsMocks.listeners.get('legendselectchanged')({
      selected: { [CHART_SERIES_NAMES.contextualActual]: false },
    })
    controller.update(chartModel(2, { evaluations: false }))

    expect(
      echartsMocks.chart.setOption.mock.calls.at(-1)[0].legend.selected[
        CHART_SERIES_NAMES.contextualActual
      ],
    ).toBe(true)
    controller.dispose()
  })
})
