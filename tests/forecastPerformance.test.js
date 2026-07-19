import { describe, expect, it } from 'vitest'

import {
  describeBias,
  describeMaeAdvantage,
  describeMaeChange,
  formatRatioMagnitudeAsPercent,
  formatUsdMagnitude,
} from '../src/domain/decimalFormat.js'
import {
  buildForecastPerformanceModel,
  validateForecastPerformanceReport,
} from '../src/domain/forecastPerformance.js'
import { validateProjectionIdentity } from '../src/domain/shadowSeries.js'
import { mountAppShell } from '../src/views/appShell.js'
import { renderForecastPerformance } from '../src/views/forecastPerformanceCard.js'
import {
  ARTIFACT,
  FINGERPRINT,
  LIVE_PAYLOAD,
  MODEL_VERSION,
  OTHER_ARTIFACT,
  OTHER_FINGERPRINT,
  PERFORMANCE_EVALUATIONS,
} from './fixtures/shadowEvaluations.js'

const validationOptions = {
  requestedMarketId: 42,
  configuredModelVersion: MODEL_VERSION,
}

function historicalIdentity(report = PERFORMANCE_EVALUATIONS) {
  return validateProjectionIdentity(report, {
    configuredModelVersion: MODEL_VERSION,
    isCurrentMarket: false,
  })
}

function completedModel(report = PERFORMANCE_EVALUATIONS) {
  return buildForecastPerformanceModel(report, {
    ...validationOptions,
    identity: historicalIdentity(report),
  })
}

function emptyReport(active) {
  const response = structuredClone(PERFORMANCE_EVALUATIONS)
  response.coverage = {
    ...response.coverage,
    market_window_elapsed: active,
    observed_buckets: 0,
    attempts: 0,
    valid_forecasts: 0,
    scored: 0,
    invalid: 0,
    valid_without_actual: 0,
  }
  response.points = []
  response.model.selection_identities = []
  response.performance.cohorts = []
  return response
}

describe('forecast performance decimal copy', () => {
  it('formats magnitudes, tiny values, signed skill, advantage, and bias without binary floats', () => {
    expect(formatUsdMagnitude('1234.567')).toBe('$1,234.57')
    expect(formatUsdMagnitude('-0.004')).toBe('<$0.01')
    expect(formatRatioMagnitudeAsPercent('-0.832041343669250646')).toBe('83.2%')
    expect(describeMaeAdvantage('16.10')).toBe('$16.10 closer')
    expect(describeMaeAdvantage('-2.00')).toBe('$2.00 worse')
    expect(describeMaeChange('0')).toBe('Same error as no change')
    expect(describeMaeChange(null)).toBe('N/A — no-change error was zero')
    expect(describeBias('0.42')).toBe('$0.42 high on average')
    expect(describeBias('-0.42')).toBe('$0.42 low on average')
  })
})

describe('validateForecastPerformanceReport', () => {
  it('validates the additive cohort contract and exact returned counts', () => {
    const result = validateForecastPerformanceReport(PERFORMANCE_EVALUATIONS, validationOptions)
    expect(result.ok).toBe(true)
    expect(result.value).toMatchObject({ active: false })
    expect(result.value.evaluationSemantics).toEqual({
      scored_input_max_future_skew_ms: 0,
    })
    expect(result.value.points[0]).toMatchObject({
      chainlink_at_forecast: '64080.47',
      futures_at_forecast: '64137.91',
    })
    expect(result.value.cohorts[0]).toMatchObject({
      scoredPoints: 2,
      selectionIdentity: {
        fingerprint_sha256: FINGERPRINT,
        artifact_sha256: ARTIFACT,
      },
    })
  })

  it('requires schema v2 and an explicit zero-future-skew scoring guarantee', () => {
    const schemaOne = structuredClone(PERFORMANCE_EVALUATIONS)
    schemaOne.schema_version = 1
    expect(validateForecastPerformanceReport(schemaOne, validationOptions)).toMatchObject({
      ok: false,
      code: 'invalid-report',
    })

    const missingSemantics = structuredClone(PERFORMANCE_EVALUATIONS)
    delete missingSemantics.evaluation_semantics
    expect(validateForecastPerformanceReport(missingSemantics, validationOptions)).toMatchObject({
      ok: false,
      code: 'invalid-report',
    })

    const futureSkewAllowed = structuredClone(PERFORMANCE_EVALUATIONS)
    futureSkewAllowed.evaluation_semantics.scored_input_max_future_skew_ms = 1
    expect(validateForecastPerformanceReport(futureSkewAllowed, validationOptions)).toMatchObject({
      ok: false,
      code: 'invalid-report',
    })
  })

  it.each([
    [
      'a valid row with no persisted futures input',
      (point) => {
        point.futures_at_forecast = null
        point.futures_at_forecast_source_timestamp_ms = null
        point.futures_at_forecast_received_ms = null
      },
    ],
    [
      'an incomplete forecast-time Chainlink timestamp pair',
      (point) => { point.chainlink_at_forecast_source_timestamp_ms = null },
    ],
    [
      'an incomplete forecast-time futures timestamp pair',
      (point) => { point.futures_at_forecast_received_ms = null },
    ],
    [
      'a futures input received after forecast generation',
      (point) => { point.futures_at_forecast_received_ms = point.generated_ms + 1 },
    ],
    [
      'a Chainlink input received after forecast generation',
      (point) => { point.chainlink_at_forecast_received_ms = point.generated_ms + 1 },
    ],
    [
      'a target actual received after its target',
      (point) => { point.actual_chainlink_received_ms = point.target_ms + 1 },
    ],
    [
      'timestamps attached to a null target actual',
      (point) => {
        point.actual_chainlink = null
        point.actual_chainlink_source_timestamp_ms = point.target_ms
        point.actual_chainlink_received_ms = point.target_ms
      },
    ],
  ])('rejects %s', (_description, mutatePoint) => {
    const response = structuredClone(PERFORMANCE_EVALUATIONS)
    mutatePoint(response.points[0])
    expect(validateForecastPerformanceReport(response, validationOptions)).toMatchObject({
      ok: false,
      code: 'invalid-report',
    })
  })

  it('distinguishes an older backend from empty evidence', () => {
    const response = structuredClone(PERFORMANCE_EVALUATIONS)
    delete response.performance
    expect(validateForecastPerformanceReport(response, validationOptions)).toMatchObject({
      ok: false,
      code: 'api-update-required',
    })
  })

  it('rejects inconsistent coverage and paired cohort totals', () => {
    const response = structuredClone(PERFORMANCE_EVALUATIONS)
    response.performance.cohorts[0].paired_comparison.losses = 1
    expect(validateForecastPerformanceReport(response, validationOptions)).toMatchObject({
      ok: false,
      code: 'invalid-report',
    })
  })

  it('requires lowercase complete SHA-256 identity pairs', () => {
    const response = structuredClone(PERFORMANCE_EVALUATIONS)
    response.performance.cohorts[0].selection_identity.fingerprint_sha256 = FINGERPRINT.toUpperCase()
    expect(validateForecastPerformanceReport(response, validationOptions)).toMatchObject({
      ok: false,
      code: 'invalid-report',
    })
  })
})

describe('buildForecastPerformanceModel', () => {
  it('selects the single historical cohort only after matching the full identity pair', () => {
    const model = completedModel()
    expect(model).toMatchObject({
      state: 'ready',
      identityLabel: 'Configured candidate — historical primary unverified',
      cohort: { scoredPoints: 2 },
    })
  })

  it('uses coverage.market_window_elapsed for the active so-far state', () => {
    const response = structuredClone(PERFORMANCE_EVALUATIONS)
    response.coverage.market_window_elapsed = false
    const identity = validateProjectionIdentity(response, {
      configuredModelVersion: MODEL_VERSION,
      livePayload: LIVE_PAYLOAD,
      isCurrentMarket: true,
    })
    const model = buildForecastPerformanceModel(response, {
      ...validationOptions,
      identity,
    })
    expect(identity.verifiedPrimary).toBe(true)
    expect(model.state).toBe('ready')
    expect(model.report.active).toBe(true)
  })

  it('withholds active metrics when the live identity cannot be verified', () => {
    const response = structuredClone(PERFORMANCE_EVALUATIONS)
    response.coverage.market_window_elapsed = false
    const identity = validateProjectionIdentity(response, {
      configuredModelVersion: MODEL_VERSION,
      livePayload: { ...LIVE_PAYLOAD, signals: { chainlink_catchup: null } },
      isCurrentMarket: true,
    })
    const model = buildForecastPerformanceModel(response, {
      ...validationOptions,
      identity,
    })
    expect(identity).toMatchObject({ projectionVisible: false, code: 'live-selection-unverified' })
    expect(model).toMatchObject({
      state: 'suppressed',
      title: 'Configured/live selection mismatch',
    })
  })

  it('never combines or silently chooses between multiple cohorts', () => {
    const response = structuredClone(PERFORMANCE_EVALUATIONS)
    const second = structuredClone(response.performance.cohorts[0])
    response.performance.cohorts[0].scored_points = 1
    response.performance.cohorts[0].paired_comparison = {
      wins: 1,
      ties: 0,
      losses: 0,
      win_rate: '1',
      tie_rate: '0',
      loss_rate: '0',
    }
    second.selection_identity = {
      fingerprint_sha256: OTHER_FINGERPRINT,
      artifact_sha256: OTHER_ARTIFACT,
    }
    second.scored_points = 1
    second.paired_comparison = {
      wins: 0,
      ties: 0,
      losses: 1,
      win_rate: '0',
      tie_rate: '0',
      loss_rate: '1',
    }
    response.performance.cohorts.push(second)
    response.model.selection_identities.push(second.selection_identity)
    response.points[1].selection_fingerprint_sha256 = OTHER_FINGERPRINT
    response.points[1].selection_artifact_sha256 = OTHER_ARTIFACT

    const model = buildForecastPerformanceModel(response, {
      ...validationOptions,
      identity: { projectionVisible: false, code: 'selection-change' },
    })
    expect(model.state).toBe('selection-change')
    expect(model.cohorts).toHaveLength(2)
    expect(model.cohort).toBeUndefined()
  })

  it('keeps active waiting, completed empty, and zero-scored cohort states distinct', () => {
    const activeEmpty = emptyReport(false)
    const completedEmpty = emptyReport(true)
    expect(buildForecastPerformanceModel(activeEmpty, validationOptions)).toMatchObject({
      state: 'waiting',
      title: 'Waiting for persisted forecast attempts.',
    })
    expect(buildForecastPerformanceModel(completedEmpty, validationOptions)).toMatchObject({
      state: 'empty',
      title: 'No retained forecast performance for this market.',
    })

    const unscored = structuredClone(PERFORMANCE_EVALUATIONS)
    unscored.points = [unscored.points[0]]
    unscored.points[0].actual_chainlink = null
    unscored.points[0].actual_chainlink_source_timestamp_ms = null
    unscored.points[0].actual_chainlink_received_ms = null
    unscored.points[0].forecast_error = null
    unscored.points[0].baseline_error = null
    unscored.coverage = {
      ...unscored.coverage,
      observed_buckets: 1,
      attempts: 1,
      valid_forecasts: 1,
      scored: 0,
      invalid: 0,
      valid_without_actual: 1,
    }
    const cohort = unscored.performance.cohorts[0]
    cohort.scored_points = 0
    Object.keys(cohort.forecast).forEach((key) => { cohort.forecast[key] = null })
    Object.keys(cohort.no_change_baseline).forEach((key) => { cohort.no_change_baseline[key] = null })
    cohort.mean_absolute_advantage_usd = null
    cohort.mae_skill_vs_no_change = null
    cohort.rmse_skill_vs_no_change = null
    cohort.paired_comparison = {
      wins: 0,
      ties: 0,
      losses: 0,
      win_rate: null,
      tie_rate: null,
      loss_rate: null,
    }

    expect(completedModel(unscored)).toMatchObject({
      state: 'unscored',
      title: 'No causally scored forecasts for this market.',
    })
  })
})

describe('forecast performance card', () => {
  it('renders semantic metrics and the required plain-language comparisons', () => {
    const root = document.createElement('div')
    const refs = mountAppShell(root)
    renderForecastPerformance(refs, completedModel(), {
      resource: { status: 'success', error: null },
    })

    expect(refs['performance-card'].querySelector('dl')).not.toBeNull()
    expect(refs['performance-body'].textContent).toContain('$3.25')
    expect(refs['performance-body'].textContent).toContain('83.2% lower')
    expect(refs['performance-body'].textContent).toContain('2 closer · 0 equal · 0 worse')
    expect(refs['performance-body'].textContent).toContain('2 scored · 4 attempts · 1 invalid · 1 valid without actual')
    expect(refs['performance-body'].textContent).not.toContain('Accuracy')
  })

  it('calls an active verified card Forecast performance so far', () => {
    const response = structuredClone(PERFORMANCE_EVALUATIONS)
    response.coverage.market_window_elapsed = false
    const identity = validateProjectionIdentity(response, {
      configuredModelVersion: MODEL_VERSION,
      livePayload: LIVE_PAYLOAD,
      isCurrentMarket: true,
    })
    const model = buildForecastPerformanceModel(response, {
      ...validationOptions,
      identity,
    })
    const root = document.createElement('div')
    const refs = mountAppShell(root)
    renderForecastPerformance(refs, model, { resource: { status: 'success' } })

    expect(refs['performance-title'].textContent).toBe('Forecast performance so far')
    expect(refs['performance-badge'].hidden).toBe(false)
    expect(refs['performance-subtitle'].textContent).toContain('3.0 s horizon')
  })

  it('renders request failures separately from an older-backend update state', () => {
    const root = document.createElement('div')
    const refs = mountAppShell(root)
    renderForecastPerformance(refs, null, {
      resource: { status: 'error', error: { status: 422 } },
    })
    expect(refs['performance-body'].textContent).toContain('Configuration/request error.')

    const response = structuredClone(PERFORMANCE_EVALUATIONS)
    delete response.performance
    const model = buildForecastPerformanceModel(response, validationOptions)
    renderForecastPerformance(refs, model, { resource: { status: 'success' } })
    expect(refs['performance-body'].textContent).toContain('API update required')
  })
})
