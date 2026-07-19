import http from 'node:http'

const port = Number(process.argv[2] || 9000)
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new TypeError('Mock API port must be an integer from 1 to 65535')
}
const modelVersion = 'catchup_ratio_l3000_b100'
const fingerprint = '2e403435a541b7fd7e431dc38ebeee62f88743c63ce8043088361fe7ac61b749'
const artifact = '890a08366d45cb33978f1c382f2030b62a50281a3606a4caa7ddfac3e1570699'
const currentStart = 1_783_989_000_000
const initialServerTime = currentStart + 142_000
const wallStartMs = Date.now()

function currentServerTime() {
  return Math.min(
    currentStart + 300_000 - 1,
    initialServerTime + (Date.now() - wallStartMs),
  )
}

function market(marketId, marketStartMs) {
  return {
    market_id: marketId,
    market_start_ms: marketStartMs,
    market_end_ms: marketStartMs + 300_000,
    boundary: '[start_ms,end_ms)',
  }
}

const markets = [
  market(5_946_630, currentStart),
  market(5_946_629, currentStart - 300_000),
  market(5_946_627, currentStart - 600_000),
]

function priceAt(index, phase = 0) {
  return 64_080 + Math.sin((index + phase) / 19) * 13 + index * 0.018
}

function contextPayload(selected) {
  const serverTime = currentServerTime()
  const points = []
  const pointLimit = selected.market_id === markets[0].market_id
    ? Math.min(300, Math.floor((serverTime - selected.market_start_ms) / 1000) + 1)
    : 300
  for (let index = 0; index < pointLimit; index += 1) {
    if (index === 88 || index === 89) continue
    points.push({
      timestamp_ms: selected.market_start_ms + index * 1000,
      chainlink: priceAt(index * 2, selected.market_id % 7).toFixed(2),
    })
  }
  return {
    server_time_ms: serverTime,
    market: {
      ...selected,
      chainlink_resolution: { open: '64080.00' },
    },
    points,
  }
}

function performanceFor(points) {
  const scored = points.filter((point) => (
    point.valid === true &&
    point.actual_chainlink !== null &&
    point.forecast_error !== null &&
    point.baseline_error !== null
  ))
  if (scored.length === 0) return { cohorts: [] }

  const forecastErrors = scored.map((point) => Number(point.forecast_error))
  const baselineErrors = scored.map((point) => Number(point.baseline_error))
  const absoluteForecastByPoint = forecastErrors.map(Math.abs)
  const absoluteForecast = [...absoluteForecastByPoint].sort((left, right) => left - right)
  const absoluteBaseline = baselineErrors.map(Math.abs)
  const mean = (values) => values.reduce((total, value) => total + value, 0) / values.length
  const rmse = (values) => Math.sqrt(mean(values.map((value) => value ** 2)))
  const median = absoluteForecast.length % 2 === 0
    ? (absoluteForecast[absoluteForecast.length / 2 - 1] + absoluteForecast[absoluteForecast.length / 2]) / 2
    : absoluteForecast[Math.floor(absoluteForecast.length / 2)]
  const p95 = absoluteForecast[Math.ceil(absoluteForecast.length * 0.95) - 1]
  const forecastMae = mean(absoluteForecast)
  const baselineMae = mean(absoluteBaseline)
  const forecastRmse = rmse(forecastErrors)
  const baselineRmse = rmse(baselineErrors)
  let wins = 0
  let ties = 0
  let losses = 0
  absoluteForecastByPoint.forEach((error, index) => {
    if (error < absoluteBaseline[index]) wins += 1
    else if (error > absoluteBaseline[index]) losses += 1
    else ties += 1
  })
  const decimal = (value) => value.toFixed(8)

  return {
    cohorts: [{
      selection_identity: {
        fingerprint_sha256: fingerprint,
        artifact_sha256: artifact,
      },
      scored_points: scored.length,
      forecast: {
        mean_absolute_error_usd: decimal(forecastMae),
        median_absolute_error_usd: decimal(median),
        p95_absolute_error_usd: decimal(p95),
        maximum_absolute_error_usd: decimal(absoluteForecast.at(-1)),
        root_mean_squared_error_usd: decimal(forecastRmse),
        mean_signed_error_usd: decimal(mean(forecastErrors)),
      },
      no_change_baseline: {
        mean_absolute_error_usd: decimal(baselineMae),
        root_mean_squared_error_usd: decimal(baselineRmse),
      },
      mean_absolute_advantage_usd: decimal(baselineMae - forecastMae),
      mae_skill_vs_no_change: baselineMae === 0 ? null : decimal((baselineMae - forecastMae) / baselineMae),
      rmse_skill_vs_no_change: baselineRmse === 0 ? null : decimal((baselineRmse - forecastRmse) / baselineRmse),
      paired_comparison: {
        wins,
        ties,
        losses,
        win_rate: decimal(wins / scored.length),
        tie_rate: decimal(ties / scored.length),
        loss_rate: decimal(losses / scored.length),
      },
    }],
  }
}

function evaluationPayload(selected, live = false) {
  const serverTime = currentServerTime()
  const pointLimit = live
    ? Math.min(600, Math.max(0, Math.floor((serverTime - selected.market_start_ms - 10) / 500) + 1))
    : 600
  const points = []
  let invalid = 0
  let validWithoutActual = 0

  for (let index = 0; index < pointLimit; index += 1) {
    if (index === 95 || index === 96) continue
    const targetMs = selected.market_start_ms + index * 500
    const generatedMs = targetMs - 3000
    const actual = priceAt(index, selected.market_id % 11)
    const baseline = actual - Math.sin(index / 8) * 3.8
    const projected = actual + Math.cos(index / 13) * 1.75
    const futuresAtForecast = actual + 8 + Math.sin(index / 10) * 0.9
    const isInvalid = index > 0 && index % 79 === 0
    const noActual = !isInvalid && index > 0 && index % 113 === 0
    if (isInvalid) invalid += 1
    if (noActual) validWithoutActual += 1

    points.push({
      selection_fingerprint_sha256: fingerprint,
      selection_artifact_sha256: artifact,
      model_version: modelVersion,
      beta: '1',
      generated_ms: generatedMs,
      target_ms: targetMs,
      matured_ms: targetMs + 8,
      horizon_ms: 3000,
      valid: !isInvalid,
      status: isInvalid ? 'invalid' : 'valid',
      invalid_reasons: isInvalid ? ['chainlink_stale'] : [],
      state: 'anchored',
      forecast_market_id: generatedMs < selected.market_start_ms ? selected.market_id - 1 : selected.market_id,
      full_horizon_before_forecast_market_end: generatedMs + 3000 < selected.market_end_ms,
      chainlink_at_forecast: isInvalid ? null : baseline.toFixed(2),
      chainlink_at_forecast_source_timestamp_ms: isInvalid ? null : generatedMs - 120,
      chainlink_at_forecast_received_ms: isInvalid ? null : generatedMs - 45,
      futures_at_forecast: isInvalid ? null : futuresAtForecast.toFixed(2),
      futures_at_forecast_source_timestamp_ms: isInvalid ? null : generatedMs - 85,
      futures_at_forecast_received_ms: isInvalid ? null : generatedMs - 15,
      projected_chainlink: isInvalid ? null : projected.toFixed(2),
      actual_chainlink: isInvalid || noActual ? null : actual.toFixed(2),
      actual_chainlink_source_timestamp_ms: isInvalid || noActual ? null : targetMs - 120,
      actual_chainlink_received_ms: isInvalid || noActual ? null : targetMs - 45,
      actual_chainlink_age_at_target_ms: isInvalid || noActual ? null : 45,
      pending_move: isInvalid ? null : (projected - baseline).toFixed(2),
      pending_move_bps: isInvalid ? null : ((projected - baseline) / baseline * 10_000).toFixed(8),
      direction: isInvalid ? null : projected >= baseline ? 'up' : 'down',
      forecast_error: isInvalid || noActual ? null : (projected - actual).toFixed(2),
      baseline_error: isInvalid || noActual ? null : (baseline - actual).toFixed(2),
    })
  }

  const validForecasts = points.length - invalid
  return {
    schema_version: 2,
    server_time_ms: serverTime,
    evaluation_semantics: {
      scored_input_max_future_skew_ms: 0,
    },
    market: selected,
    model: {
      model_version: modelVersion,
      horizon_ms: 3000,
      beta: '1',
      evaluation_cadence_ms: 500,
      selection_identities: [{ fingerprint_sha256: fingerprint, artifact_sha256: artifact }],
    },
    coverage: {
      window_buckets: 600,
      market_window_elapsed: !live,
      observed_buckets: points.length,
      unobserved_buckets_as_of_response: live ? null : 600 - points.length,
      attempts: points.length,
      valid_forecasts: validForecasts,
      scored: validForecasts - validWithoutActual,
      invalid,
      valid_without_actual: validWithoutActual,
    },
    points,
    performance: performanceFor(points),
  }
}

function send(response, status, value, headers = {}) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...headers,
  })
  response.end(body)
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`)

  if (url.pathname === '/markets/current/live') {
    const serverTime = currentServerTime()
    const futuresIndex = (serverTime - currentStart) / 500
    const futuresValue = (priceAt(futuresIndex, 4) + 8).toFixed(2)
    return send(response, 200, {
      server_time_ms: serverTime,
      ...markets[0],
      prices: {
        chainlink: { value: '64091.82', received_age_ms: 84, source_age_ms: 212 },
      },
      futures: {
        last: {
          value: futuresValue,
          source_timestamp_ms: serverTime - 30,
          time_ms: serverTime - 30,
          received_ms: serverTime - 15,
          source_age_ms: 30,
          received_age_ms: 15,
        },
      },
      signals: {
        chainlink_catchup: {
          model_version: modelVersion,
          generated_ms: serverTime - 400,
          horizon_ms: 3000,
          valid: true,
          status: 'valid',
          invalid_reasons: [],
          chainlink_at_forecast: '64091.82',
          projected_chainlink: '64095.41',
          pending_move: '3.59',
          pending_move_bps: '0.56014315',
          direction: 'up',
          futures_now: (Number(futuresValue) + 25).toFixed(2),
          futures_reference: (Number(futuresValue) + 24.5).toFixed(2),
          age_ms: 84,
          full_horizon_before_forecast_market_end: true,
          selection_fingerprint_sha256: fingerprint,
          selection_artifact_sha256: artifact,
          market: markets[0],
        },
      },
    })
  }

  if (url.pathname === '/markets') {
    const includeCurrent = url.searchParams.get('include_current') === 'true'
    return send(response, 200, {
      server_time_ms: currentServerTime(),
      markets: includeCurrent ? markets : markets.slice(1),
    })
  }

  const match = url.pathname.match(
    /^\/markets\/(\d+)\/(data|sources|shadow-evaluations(?:\/download)?)$/,
  )
  if (!match) return send(response, 404, { detail: 'Not found' })
  const selected = markets.find((item) => item.market_id === Number(match[1]))
  if (!selected) return send(response, 404, { detail: 'Unknown market' })

  if (match[2] === 'data') return send(response, 200, contextPayload(selected))
  if (match[2] === 'sources') {
    return send(response, 200, {
      server_time_ms: currentServerTime(),
      market: selected,
      sources: [{ provider: 'polymarket_chainlink_rtds', open: '64079.92' }],
    })
  }

  const requestedModelVersion = url.searchParams.get('model_version')
  if (requestedModelVersion !== modelVersion) {
    return send(response, 422, { detail: 'Unsupported or missing model_version' })
  }
  const report = evaluationPayload(selected, selected.market_id === markets[0].market_id)
  if (match[2] === 'shadow-evaluations/download') {
    const filename = `btc_5m_market_${selected.market_id}_shadow_evaluations_${modelVersion}.json`
    return send(response, 200, report, {
      'content-disposition': `attachment; filename="${filename}"`,
    })
  }
  return send(response, 200, report)
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Mock API listening on http://127.0.0.1:${port}\n`)
})

function close() {
  server.close(() => process.exit(0))
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
