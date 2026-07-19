import { apiUrl, requestJson } from "./client.js";

function marketSegment(marketId) {
  const normalized = typeof marketId === "number"
    ? Number.isSafeInteger(marketId) && marketId >= 0
      ? String(marketId)
      : null
    : typeof marketId === "string"
      ? marketId.trim()
      : null;

  if (
    !normalized ||
    !/^\d+$/.test(normalized) ||
    !Number.isSafeInteger(Number(normalized))
  ) {
    throw new TypeError("marketId must be a non-negative integer");
  }

  return encodeURIComponent(normalized);
}

function modelQuery(modelVersion) {
  if (typeof modelVersion !== "string" || modelVersion.trim() === "") {
    throw new TypeError("modelVersion must be a non-empty string");
  }

  return new URLSearchParams({ model_version: modelVersion });
}

function evaluationArguments(modelVersionOrOptions, suppliedOptions) {
  if (
    modelVersionOrOptions &&
    typeof modelVersionOrOptions === "object" &&
    !Array.isArray(modelVersionOrOptions)
  ) {
    const { modelVersion, ...options } = modelVersionOrOptions;
    return { modelVersion, options };
  }

  return {
    modelVersion: modelVersionOrOptions,
    options: suppliedOptions,
  };
}

export function fetchShadowEvaluations(
  marketId,
  modelVersionOrOptions,
  suppliedOptions = {},
) {
  const { modelVersion, options } = evaluationArguments(
    modelVersionOrOptions,
    suppliedOptions,
  );
  const query = modelQuery(modelVersion);
  return requestJson(
    `/markets/${marketSegment(marketId)}/shadow-evaluations?${query}`,
    options,
  );
}

export function fetchCurrentShadowEvaluations(
  modelVersionOrOptions,
  suppliedOptions = {},
) {
  const { modelVersion, options } = evaluationArguments(
    modelVersionOrOptions,
    suppliedOptions,
  );
  const query = modelQuery(modelVersion);
  return requestJson(`/markets/current/shadow-evaluations?${query}`, {
    ...options,
    live: true,
  });
}

/**
 * Build the same-origin URL for downloading one market's persisted report.
 * Downloads are deliberately ID-addressed; callers must not substitute the
 * moving `/current` route.
 */
export function shadowEvaluationsDownloadUrl(marketId, modelVersion) {
  const query = modelQuery(modelVersion);
  return apiUrl(
    `/markets/${marketSegment(marketId)}/shadow-evaluations/download?${query}`,
  );
}

export const getShadowEvaluations = fetchShadowEvaluations;
export const fetchEvaluations = fetchShadowEvaluations;
export const getEvaluations = fetchShadowEvaluations;
export const getCurrentShadowEvaluations = fetchCurrentShadowEvaluations;
