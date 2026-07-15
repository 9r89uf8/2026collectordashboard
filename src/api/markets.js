import { requestJson } from "./client.js";

function marketSegment(marketId) {
  const normalized =
    typeof marketId === "number" ? String(marketId) : marketId?.trim();

  if (!normalized || !/^\d+$/.test(normalized)) {
    throw new TypeError("marketId must be a non-negative integer");
  }

  return encodeURIComponent(normalized);
}

function splitRequestOptions(options, omittedKeys) {
  return Object.fromEntries(
    Object.entries(options).filter(([key]) => !omittedKeys.includes(key)),
  );
}

export function fetchMarkets(options = {}) {
  const { limit = 10, includeCurrent = true } = options;

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new TypeError("limit must be a positive integer");
  }
  if (typeof includeCurrent !== "boolean") {
    throw new TypeError("includeCurrent must be a boolean");
  }

  const query = new URLSearchParams({
    limit: String(limit),
    include_current: String(includeCurrent),
  });
  const requestOptions = splitRequestOptions(options, [
    "limit",
    "includeCurrent",
  ]);

  return requestJson(`/markets?${query}`, {
    // Discovery that includes the clock-derived current market is live data.
    // A caller can still provide an explicit cache mode when needed.
    live: includeCurrent,
    ...requestOptions,
  });
}

export function fetchMarketData(marketId, options = {}) {
  const { fillDisplay, ...requestOptions } = options;
  const query = new URLSearchParams();

  if (fillDisplay !== undefined) {
    if (typeof fillDisplay !== "boolean") {
      throw new TypeError("fillDisplay must be a boolean");
    }
    query.set("fill_display", String(fillDisplay));
  }

  const suffix = query.size > 0 ? `?${query}` : "";
  return requestJson(
    `/markets/${marketSegment(marketId)}/data${suffix}`,
    requestOptions,
  );
}

export function fetchMarketSources(marketId, options = {}) {
  return requestJson(
    `/markets/${marketSegment(marketId)}/sources`,
    options,
  );
}

export function fetchCurrentMarketData(options = {}) {
  return requestJson("/markets/current/data", { ...options, live: true });
}

export function fetchCurrentMarketSources(options = {}) {
  return requestJson("/markets/current/sources", { ...options, live: true });
}

export function fetchCurrentLive(options = {}) {
  return requestJson("/markets/current/live", { ...options, live: true });
}

export const getMarkets = fetchMarkets;
export const getMarketData = fetchMarketData;
export const getMarketSources = fetchMarketSources;
export const getCurrentMarketData = fetchCurrentMarketData;
export const getCurrentMarketSources = fetchCurrentMarketSources;
export const getCurrentLive = fetchCurrentLive;
export const fetchLive = fetchCurrentLive;
export const getLive = fetchCurrentLive;
