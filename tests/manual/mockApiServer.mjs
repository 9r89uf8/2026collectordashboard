import http from 'node:http'

const port = 9000
const modelVersion = 'catchup_ratio_l3000_b100'
const fingerprint = '2e403435a541b7fd7e431dc38ebeee62f88743c63ce8043088361fe7ac61b749'
const artifact = '890a08366d45cb33978f1c382f2030b62a50281a3606a4caa7ddfac3e1570699'
const currentStart = 1_783_989_000_000
const serverTime = currentStart + 142_000

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
  const points = []
  const pointLimit = selected.market_id === markets[0].market_id
    ? Math.floor((serverTime - selected.market_start_ms) / 1000) + 1
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

function evaluationPayload(selected, live = false) {
  const pointLimit = live ? 280 : 600
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
    schema_version: 1,
    server_time_ms: serverTime,
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
  }
}

function send(response, status, value) {
  const body = JSON.stringify(value)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  response.end(body)
}

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`)

  if (url.pathname === '/markets/current/live') {
    return send(response, 200, {
      server_time_ms: serverTime,
      ...markets[0],
      prices: {
        chainlink: { value: '64091.82', received_age_ms: 84, source_age_ms: 212 },
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
      server_time_ms: serverTime,
      markets: includeCurrent ? markets : markets.slice(1),
    })
  }

  const match = url.pathname.match(/^\/markets\/(\d+)\/(data|sources|shadow-evaluations)$/)
  if (!match) return send(response, 404, { detail: 'Not found' })
  const selected = markets.find((item) => item.market_id === Number(match[1]))
  if (!selected) return send(response, 404, { detail: 'Unknown market' })

  if (match[2] === 'data') return send(response, 200, contextPayload(selected))
  if (match[2] === 'sources') {
    return send(response, 200, {
      server_time_ms: serverTime,
      market: selected,
      sources: [{ provider: 'polymarket_chainlink_rtds', open: '64079.92' }],
    })
  }
  return send(response, 200, evaluationPayload(selected, selected.market_id === markets[0].market_id))
})

server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`Mock API listening on http://127.0.0.1:${port}\n`)
})

function close() {
  server.close(() => process.exit(0))
}

process.on('SIGINT', close)
process.on('SIGTERM', close)
