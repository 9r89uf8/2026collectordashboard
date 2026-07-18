import { describe, expect, it } from 'vitest'

import {
  FORECAST_ERROR_SERIES_NAME,
  createForecastErrorChartOptions,
} from '../src/charts/forecastErrorChart.js'
import { buildShadowSeries } from '../src/domain/shadowSeries.js'
import {
  MARKET,
  MODEL_VERSION,
  PERFORMANCE_EVALUATIONS,
} from './fixtures/shadowEvaluations.js'

function modelFor(response = PERFORMANCE_EVALUATIONS) {
  return {
    market: {
      marketId: MARKET.market_id,
      marketStartMs: MARKET.market_start_ms,
      marketEndMs: MARKET.market_end_ms,
    },
    shadowSeries: buildShadowSeries(response, {
      configuredModelVersion: MODEL_VERSION,
      isCurrentMarket: false,
    }),
  }
}

function namedSeries(options, name) {
  return options.series.find((series) => series.name === name)
}

describe('forecast error strip', () => {
  it('plots persisted signed errors at target_ms and leaves invalid or unscored attempts as gaps', () => {
    const options = createForecastErrorChartOptions(modelFor())
    const series = namedSeries(options, FORECAST_ERROR_SERIES_NAME)

    expect(series).toMatchObject({
      type: 'line',
      smooth: false,
      connectNulls: false,
    })
    expect(series.data[0].value[0]).toBe(MARKET.market_start_ms)
    expect(series.data[0].value[0]).not.toBe(PERFORMANCE_EVALUATIONS.points[0].generated_ms)
    expect(series.data[0].value[1]).toBe(3.25)
    expect(series.data.filter((datum) => datum.value[1] === null).length).toBeGreaterThanOrEqual(3)
    expect(options.series[0].data).toEqual([
      [MARKET.market_start_ms, 0],
      [MARKET.market_end_ms, 0],
    ])
  })

  it('makes a $13 spike visible at its exact target with signed tooltip copy', () => {
    const response = structuredClone(PERFORMANCE_EVALUATIONS)
    response.points[0].forecast_error = '13'
    const options = createForecastErrorChartOptions(modelFor(response))
    const series = namedSeries(options, FORECAST_ERROR_SERIES_NAME)
    const spike = series.data.find((datum) => datum.exact === '13')

    expect(spike.value).toEqual([response.points[0].target_ms, 13])
    expect(options.yAxis.max).toBeGreaterThan(13)
    expect(options.yAxis.min).toBeLessThan(-13)
    expect(options.tooltip.formatter({ data: spike })).toContain('+$13.00')
    expect(options.tooltip.formatter({ data: spike })).toContain('Projection was above actual')
  })

  it('removes all signed error values when projection identity is suppressed', () => {
    const response = structuredClone(PERFORMANCE_EVALUATIONS)
    const shadowSeries = buildShadowSeries(response, {
      identity: {
        projectionVisible: false,
        configuredModelVersion: MODEL_VERSION,
      },
    })
    const options = createForecastErrorChartOptions({
      market: {
        marketStartMs: MARKET.market_start_ms,
        marketEndMs: MARKET.market_end_ms,
      },
      shadowSeries,
    })
    const series = namedSeries(options, FORECAST_ERROR_SERIES_NAME)
    expect(series.data.every((datum) => datum.value[1] === null)).toBe(true)
  })

  it('uses only the persisted forecast_error field and never derives a strip value', () => {
    const response = structuredClone(PERFORMANCE_EVALUATIONS)
    response.points[0].forecast_error = null
    const shadowSeries = buildShadowSeries(response, {
      configuredModelVersion: MODEL_VERSION,
      isCurrentMarket: false,
    })
    const firstPoint = shadowSeries.points[0]
    const firstError = shadowSeries.error.find((point) => point.targetMs === firstPoint.targetMs)

    expect(firstPoint.forecastErrorDecimal).toBe('3.25')
    expect(firstPoint.persistedForecastErrorDecimal).toBeNull()
    expect(firstError.plotValue).toBeNull()
  })
})
