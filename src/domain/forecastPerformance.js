import { decimalStringOrNull, toDecimalOrNull } from './decimalFormat.js'
import {
  MARKET_WINDOW_DURATION_MS,
  normalizeMarketWindow,
  targetBelongsToMarket,
} from './marketWindow.js'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const MAX_ATTEMPTS = 1_000

const FORECAST_METRICS = Object.freeze([
  'mean_absolute_error_usd',
  'median_absolute_error_usd',
  'p95_absolute_error_usd',
  'maximum_absolute_error_usd',
  'root_mean_squared_error_usd',
  'mean_signed_error_usd',
])

const BASELINE_METRICS = Object.freeze([
  'mean_absolute_error_usd',
  'root_mean_squared_error_usd',
])

const COHORT_TOP_LEVEL_METRICS = Object.freeze([
  'mean_absolute_advantage_usd',
  'mae_skill_vs_no_change',
  'rmse_skill_vs_no_change',
])

function invalid(code, message) {
  return Object.freeze({ ok: false, code, message })
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0
}

function finiteDecimalOrNull(value) {
  return value === null || decimalStringOrNull(value) !== null
}

function requiredDecimal(value) {
  return typeof value === 'string' && toDecimalOrNull(value) !== null
}

function validateObservationTriple(
  point,
  {
    label,
    valueField,
    sourceTimestampField,
    receivedTimestampField,
    required,
    noLaterThanMs,
  },
) {
  const value = point[valueField]
  const sourceTimestampMs = point[sourceTimestampField]
  const receivedTimestampMs = point[receivedTimestampField]

  if (value === null) {
    if (sourceTimestampMs !== null || receivedTimestampMs !== null) {
      return invalid('invalid-report', `${label} timestamps must be null when its value is null.`)
    }
    if (required) {
      return invalid('invalid-report', `A valid evaluation is missing its ${label} observation.`)
    }
    return Object.freeze({ ok: true })
  }

  if (
    !requiredDecimal(value) ||
    !nonNegativeInteger(sourceTimestampMs) ||
    !nonNegativeInteger(receivedTimestampMs)
  ) {
    return invalid('invalid-report', `${label} value or timestamps are malformed.`)
  }
  if (receivedTimestampMs > noLaterThanMs) {
    return invalid('invalid-report', `${label} was received after its causal cutoff.`)
  }
  return Object.freeze({ ok: true })
}

function strictIdentity(value) {
  if (!value || typeof value !== 'object') return null
  const source = value.selection_identity ?? value.selectionIdentity ?? value
  const fingerprint = source.fingerprint_sha256 ?? source.fingerprintSha256 ?? source.selection_fingerprint_sha256 ?? source.selectionFingerprintSha256
  const artifact = source.artifact_sha256 ?? source.artifactSha256 ?? source.selection_artifact_sha256 ?? source.selectionArtifactSha256
  if (!SHA256_PATTERN.test(fingerprint) || !SHA256_PATTERN.test(artifact)) return null
  return Object.freeze({
    fingerprint_sha256: fingerprint,
    artifact_sha256: artifact,
    fingerprintSha256: fingerprint,
    artifactSha256: artifact,
  })
}

export function performanceIdentityKey(value) {
  const identity = strictIdentity(value)
  return identity
    ? `${identity.fingerprint_sha256}:${identity.artifact_sha256}`
    : null
}

function sameIdentity(left, right) {
  const key = performanceIdentityKey(left)
  return key !== null && key === performanceIdentityKey(right)
}

function validateCoverage(coverage) {
  if (!coverage || typeof coverage !== 'object') {
    return invalid('invalid-report', 'Evaluation coverage is missing.')
  }

  const countFields = [
    'attempts',
    'valid_forecasts',
    'scored',
    'invalid',
    'valid_without_actual',
  ]
  if (countFields.some((field) => !nonNegativeInteger(coverage[field]))) {
    return invalid('invalid-report', 'Evaluation coverage counts are malformed.')
  }
  if (typeof coverage.market_window_elapsed !== 'boolean') {
    return invalid('invalid-report', 'Market completion state is missing from coverage.')
  }
  if (coverage.valid_forecasts + coverage.invalid !== coverage.attempts) {
    return invalid('invalid-report', 'Valid and invalid counts do not equal attempts.')
  }
  if (coverage.scored + coverage.valid_without_actual !== coverage.valid_forecasts) {
    return invalid('invalid-report', 'Scored and unpaired counts do not equal valid forecasts.')
  }
  return Object.freeze({ ok: true, value: coverage })
}

function pointSortTuple(point) {
  return [point.target_ms, point.generated_ms, point.horizon_ms]
}

function tupleAfterOrEqual(current, previous) {
  for (let index = 0; index < current.length; index += 1) {
    if (current[index] > previous[index]) return true
    if (current[index] < previous[index]) return false
  }
  return true
}

function validatePoints(points, coverage, market, modelHorizonMs) {
  if (!Array.isArray(points) || points.length !== coverage.attempts || points.length > MAX_ATTEMPTS) {
    return invalid('invalid-report', 'Evaluation attempts do not match coverage.')
  }

  let previousTuple = null
  let validForecasts = 0
  let invalidAttempts = 0
  let scored = 0
  let validWithoutActual = 0
  const identityKeys = new Set()
  for (const point of points) {
    if (!point || typeof point !== 'object') {
      return invalid('invalid-report', 'An evaluation attempt is malformed.')
    }
    const { generated_ms: generatedMs, target_ms: targetMs, horizon_ms: horizonMs } = point
    if (
      !nonNegativeInteger(generatedMs) ||
      !nonNegativeInteger(targetMs) ||
      !Number.isSafeInteger(horizonMs) ||
      horizonMs <= 0 ||
      horizonMs !== modelHorizonMs ||
      !Number.isSafeInteger(generatedMs + horizonMs) ||
      targetMs !== generatedMs + horizonMs ||
      !targetBelongsToMarket(targetMs, market)
    ) {
      return invalid('invalid-report', 'An evaluation attempt has invalid target timing.')
    }

    if (!nonNegativeInteger(point.matured_ms)) {
      return invalid('invalid-report', 'An evaluation attempt has an invalid maturity timestamp.')
    }
    const tuple = pointSortTuple(point)
    if (previousTuple && !tupleAfterOrEqual(tuple, previousTuple)) {
      return invalid('invalid-report', 'Evaluation attempts are not in target-time order.')
    }
    previousTuple = tuple

    for (const field of [
      'projected_chainlink',
      'actual_chainlink',
      'chainlink_at_forecast',
      'futures_at_forecast',
      'forecast_error',
      'baseline_error',
    ]) {
      if (!finiteDecimalOrNull(point[field])) {
        return invalid('invalid-report', `Evaluation field ${field} is not a finite decimal string or null.`)
      }
    }
    if (!strictIdentity(point)) {
      return invalid('invalid-report', 'An evaluation attempt has a malformed selection identity.')
    }
    identityKeys.add(performanceIdentityKey(point))

    const chainlinkInputResult = validateObservationTriple(point, {
      label: 'forecast-time Chainlink',
      valueField: 'chainlink_at_forecast',
      sourceTimestampField: 'chainlink_at_forecast_source_timestamp_ms',
      receivedTimestampField: 'chainlink_at_forecast_received_ms',
      required: point.valid === true,
      noLaterThanMs: generatedMs,
    })
    if (!chainlinkInputResult.ok) return chainlinkInputResult

    const futuresInputResult = validateObservationTriple(point, {
      label: 'forecast-time futures',
      valueField: 'futures_at_forecast',
      sourceTimestampField: 'futures_at_forecast_source_timestamp_ms',
      receivedTimestampField: 'futures_at_forecast_received_ms',
      required: point.valid === true,
      noLaterThanMs: generatedMs,
    })
    if (!futuresInputResult.ok) return futuresInputResult

    const actualResult = validateObservationTriple(point, {
      label: 'target-time Chainlink',
      valueField: 'actual_chainlink',
      sourceTimestampField: 'actual_chainlink_source_timestamp_ms',
      receivedTimestampField: 'actual_chainlink_received_ms',
      required: false,
      noLaterThanMs: targetMs,
    })
    if (!actualResult.ok) return actualResult

    if (point.valid === true) {
      if (!requiredDecimal(point.projected_chainlink) || !requiredDecimal(point.chainlink_at_forecast)) {
        return invalid('invalid-report', 'A valid evaluation is missing its projected or no-change value.')
      }
      validForecasts += 1
      if (point.actual_chainlink === null) {
        if (point.forecast_error !== null || point.baseline_error !== null) {
          return invalid('invalid-report', 'An unpaired evaluation must not contain scored errors.')
        }
        validWithoutActual += 1
      } else {
        if (!requiredDecimal(point.actual_chainlink) || !requiredDecimal(point.forecast_error) || !requiredDecimal(point.baseline_error)) {
          return invalid('invalid-report', 'A paired evaluation is missing persisted error values.')
        }
        scored += 1
      }
    } else if (point.valid === false) {
      invalidAttempts += 1
    } else {
      return invalid('invalid-report', 'An evaluation attempt has an invalid validity flag.')
    }
  }

  if (
    validForecasts !== coverage.valid_forecasts ||
    invalidAttempts !== coverage.invalid ||
    scored !== coverage.scored ||
    validWithoutActual !== coverage.valid_without_actual
  ) {
    return invalid('invalid-report', 'Evaluation point classifications do not match coverage.')
  }

  return Object.freeze({ ok: true, value: points, identityKeys })
}

function validateMetricGroup(group, fields, { required }) {
  if (!group || typeof group !== 'object') return false
  return fields.every((field) => required ? requiredDecimal(group[field]) : group[field] === null)
}

function rateIsValid(value, { required }) {
  if (!required) return value === null
  const decimal = toDecimalOrNull(value)
  return decimal !== null && decimal.greaterThanOrEqualTo(0) && decimal.lessThanOrEqualTo(1)
}

function validateCohort(raw) {
  if (!raw || typeof raw !== 'object') {
    return invalid('invalid-report', 'A performance cohort is malformed.')
  }
  const selectionIdentity = strictIdentity(raw.selection_identity ?? raw.selectionIdentity)
  const scoredPoints = raw.scored_points
  if (!selectionIdentity || !nonNegativeInteger(scoredPoints)) {
    return invalid('invalid-report', 'A performance cohort has invalid identity or sample size.')
  }

  const hasScores = scoredPoints > 0
  if (!validateMetricGroup(raw.forecast, FORECAST_METRICS, { required: hasScores })) {
    return invalid('invalid-report', 'Forecast aggregate metrics are incomplete.')
  }
  if (!validateMetricGroup(raw.no_change_baseline, BASELINE_METRICS, { required: hasScores })) {
    return invalid('invalid-report', 'No-change aggregate metrics are incomplete.')
  }

  if (hasScores) {
    if (!requiredDecimal(raw.mean_absolute_advantage_usd)) {
      return invalid('invalid-report', 'MAE advantage is missing for a scored cohort.')
    }
    const baselineMae = toDecimalOrNull(raw.no_change_baseline.mean_absolute_error_usd)
    const baselineRmse = toDecimalOrNull(raw.no_change_baseline.root_mean_squared_error_usd)
    if (
      (baselineMae.isZero()
        ? raw.mae_skill_vs_no_change !== null
        : !requiredDecimal(raw.mae_skill_vs_no_change)) ||
      (baselineRmse.isZero()
        ? raw.rmse_skill_vs_no_change !== null
        : !requiredDecimal(raw.rmse_skill_vs_no_change))
    ) {
      return invalid('invalid-report', 'Skill metrics do not match their no-change denominators.')
    }
  } else if (COHORT_TOP_LEVEL_METRICS.some((field) => raw[field] !== null)) {
    return invalid('invalid-report', 'An unscored cohort must have null aggregate metrics.')
  }

  const paired = raw.paired_comparison
  if (!paired || typeof paired !== 'object') {
    return invalid('invalid-report', 'Paired comparison metrics are missing.')
  }
  for (const field of ['wins', 'ties', 'losses']) {
    if (!nonNegativeInteger(paired[field])) {
      return invalid('invalid-report', 'Paired comparison counts are malformed.')
    }
  }
  if (paired.wins + paired.ties + paired.losses !== scoredPoints) {
    return invalid('invalid-report', 'Paired comparison counts do not equal the cohort sample size.')
  }
  for (const field of ['win_rate', 'tie_rate', 'loss_rate']) {
    if (!rateIsValid(paired[field], { required: hasScores })) {
      return invalid('invalid-report', 'Paired comparison rates are malformed.')
    }
  }

  return Object.freeze({
    ok: true,
    value: Object.freeze({
      raw,
      selectionIdentity,
      scoredPoints,
      forecast: raw.forecast,
      noChangeBaseline: raw.no_change_baseline,
      meanAbsoluteAdvantageUsd: raw.mean_absolute_advantage_usd,
      maeSkillVsNoChange: raw.mae_skill_vs_no_change,
      rmseSkillVsNoChange: raw.rmse_skill_vs_no_change,
      pairedComparison: raw.paired_comparison,
    }),
  })
}

function setEquals(left, right) {
  return left.size === right.size && [...left].every((value) => right.has(value))
}

/**
 * Validate the additive performance contract without discarding healthy live
 * or context resources when only reporting data is bad.
 */
export function validateForecastPerformanceReport(
  response,
  { requestedMarketId = null, configuredModelVersion = null } = {},
) {
  if (!response || typeof response !== 'object') {
    return invalid('invalid-report', 'Evaluation reporting response is not an object.')
  }
  if (response.schema_version !== 2) {
    return invalid('invalid-report', 'Unsupported evaluation schema version.')
  }
  if (!nonNegativeInteger(response.server_time_ms)) {
    return invalid('invalid-report', 'Evaluation report timestamp is malformed.')
  }
  if (
    !response.evaluation_semantics ||
    typeof response.evaluation_semantics !== 'object' ||
    response.evaluation_semantics.scored_input_max_future_skew_ms !== 0
  ) {
    return invalid(
      'invalid-report',
      'Evaluation reporting does not guarantee zero future skew for scored inputs.',
    )
  }

  const market = normalizeMarketWindow(response.market)
  if (
    !market ||
    market.durationMs !== MARKET_WINDOW_DURATION_MS ||
    market.marketId === null ||
    market.marketId < 0 ||
    market.marketStartMs < 0 ||
    market.marketEndMs < 0
  ) {
    return invalid('invalid-report', 'Evaluation reporting returned an invalid market window.')
  }
  if (requestedMarketId !== null && market.marketId !== requestedMarketId) {
    return invalid('invalid-report', 'Evaluation reporting returned the wrong market.')
  }

  const modelVersion = response.model?.model_version
  if (typeof configuredModelVersion === 'string' && modelVersion !== configuredModelVersion) {
    return invalid('invalid-report', 'Evaluation reporting returned the wrong model version.')
  }

  if (!response.performance || !Array.isArray(response.performance.cohorts)) {
    return invalid('api-update-required', 'API update required')
  }

  const modelHorizonMs = response.model?.horizon_ms
  if (!Number.isSafeInteger(modelHorizonMs) || modelHorizonMs <= 0) {
    return invalid('invalid-report', 'Evaluation model horizon is malformed.')
  }

  const coverageResult = validateCoverage(response.coverage)
  if (!coverageResult.ok) return coverageResult
  const pointsResult = validatePoints(response.points, response.coverage, market, modelHorizonMs)
  if (!pointsResult.ok) return pointsResult

  const declared = response.model?.selection_identities
  if (!Array.isArray(declared)) {
    return invalid('invalid-report', 'Model selection identities are missing.')
  }
  const declaredKeys = new Set()
  for (const identity of declared) {
    const key = performanceIdentityKey(identity)
    if (!key || declaredKeys.has(key)) {
      return invalid('invalid-report', 'Model selection identities are malformed or duplicated.')
    }
    declaredKeys.add(key)
  }
  if (!setEquals(declaredKeys, pointsResult.identityKeys)) {
    return invalid('invalid-report', 'Evaluation attempts do not match the declared selection identities.')
  }

  const cohorts = []
  const cohortKeys = new Set()
  for (const rawCohort of response.performance.cohorts) {
    const cohortResult = validateCohort(rawCohort)
    if (!cohortResult.ok) return cohortResult
    const key = performanceIdentityKey(cohortResult.value.selectionIdentity)
    if (cohortKeys.has(key)) {
      return invalid('invalid-report', 'Performance cohort identities are duplicated.')
    }
    cohortKeys.add(key)
    cohorts.push(cohortResult.value)
  }

  if (!setEquals(declaredKeys, cohortKeys)) {
    return invalid('invalid-report', 'Performance cohorts do not match the declared selection identities.')
  }
  const scoredTotal = cohorts.reduce((total, cohort) => total + cohort.scoredPoints, 0)
  if (scoredTotal !== response.coverage.scored) {
    return invalid('invalid-report', 'Performance cohort samples do not equal scored coverage.')
  }

  return Object.freeze({
    ok: true,
    code: 'ready',
    value: Object.freeze({
      response,
      market,
      model: response.model,
      coverage: response.coverage,
      points: response.points,
      cohorts: Object.freeze(cohorts),
      evaluationSemantics: response.evaluation_semantics,
      serverTimeMs: response.server_time_ms,
      active: response.coverage.market_window_elapsed === false,
    }),
  })
}

function suppressedTitle(identity) {
  if (identity?.code === 'selection-change') return 'Selection changed during this market'
  if (
    identity?.code === 'current-selection-identity-mismatch' ||
    identity?.code === 'live-selection-unverified' ||
    identity?.code === 'live-selection-identity-invalid'
  ) {
    return 'Configured/live selection mismatch'
  }
  return 'Forecast performance unavailable'
}

/** Select a headline cohort only after complete identity validation. */
export function buildForecastPerformanceModel(response, options = {}) {
  const validation = validateForecastPerformanceReport(response, options)
  if (!validation.ok) {
    return Object.freeze({
      state: validation.code,
      title: validation.code === 'api-update-required' ? 'API update required' : 'Evaluation report invalid',
      message: validation.message,
    })
  }

  const report = validation.value
  const identity = options.identity ?? null
  if (report.cohorts.length > 1 || identity?.code === 'selection-change') {
    return Object.freeze({
      state: 'selection-change',
      title: 'Selection changed during this market',
      message: 'Headline metrics are withheld because more than one exact selection identity was scored.',
      report,
      cohorts: report.cohorts,
    })
  }

  if (identity?.projectionVisible === false) {
    return Object.freeze({
      state: 'suppressed',
      title: suppressedTitle(identity),
      message: identity.reason || 'Selection identity could not be verified.',
      report,
      cohorts: report.cohorts,
    })
  }

  if (report.cohorts.length === 0) {
    return Object.freeze({
      state: report.active ? 'waiting' : 'empty',
      title: report.active
        ? 'Waiting for persisted forecast attempts.'
        : 'No retained forecast performance for this market.',
      message: report.active
        ? 'Performance appears after causally paired targets mature.'
        : 'Actual-price context remains available when retained.',
      report,
      cohorts: report.cohorts,
    })
  }

  if (report.active && identity?.verifiedPrimary !== true) {
    return Object.freeze({
      state: 'suppressed',
      title: 'Configured/live selection mismatch',
      message: 'The active selection identity cannot be verified, so headline performance is withheld.',
      report,
      cohorts: report.cohorts,
    })
  }

  const expectedIdentity = identity?.selectionIdentity ?? null
  const cohort = expectedIdentity
    ? report.cohorts.find((candidate) => sameIdentity(candidate.selectionIdentity, expectedIdentity))
    : report.active
      ? null
      : report.cohorts.find(() => true)

  if (!cohort) {
    return Object.freeze({
      state: 'suppressed',
      title: report.active
        ? 'Configured/live selection mismatch'
        : 'Historical selection identity mismatch',
      message: 'No performance cohort matches the fully validated selection identity.',
      report,
      cohorts: report.cohorts,
    })
  }

  return Object.freeze({
    state: cohort.scoredPoints === 0 ? 'unscored' : 'ready',
    title: cohort.scoredPoints === 0
      ? report.active
        ? 'No causally scored forecasts yet.'
        : 'No causally scored forecasts for this market.'
      : 'Forecast performance',
    report,
    cohort,
    cohorts: report.cohorts,
    identityLabel: identity?.lineLabel ?? 'Configured candidate — historical primary unverified',
  })
}

export function shortPerformanceIdentity(value) {
  const identity = strictIdentity(value)
  if (!identity) return 'Selection identity unavailable'
  return `${identity.fingerprint_sha256.slice(0, 8)}… / artifact ${identity.artifact_sha256.slice(0, 8)}…`
}

export function exactPerformanceIdentity(value) {
  const identity = strictIdentity(value)
  return identity
    ? `${identity.fingerprint_sha256} / ${identity.artifact_sha256}`
    : null
}

export function performanceTone(value, { positive = 'positive', negative = 'negative' } = {}) {
  const decimal = toDecimalOrNull(value)
  if (decimal === null || decimal.isZero()) return ''
  return decimal.isPositive() ? positive : negative
}
