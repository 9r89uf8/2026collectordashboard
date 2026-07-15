import Decimal from 'decimal.js'

function decimal(value) {
  if (value === null || value === undefined || value === '') return null
  try {
    return new Decimal(value)
  } catch {
    return null
  }
}

export function formatMoney(value, { signed = false, maximumDecimals = 2 } = {}) {
  const amount = decimal(value)
  if (!amount) return '—'

  const absolute = amount.abs().toDecimalPlaces(maximumDecimals).toFixed(maximumDecimals)
  const [whole, fraction] = absolute.split('.')
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  const sign = amount.isNegative() ? '−' : signed && !amount.isZero() ? '+' : ''
  return `${sign}$${grouped}${fraction ? `.${fraction}` : ''}`
}

export function formatDecimalValue(value, decimals = 2, suffix = '') {
  const amount = decimal(value)
  if (!amount) return '—'
  return `${amount.toDecimalPlaces(decimals).toFixed(decimals)}${suffix}`
}

export function formatSignedDecimal(value, decimals = 2, suffix = '') {
  const amount = decimal(value)
  if (!amount) return '—'
  const sign = amount.isNegative() ? '−' : amount.isZero() ? '' : '+'
  return `${sign}${amount.abs().toDecimalPlaces(decimals).toFixed(decimals)}${suffix}`
}

export function formatUtcTimestamp(ms) {
  if (!Number.isFinite(ms)) return '—'
  const date = new Date(ms)
  const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0')
  return `${date.toLocaleTimeString('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })}.${milliseconds} UTC`
}

function chainlinkPrice(live) {
  return live?.prices?.chainlink || live?.chainlink || null
}

function signalAge(signal, live) {
  return signal?.age_ms ?? signal?.signal_age_ms ?? live?.signals?.chainlink_catchup_age_ms ?? null
}

function ageLabel(value) {
  return Number.isFinite(value) ? `${Math.round(value)} ms` : 'Unavailable'
}

export function liveActualFreshness(live, config) {
  const price = chainlinkPrice(live)
  const value = price?.value ?? null
  const receivedAge = price?.received_age_ms ?? price?.receivedAgeMs ?? null
  const sourceAge = price?.source_age_ms ?? price?.sourceAgeMs ?? null

  if (value === null) {
    return { state: 'missing', label: 'Unavailable', value, receivedAge, sourceAge }
  }

  const stale =
    !Number.isFinite(receivedAge) ||
    !Number.isFinite(sourceAge) ||
    receivedAge > config.chainlinkReceivedStaleMs ||
    sourceAge > config.chainlinkSourceStaleMs

  return {
    state: stale ? 'stale' : 'live',
    label: stale ? 'Stale' : 'Live',
    value,
    receivedAge,
    sourceAge,
  }
}

export function createLiveSignalViewModel({ live, config, identity } = {}) {
  const signal = live?.signals?.chainlink_catchup ?? null
  const actual = liveActualFreshness(live, config)
  const actualTone = actual.state === 'live' ? 'positive' : actual.state === 'stale' ? 'warning' : 'muted'
  const actualTitle = `Receive age: ${ageLabel(actual.receivedAge)}; provider source age: ${ageLabel(actual.sourceAge)}. Freshness limits: ${config.chainlinkReceivedStaleMs} ms / ${config.chainlinkSourceStaleMs} ms.`
  const actualMetric = {
    label: 'Live actual Chainlink',
    value: actual.value === null ? 'Unavailable' : formatMoney(actual.value),
    tone: actualTone,
    title: actualTitle,
  }

  if (identity && identity.projectionVisible === false) {
    return {
      state: 'invalid',
      stateLabel: 'Hidden',
      heroValue: '—',
      heroCaption: identity.message || identity.reason || 'Projection identity could not be verified.',
      metrics: [actualMetric, { label: 'Actual freshness', value: actual.label, tone: actualTone }],
    }
  }

  if (!signal) {
    return {
      state: actual.state === 'live' ? 'unavailable' : actual.state,
      stateLabel: 'Unavailable',
      heroValue: '—',
      heroCaption: 'Live projection unavailable',
      metrics: [
        actualMetric,
        { label: 'Actual freshness', value: actual.label, tone: actualTone },
        { label: 'Receive / source age', value: `${ageLabel(actual.receivedAge)} / ${ageLabel(actual.sourceAge)}` },
      ],
    }
  }

  if (signal.valid !== true || signal.projected_chainlink == null) {
    const reasons = Array.isArray(signal.invalid_reasons) ? signal.invalid_reasons.join(', ') : ''
    return {
      state: 'invalid',
      stateLabel: 'Invalid',
      heroValue: '—',
      heroCaption: reasons || signal.status || 'The current attempt is invalid.',
      metrics: [
        actualMetric,
        { label: 'Attempt status', value: signal.status || 'invalid', tone: 'warning' },
        { label: 'Signal freshness', value: ageLabel(signalAge(signal, live)) },
      ],
    }
  }

  const horizonMs = signal.horizon_ms ?? 3000
  const direction = String(signal.direction || 'flat').toUpperCase()

  return {
    state: 'live',
    stateLabel: 'Live shadow',
    heroLabel: `Projected Chainlink (+${formatDecimalValue(new Decimal(horizonMs).div(1000), 1, 's')})`,
    heroValue: formatMoney(signal.projected_chainlink),
    heroCaption: `Target ${formatUtcTimestamp(signal.generated_ms + horizonMs)}`,
    dimmed: actual.state === 'stale',
    metrics: [
      actualMetric,
      { label: 'Chainlink at signal', value: formatMoney(signal.chainlink_at_forecast) },
      { label: 'Pending catch-up', value: formatMoney(signal.pending_move, { signed: true }), tone: signal.direction === 'down' ? 'negative' : 'positive' },
      { label: 'Pending catch-up (bps)', value: formatSignedDecimal(signal.pending_move_bps, 2, ' bps') },
      { label: 'Catch-up direction', value: direction, tone: signal.direction === 'down' ? 'negative' : 'positive' },
      { label: 'Signal freshness', value: ageLabel(signalAge(signal, live)) },
      { label: 'Full horizon in generation market', value: signal.full_horizon_before_forecast_market_end === false ? 'NO' : 'YES' },
    ],
  }
}

export function createRecentSignalViewModel(points = []) {
  const latest = [...points].reverse().find((point) => point.scored || (
    point.projectedDecimal != null && point.actualDecimal != null
  ))

  if (!latest) {
    return {
      kicker: 'Selected evidence',
      title: 'Latest scored endpoint',
      state: 'unavailable',
      stateLabel: 'No score',
      heroValue: '—',
      heroCaption: 'No paired forecast outcome is retained in this window.',
      metrics: [],
    }
  }

  const raw = latest.raw || latest.source || latest
  const forecastError = latest.forecastErrorDecimal ?? raw.forecast_error
  const baselineError = latest.baselineErrorDecimal ?? raw.baseline_error
  return {
    kicker: 'Selected evidence',
    title: 'Latest scored endpoint',
    state: 'complete',
    stateLabel: 'Scored',
    heroLabel: 'Projected Chainlink',
    heroValue: formatMoney(latest.projectedDecimal ?? raw.projected_chainlink),
    heroCaption: `Target ${formatUtcTimestamp(latest.targetMs ?? raw.target_ms)}`,
    metrics: [
      { label: 'Actual at target', value: formatMoney(latest.actualDecimal ?? raw.actual_chainlink) },
      { label: 'Forecast error', value: formatMoney(forecastError, { signed: true }) },
      { label: 'Absolute error', value: formatMoney(latest.absoluteErrorDecimal ?? decimal(forecastError)?.abs()) },
      { label: 'No-change error', value: formatMoney(baselineError, { signed: true }) },
      { label: 'Generated', value: `${formatDecimalValue(new Decimal(latest.horizonMs ?? raw.horizon_ms ?? 3000).div(1000), 1, 's')} earlier` },
    ],
  }
}

export function createPointTableRows(points = []) {
  return points
    .filter((point) => point.scored || (point.projectedDecimal != null && point.actualDecimal != null))
    .map((point) => {
      const raw = point.raw || point.source || point
      const forecastError = point.forecastErrorDecimal ?? raw.forecast_error
      const error = decimal(forecastError)
      return {
        targetLabel: formatUtcTimestamp(point.targetMs ?? raw.target_ms),
        projectedLabel: formatMoney(point.projectedDecimal ?? raw.projected_chainlink),
        actualLabel: formatMoney(point.actualDecimal ?? raw.actual_chainlink),
        errorLabel: formatMoney(forecastError, { signed: true }),
        errorTone: error?.isZero() ? '' : error?.isNegative() ? 'negative' : 'positive',
        statusLabel: raw.status || 'valid',
      }
    })
}

export function shortIdentity(identity) {
  if (!identity) return 'Selection identity pending'
  const fingerprint = identity.fingerprint_sha256 || identity.fingerprintSha256
  const artifact = identity.artifact_sha256 || identity.artifactSha256
  if (!fingerprint || !artifact) return 'Selection identity pending'
  return `${fingerprint.slice(0, 8)}… / ${artifact.slice(0, 8)}…`
}
