import { beforeEach, describe, expect, it, vi } from 'vitest'

const echartsMocks = vi.hoisted(() => {
  const listeners = new Map()
  const chart = {
    setOption: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn((name, listener) => listeners.set(name, listener)),
    off: vi.fn(),
  }
  return {
    chart,
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

function chartModel(marketId, { evaluations = true } = {}) {
  const startMs = marketId * 300_000
  const targetMs = startMs + 1_000
  const point = { targetMs, actualDecimal: null, projectedDecimal: '100.00' }
  return {
    mode: 'live',
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

describe('catch-up chart lifecycle', () => {
  beforeEach(() => {
    echartsMocks.chart.setOption.mockClear()
    echartsMocks.chart.resize.mockClear()
    echartsMocks.chart.clear.mockClear()
    echartsMocks.chart.dispose.mockClear()
    echartsMocks.chart.on.mockClear()
    echartsMocks.chart.off.mockClear()
    echartsMocks.listeners.clear()
  })

  it('resets persisted legend choices when the market context changes', () => {
    const container = document.createElement('div')
    container.getBoundingClientRect = () => ({ width: 900 })
    const controller = createCatchupChart(container, {
      ResizeObserver: FakeResizeObserver,
      reducedMotionMedia: { matches: false, addEventListener() {}, removeEventListener() {} },
    })

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
