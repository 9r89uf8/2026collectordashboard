export const MARKET_WINDOW_DURATION_MS = 5 * 60 * 1_000;
export const HALF_OPEN_BOUNDARY = "[start_ms,end_ms)";

function safeInteger(value) {
  return Number.isSafeInteger(value) ? value : null;
}

function marketSource(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value.market && typeof value.market === "object" ? value.market : value;
}

/**
 * Converts either API snake_case fields or application camelCase fields into a
 * single, validated market-window value. Invalid windows return null so callers
 * fail closed instead of accidentally plotting against an unbounded axis.
 */
export function normalizeMarketWindow(value) {
  const source = marketSource(value);
  if (!source) {
    return null;
  }

  const marketStartMs = safeInteger(source.marketStartMs ?? source.market_start_ms);
  const marketEndMs = safeInteger(source.marketEndMs ?? source.market_end_ms);
  if (
    marketStartMs === null ||
    marketEndMs === null ||
    marketEndMs <= marketStartMs
  ) {
    return null;
  }

  const rawMarketId = source.marketId ?? source.market_id ?? null;
  const marketId = rawMarketId === null ? null : safeInteger(rawMarketId);
  if (rawMarketId !== null && marketId === null) {
    return null;
  }

  return Object.freeze({
    marketId,
    marketStartMs,
    marketEndMs,
    durationMs: marketEndMs - marketStartMs,
    boundary: HALF_OPEN_BOUNDARY,
    reportedBoundary: source.boundary ?? null,
    // These aliases make the normalized value convenient at API boundaries.
    market_id: marketId,
    market_start_ms: marketStartMs,
    market_end_ms: marketEndMs,
  });
}

export function isMarketWindow(value) {
  return normalizeMarketWindow(value) !== null;
}

export function isFiveMinuteMarketWindow(value) {
  const market = normalizeMarketWindow(value);
  return market?.durationMs === MARKET_WINDOW_DURATION_MS;
}

/**
 * The dashboard's temporal selection rule. In particular, market_end_ms is
 * deliberately excluded and belongs to the following market.
 */
export function targetBelongsToMarket(targetOrPoint, marketValue) {
  const market = normalizeMarketWindow(marketValue);
  const rawTarget =
    targetOrPoint && typeof targetOrPoint === "object"
      ? targetOrPoint.targetMs ?? targetOrPoint.target_ms
      : targetOrPoint;
  const targetMs = safeInteger(rawTarget);

  return (
    market !== null &&
    targetMs !== null &&
    targetMs >= market.marketStartMs &&
    targetMs < market.marketEndMs
  );
}

export const targetIsInMarket = targetBelongsToMarket;

/**
 * Evaluation rows already carry their authoritative target. Never substitute
 * generated_ms here: doing so shifts a forecast to the time it was created.
 */
export function evaluationTargetMs(point) {
  if (!point || typeof point !== "object") {
    return null;
  }

  return safeInteger(point.targetMs ?? point.target_ms);
}

/** Live signals do not carry a persisted target, so their ghost target is derived. */
export function liveForecastTargetMs(signal) {
  if (!signal || typeof signal !== "object") {
    return null;
  }

  const generatedMs = safeInteger(signal.generatedMs ?? signal.generated_ms);
  const horizonMs = safeInteger(signal.horizonMs ?? signal.horizon_ms);
  if (generatedMs === null || horizonMs === null || horizonMs <= 0) {
    return null;
  }

  const targetMs = generatedMs + horizonMs;
  return Number.isSafeInteger(targetMs) ? targetMs : null;
}

export function elapsedInMarketMs(timestampMs, marketValue, { clamp = false } = {}) {
  const market = normalizeMarketWindow(marketValue);
  const time = safeInteger(timestampMs);
  if (!market || time === null) {
    return null;
  }

  const elapsed = time - market.marketStartMs;
  if (!clamp) {
    return elapsed;
  }

  return Math.min(Math.max(elapsed, 0), market.durationMs);
}

export function formatElapsedTime(timestampMs, marketValue) {
  const elapsed = elapsedInMarketMs(timestampMs, marketValue, { clamp: true });
  if (elapsed === null) {
    return "--:--";
  }

  const totalSeconds = Math.floor(elapsed / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function sameMarketWindow(left, right) {
  const leftMarket = normalizeMarketWindow(left);
  const rightMarket = normalizeMarketWindow(right);
  if (!leftMarket || !rightMarket) {
    return false;
  }

  return (
    leftMarket.marketId === rightMarket.marketId &&
    leftMarket.marketStartMs === rightMarket.marketStartMs &&
    leftMarket.marketEndMs === rightMarket.marketEndMs
  );
}
