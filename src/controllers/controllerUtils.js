export function marketIdOf(value) {
  const id = value?.marketId ?? value?.market_id ?? value?.id
  const number = typeof id === 'string' && /^\d+$/.test(id) ? Number(id) : id
  return Number.isSafeInteger(number) && number >= 0 ? number : null
}

export function marketFromPayload(payload) {
  const source = payload?.market || payload
  const marketId = marketIdOf(source)
  const marketStartMs = source?.marketStartMs ?? source?.market_start_ms ?? source?.start_ms ?? null
  const marketEndMs = source?.marketEndMs ?? source?.market_end_ms ?? source?.end_ms ?? null

  if (
    marketId === null ||
    !Number.isFinite(marketStartMs) ||
    !Number.isFinite(marketEndMs) ||
    marketEndMs <= marketStartMs
  ) {
    return null
  }

  return {
    ...source,
    marketId,
    marketStartMs,
    marketEndMs,
  }
}

export function marketsFromPayload(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : payload?.markets ?? payload?.items ?? payload?.data ?? []

  if (!Array.isArray(rows)) return []

  return rows
    .map(marketFromPayload)
    .filter(Boolean)
    .sort((left, right) => right.marketStartMs - left.marketStartMs)
}

export function serverTimeOf(payload) {
  const value = payload?.server_time_ms ?? payload?.serverTimeMs
  return Number.isFinite(value) ? value : null
}

export function isAbortError(error) {
  return error?.name === 'AbortError'
}
