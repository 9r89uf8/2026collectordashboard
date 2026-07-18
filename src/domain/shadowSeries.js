import {
  absoluteDecimalString,
  decimalDifferenceString,
  decimalEquals,
  decimalStringOrNull,
  financialChartNumber,
} from "./decimalFormat.js";
import {
  evaluationTargetMs,
  liveForecastTargetMs,
  normalizeMarketWindow,
  targetBelongsToMarket,
} from "./marketWindow.js";

export const VERIFIED_PRIMARY_LABEL = "Frozen accepted primary";
export const HISTORICAL_UNVERIFIED_LABEL =
  "Configured candidate — historical primary unverified";
export const UNOBSERVED_BUCKET_REASON = "unobserved-retained-bucket";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

function safeInteger(value) {
  return Number.isSafeInteger(value) ? value : null;
}

function positiveInteger(value) {
  const integer = safeInteger(value);
  return integer !== null && integer > 0 ? integer : null;
}

function asResponse(value) {
  if (Array.isArray(value)) {
    return { points: value, model: {}, market: null };
  }
  return value && typeof value === "object" ? value : { points: [], model: {}, market: null };
}

export function extractLiveSignal(livePayloadOrSignal) {
  if (!livePayloadOrSignal || typeof livePayloadOrSignal !== "object") {
    return null;
  }

  if (livePayloadOrSignal.signals && typeof livePayloadOrSignal.signals === "object") {
    return livePayloadOrSignal.signals.chainlink_catchup ?? null;
  }

  return livePayloadOrSignal;
}

function sha256OrNull(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value) ? value.toLowerCase() : null;
}

export function normalizeSelectionIdentity(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const source = value.selectionIdentity ?? value.selection_identity ?? value;
  const fingerprintSha256 = sha256OrNull(
    source.fingerprintSha256 ??
      source.fingerprint_sha256 ??
      source.selectionFingerprintSha256 ??
      source.selection_fingerprint_sha256,
  );
  const artifactSha256 = sha256OrNull(
    source.artifactSha256 ??
      source.artifact_sha256 ??
      source.selectionArtifactSha256 ??
      source.selection_artifact_sha256,
  );

  if (!fingerprintSha256 || !artifactSha256) {
    return null;
  }

  return Object.freeze({
    fingerprintSha256,
    artifactSha256,
    fingerprint_sha256: fingerprintSha256,
    artifact_sha256: artifactSha256,
  });
}

export function selectionIdentityKey(value) {
  const identity = normalizeSelectionIdentity(value);
  return identity ? `${identity.fingerprintSha256}:${identity.artifactSha256}` : null;
}

function identitiesEqual(left, right) {
  const leftKey = selectionIdentityKey(left);
  return leftKey !== null && leftKey === selectionIdentityKey(right);
}

function identityResult({
  projectionVisible,
  code,
  reason,
  banner = null,
  lineLabel = HISTORICAL_UNVERIFIED_LABEL,
  verifiedPrimary = false,
  configuredModelVersion = null,
  modelVersion = null,
  selectionIdentity = null,
  liveIdentity = null,
}) {
  return Object.freeze({
    projectionVisible,
    code,
    reason,
    banner,
    lineLabel,
    verifiedPrimary,
    configuredModelVersion,
    modelVersion,
    selectionIdentity,
    liveIdentity,
  });
}

function hiddenIdentity(code, reason, values = {}) {
  return identityResult({
    projectionVisible: false,
    code,
    reason,
    banner: reason,
    ...values,
  });
}

function responseSelectionIdentity(response, points) {
  const declared = response.model?.selection_identities;
  if (!Array.isArray(declared)) {
    return { error: "Selection identity metadata is missing." };
  }
  if (declared.length !== 1) {
    return {
      error:
        declared.length > 1
          ? "Selection identity changed within this market. Projections are hidden."
          : "Selection identity metadata is missing. Projections are hidden.",
      multiple: declared.length > 1,
    };
  }

  const declaredIdentity = normalizeSelectionIdentity(declared[0]);
  if (!declaredIdentity) {
    return { error: "Selection identity metadata is malformed. Projections are hidden." };
  }

  const pointIdentities = new Map();
  for (const point of points) {
    const pointIdentity = normalizeSelectionIdentity(point);
    const key = selectionIdentityKey(pointIdentity);
    if (!pointIdentity || !key) {
      return { error: "An evaluation has a missing or malformed selection identity." };
    }
    pointIdentities.set(key, pointIdentity);
  }

  if (pointIdentities.size > 1) {
    return {
      error: "Selection identity changed within this market. Projections are hidden.",
      multiple: true,
    };
  }

  if (pointIdentities.size === 1 && !identitiesEqual(declaredIdentity, pointIdentities.values().next().value)) {
    return { error: "Evaluation identity does not match the response model identity." };
  }

  return { identity: declaredIdentity };
}

function modelsAreInternallyConsistent(response, points, responseModelVersion) {
  const horizonMs = positiveInteger(response.model?.horizon_ms ?? response.model?.horizonMs);
  const beta = decimalStringOrNull(response.model?.beta);

  if (points.length > 0 && (horizonMs === null || beta === null)) {
    return false;
  }

  return points.every((point) => {
    const pointModel = point.model_version ?? point.modelVersion;
    const pointHorizon = positiveInteger(point.horizon_ms ?? point.horizonMs);
    const pointBeta = decimalStringOrNull(point.beta);
    return (
      pointModel === responseModelVersion &&
      pointHorizon === horizonMs &&
      pointBeta !== null &&
      decimalEquals(pointBeta, beta)
    );
  });
}

/**
 * Validate model and frozen-selection identity before exposing projections.
 * Historical data with one coherent identity may be shown as the configured
 * candidate, but it is called the accepted primary only after matching live
 * evidence. Current-window mismatches fail closed to actual-only context.
 */
export function validateProjectionIdentity(evaluationValue, options = {}) {
  let responseValue = evaluationValue;
  let settings = options;
  if (evaluationValue?.evaluationResponse || evaluationValue?.evaluation) {
    responseValue = evaluationValue.evaluationResponse ?? evaluationValue.evaluation;
    settings = evaluationValue;
  }

  const response = asResponse(responseValue);
  const points = Array.isArray(response.points) ? response.points : [];
  const configuredModelVersion =
    settings.configuredModelVersion ?? settings.primaryModelVersion ?? null;
  const responseModelVersion = response.model?.model_version ?? response.model?.modelVersion ?? null;
  const shared = { configuredModelVersion, modelVersion: responseModelVersion };

  if (typeof configuredModelVersion !== "string" || configuredModelVersion.length === 0) {
    return hiddenIdentity(
      "configuration-missing",
      "Primary model configuration is missing. Projections are hidden.",
      shared,
    );
  }

  if (responseModelVersion !== configuredModelVersion) {
    return hiddenIdentity(
      "configured-model-mismatch",
      `Configured model ${configuredModelVersion} does not match evaluation model ${responseModelVersion ?? "(missing)"}. Projections are hidden.`,
      shared,
    );
  }

  if (!modelsAreInternallyConsistent(response, points, responseModelVersion)) {
    return hiddenIdentity(
      "model-metadata-mismatch",
      "Evaluation model, horizon, or beta metadata is inconsistent. Projections are hidden.",
      shared,
    );
  }

  // An empty retained response legitimately has no selection identities.
  if (points.length === 0) {
    const liveSignal = extractLiveSignal(settings.liveSignal ?? settings.livePayload);
    if (liveSignal && (liveSignal.model_version ?? liveSignal.modelVersion) !== configuredModelVersion) {
      return hiddenIdentity(
        "configured-live-model-mismatch",
        `Configured model ${configuredModelVersion} does not match live model ${liveSignal.model_version ?? liveSignal.modelVersion ?? "(missing)"}. Projections are hidden.`,
        shared,
      );
    }
    return identityResult({
      projectionVisible: true,
      code: "no-history",
      reason: "No retained evaluation points are available.",
      configuredModelVersion,
      modelVersion: responseModelVersion,
    });
  }

  const responseIdentityResult = responseSelectionIdentity(response, points);
  if (responseIdentityResult.error) {
    return hiddenIdentity(
      responseIdentityResult.multiple ? "selection-change" : "selection-identity-invalid",
      responseIdentityResult.error,
      shared,
    );
  }

  const selectionIdentity = responseIdentityResult.identity;
  const liveSignal = extractLiveSignal(settings.liveSignal ?? settings.livePayload);
  if (!liveSignal) {
    const isCurrentMarket =
      settings.isCurrentMarket ??
      (typeof settings.mode === "string" ? settings.mode === "live" : false);
    if (isCurrentMarket) {
      return hiddenIdentity(
        "live-selection-unverified",
        "The active selection identity cannot be verified. Projections are hidden.",
        { ...shared, selectionIdentity },
      );
    }
    return identityResult({
      projectionVisible: true,
      code: "historical-primary-unverified",
      reason: "The configured candidate has no matching live selection evidence.",
      configuredModelVersion,
      modelVersion: responseModelVersion,
      selectionIdentity,
    });
  }

  const liveModelVersion = liveSignal.model_version ?? liveSignal.modelVersion ?? null;
  if (liveModelVersion !== configuredModelVersion) {
    return hiddenIdentity(
      "configured-live-model-mismatch",
      `Configured model ${configuredModelVersion} does not match live model ${liveModelVersion ?? "(missing)"}. Projections are hidden.`,
      { ...shared, selectionIdentity },
    );
  }

  const liveIdentity = normalizeSelectionIdentity(liveSignal);
  if (!liveIdentity) {
    return hiddenIdentity(
      "live-selection-identity-invalid",
      "The live signal selection identity is missing or malformed. Projections are hidden.",
      { ...shared, selectionIdentity },
    );
  }

  if (!identitiesEqual(selectionIdentity, liveIdentity)) {
    const responseMarket = normalizeMarketWindow(response.market);
    const liveMarket = normalizeMarketWindow(settings.livePayload);
    const inferredCurrent = Boolean(
      responseMarket &&
        liveMarket &&
        responseMarket.marketId !== null &&
        liveMarket.marketId !== null &&
        responseMarket.marketId === liveMarket.marketId,
    );
    const isCurrentMarket =
      settings.isCurrentMarket ??
      (typeof settings.mode === "string" ? settings.mode === "live" : inferredCurrent);

    if (isCurrentMarket) {
      return hiddenIdentity(
        "current-selection-identity-mismatch",
        "Live and retained selection identities differ for the current market. Projections are hidden.",
        { ...shared, selectionIdentity, liveIdentity },
      );
    }

    return identityResult({
      projectionVisible: true,
      code: "historical-primary-unverified",
      reason: "This historical identity differs from the currently verified live identity.",
      configuredModelVersion,
      modelVersion: responseModelVersion,
      selectionIdentity,
      liveIdentity,
    });
  }

  return identityResult({
    projectionVisible: true,
    code: "verified-primary",
    reason: "Configured model and selection identity match live evidence.",
    lineLabel: VERIFIED_PRIMARY_LABEL,
    verifiedPrimary: true,
    configuredModelVersion,
    modelVersion: responseModelVersion,
    selectionIdentity,
    liveIdentity,
  });
}

function sourcePoints(value) {
  if (Array.isArray(value)) {
    return value;
  }
  return Array.isArray(value?.points) ? value.points : [];
}

export function forecastIdentityKey(point) {
  if (!point || typeof point !== "object") {
    return null;
  }
  const modelVersion = point.modelVersion ?? point.model_version;
  const generatedMs = safeInteger(point.generatedMs ?? point.generated_ms);
  const horizonMs = positiveInteger(point.horizonMs ?? point.horizon_ms);
  if (typeof modelVersion !== "string" || generatedMs === null || horizonMs === null) {
    return null;
  }
  return `${modelVersion}:${generatedMs}:${horizonMs}`;
}

function normalizeAttempt(point, projectionVisible) {
  const targetMs = evaluationTargetMs(point);
  const generatedMs = safeInteger(point.generatedMs ?? point.generated_ms);
  const maturedMs = safeInteger(point.maturedMs ?? point.matured_ms);
  const horizonMs = positiveInteger(point.horizonMs ?? point.horizon_ms);
  if (
    targetMs === null ||
    generatedMs === null ||
    horizonMs === null ||
    !Number.isSafeInteger(generatedMs + horizonMs) ||
    targetMs !== generatedMs + horizonMs
  ) {
    return null;
  }

  const valid = point.valid === true;
  const sourceProjectedDecimal = valid
    ? decimalStringOrNull(point.projectedDecimal ?? point.projected_chainlink)
    : null;
  const actualDecimal = decimalStringOrNull(point.actualDecimal ?? point.actual_chainlink);
  const sourceBaselineDecimal = valid
    ? decimalStringOrNull(point.baselineDecimal ?? point.chainlink_at_forecast)
    : null;
  const sourceHasProjection = valid && sourceProjectedDecimal !== null;
  const projectedDecimal = projectionVisible && sourceHasProjection ? sourceProjectedDecimal : null;
  const baselineDecimal = projectionVisible && sourceHasProjection ? sourceBaselineDecimal : null;
  const scored = sourceHasProjection && actualDecimal !== null;
  const persistedForecastError = scored
    ? decimalStringOrNull(point.forecastErrorDecimal ?? point.forecast_error)
    : null;
  const forecastErrorSource = scored
    ? persistedForecastError ?? decimalDifferenceString(sourceProjectedDecimal, actualDecimal)
    : null;
  const baselineErrorSource =
    scored && sourceBaselineDecimal !== null
      ? decimalStringOrNull(point.baselineErrorDecimal ?? point.baseline_error) ??
        decimalDifferenceString(sourceBaselineDecimal, actualDecimal)
      : null;

  return Object.freeze({
    kind: "attempt",
    separator: false,
    targetMs,
    generatedMs,
    maturedMs,
    horizonMs,
    modelVersion: point.modelVersion ?? point.model_version ?? null,
    valid,
    status: typeof point.status === "string" ? point.status : valid ? "valid" : "invalid",
    invalidReasons: Array.isArray(point.invalid_reasons)
      ? [...point.invalid_reasons]
      : Array.isArray(point.invalidReasons)
        ? [...point.invalidReasons]
        : [],
    state: point.state ?? null,
    sourceHasProjection,
    hasProjection: projectedDecimal !== null,
    scored,
    projectedDecimal,
    actualDecimal,
    baselineDecimal,
    projectedPlotValue: financialChartNumber(projectedDecimal),
    actualPlotValue: financialChartNumber(actualDecimal),
    baselinePlotValue: financialChartNumber(baselineDecimal),
    forecastErrorDecimal: projectionVisible ? forecastErrorSource : null,
    persistedForecastErrorDecimal: projectionVisible ? persistedForecastError : null,
    persistedForecastErrorPlotValue: financialChartNumber(
      projectionVisible ? persistedForecastError : null,
    ),
    absoluteErrorDecimal:
      projectionVisible && forecastErrorSource !== null
        ? absoluteDecimalString(forecastErrorSource)
        : null,
    baselineErrorDecimal: projectionVisible ? baselineErrorSource : null,
    pendingMoveDecimal: projectionVisible
      ? decimalStringOrNull(point.pendingMoveDecimal ?? point.pending_move)
      : null,
    pendingMoveBpsDecimal: projectionVisible
      ? decimalStringOrNull(point.pendingMoveBpsDecimal ?? point.pending_move_bps)
      : null,
    direction: projectionVisible ? point.direction ?? null : null,
    actualSourceTimestampMs: safeInteger(
      point.actualSourceTimestampMs ?? point.actual_chainlink_source_timestamp_ms,
    ),
    actualReceivedMs: safeInteger(
      point.actualReceivedMs ?? point.actual_chainlink_received_ms,
    ),
    actualAgeAtTargetMs: safeInteger(
      point.actualAgeAtTargetMs ?? point.actual_chainlink_age_at_target_ms,
    ),
    forecastMarketId: safeInteger(point.forecastMarketId ?? point.forecast_market_id),
    fullHorizonBeforeForecastMarketEnd:
      point.fullHorizonBeforeForecastMarketEnd ??
      point.full_horizon_before_forecast_market_end ??
      null,
    selectionIdentity: normalizeSelectionIdentity(point),
    key: forecastIdentityKey(point),
  });
}

function linePoint(point, seriesName) {
  const decimalField =
    seriesName === "actual"
      ? "actualDecimal"
      : seriesName === "projected"
        ? "projectedDecimal"
        : seriesName === "baseline"
          ? "baselineDecimal"
          : "persistedForecastErrorDecimal";
  const plotField =
    seriesName === "actual"
      ? "actualPlotValue"
      : seriesName === "projected"
        ? "projectedPlotValue"
        : seriesName === "baseline"
          ? "baselinePlotValue"
          : "persistedForecastErrorPlotValue";
  return Object.freeze({
    targetMs: point.targetMs,
    value: point[plotField],
    plotValue: point[plotField],
    decimal: point[decimalField],
    [decimalField]: point[decimalField],
    separator: false,
    point,
  });
}

function separatorPoint(separator, seriesName) {
  return Object.freeze({
    targetMs: separator.targetMs,
    value: null,
    plotValue: null,
    decimal: null,
    separator: true,
    reason: UNOBSERVED_BUCKET_REASON,
    missingBucketCount: separator.missingBucketCount,
    seriesName,
  });
}

function separatorBetween(previous, next, cadenceMs) {
  if (cadenceMs === null) {
    return null;
  }
  const previousBucket = Math.floor(previous.generatedMs / cadenceMs);
  const nextBucket = Math.floor(next.generatedMs / cadenceMs);
  const missingBucketCount = nextBucket - previousBucket - 1;
  if (missingBucketCount < 1 || next.targetMs <= previous.targetMs) {
    return null;
  }

  const targetMs = previous.targetMs + (next.targetMs - previous.targetMs) / 2;
  if (!(targetMs > previous.targetMs && targetMs < next.targetMs)) {
    return null;
  }

  return Object.freeze({
    targetMs,
    afterGeneratedMs: previous.generatedMs,
    beforeGeneratedMs: next.generatedMs,
    previousBucket,
    nextBucket,
    missingBucketCount,
    reason: UNOBSERVED_BUCKET_REASON,
  });
}

function emptySeries(identity, market = null, stats = {}) {
  const result = {
    market,
    actual: [],
    projected: [],
    baseline: [],
    error: [],
    points: [],
    separators: [],
    stats: {
      attempts: 0,
      validForecasts: 0,
      scored: 0,
      invalid: 0,
      validWithoutActual: 0,
      outOfWindow: 0,
      malformed: 0,
      unobservedSeparators: 0,
      unobservedBuckets: 0,
      projectionSuppressed: !identity.projectionVisible,
      ...stats,
    },
    projectionVisible: identity.projectionVisible,
    identity,
    ghost: null,
    threshold: null,
  };
  result.series = {
    actual: result.actual,
    projected: result.projected,
    baseline: result.baseline,
    error: result.error,
    contextualActual: [],
  };
  return result;
}

/** Build chart-ready target-aligned lines while retaining exact decimal text. */
export function buildShadowSeries(evaluationValue, options = {}) {
  const response = asResponse(evaluationValue);
  const identity =
    options.identity ?? validateProjectionIdentity(response, options);
  const market = normalizeMarketWindow(options.market ?? response.market);
  if (!market) {
    return emptySeries(
      hiddenIdentity(
        "invalid-market-window",
        "The selected market window is missing or malformed. Projections are hidden.",
        {
          configuredModelVersion: identity.configuredModelVersion,
          modelVersion: identity.modelVersion,
        },
      ),
    );
  }

  const rawPoints = sourcePoints(response);
  const cadenceMs = positiveInteger(
    options.cadenceMs ??
      response.model?.evaluation_cadence_ms ??
      response.model?.evaluationCadenceMs,
  );
  let outOfWindow = 0;
  let malformed = 0;
  const points = [];

  for (const rawPoint of rawPoints) {
    const targetMs = evaluationTargetMs(rawPoint);
    if (targetMs === null) {
      malformed += 1;
      continue;
    }
    if (!targetBelongsToMarket(targetMs, market)) {
      outOfWindow += 1;
      continue;
    }

    const point = normalizeAttempt(rawPoint, identity.projectionVisible);
    if (!point) {
      malformed += 1;
      continue;
    }
    points.push(point);
  }

  points.sort((left, right) =>
    left.generatedMs - right.generatedMs || left.targetMs - right.targetMs,
  );

  const actual = [];
  const projected = [];
  const baseline = [];
  const error = [];
  const separators = [];
  let unobservedBuckets = 0;

  points.forEach((point, index) => {
    if (index > 0) {
      const separator = separatorBetween(points[index - 1], point, cadenceMs);
      if (separator) {
        separators.push(separator);
        unobservedBuckets += separator.missingBucketCount;
        actual.push(separatorPoint(separator, "actual"));
        projected.push(separatorPoint(separator, "projected"));
        baseline.push(separatorPoint(separator, "baseline"));
        error.push(separatorPoint(separator, "error"));
      }
    }
    actual.push(linePoint(point, "actual"));
    projected.push(linePoint(point, "projected"));
    baseline.push(linePoint(point, "baseline"));
    error.push(linePoint(point, "error"));
  });

  const stats = {
    attempts: points.length,
    validForecasts: points.filter((point) => point.sourceHasProjection).length,
    scored: points.filter((point) => point.scored).length,
    invalid: points.filter((point) => !point.valid).length,
    validWithoutActual: points.filter(
      (point) => point.sourceHasProjection && point.actualDecimal === null,
    ).length,
    outOfWindow,
    malformed,
    unobservedSeparators: separators.length,
    unobservedBuckets,
    cadenceValid: cadenceMs !== null,
    projectionSuppressed: !identity.projectionVisible,
  };

  const contextualActual = options.contextualData
    ? normalizeContextActualSeries(options.contextualData, market)
    : [];
  const threshold = chooseOpeningThreshold(options.contextualData, options.sources);
  const result = {
    market,
    actual,
    projected,
    baseline,
    error,
    points,
    separators,
    stats,
    projectionVisible: identity.projectionVisible,
    identity,
    threshold,
    ghost: null,
  };
  result.series = { actual, projected, baseline, error, contextualActual };
  result.ghost = options.livePayload
    ? deriveLiveGhost(options.livePayload, {
        market,
        maturedPoints: points,
        configuredModelVersion: identity.configuredModelVersion,
        identity,
      })
    : null;
  return result;
}

export const buildEvaluationSeries = buildShadowSeries;

function maturedArray(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (Array.isArray(value?.points)) {
    return value.points;
  }
  return [];
}

/** Derive one unconnected future marker, removing it once persistence catches up. */
export function deriveLiveGhost(livePayloadOrSignal, options = {}) {
  const signal = extractLiveSignal(livePayloadOrSignal);
  if (!signal || signal.valid !== true) {
    return null;
  }

  if (options.identity && options.identity.projectionVisible !== true) {
    return null;
  }

  const configuredModelVersion =
    options.configuredModelVersion ?? options.primaryModelVersion ?? null;
  const modelVersion = signal.model_version ?? signal.modelVersion ?? null;
  if (
    typeof configuredModelVersion !== "string" ||
    configuredModelVersion.length === 0 ||
    modelVersion !== configuredModelVersion
  ) {
    return null;
  }

  const selectionIdentity = normalizeSelectionIdentity(signal);
  if (!selectionIdentity) {
    return null;
  }
  if (
    options.expectedSelectionIdentity &&
    !identitiesEqual(selectionIdentity, options.expectedSelectionIdentity)
  ) {
    return null;
  }
  if (
    options.identity?.selectionIdentity &&
    options.isCurrentMarket !== false &&
    !identitiesEqual(selectionIdentity, options.identity.selectionIdentity)
  ) {
    return null;
  }

  const projectedDecimal = decimalStringOrNull(
    signal.projectedDecimal ?? signal.projected_chainlink,
  );
  const generatedMs = safeInteger(signal.generatedMs ?? signal.generated_ms);
  const horizonMs = positiveInteger(signal.horizonMs ?? signal.horizon_ms);
  const targetMs = liveForecastTargetMs(signal);
  const market = normalizeMarketWindow(options.market ?? livePayloadOrSignal);
  if (
    projectedDecimal === null ||
    generatedMs === null ||
    horizonMs === null ||
    targetMs === null ||
    !targetBelongsToMarket(targetMs, market)
  ) {
    return null;
  }

  const key = forecastIdentityKey({ modelVersion, generatedMs, horizonMs });
  const maturedPoints = maturedArray(
    options.maturedPoints ?? options.evaluationPoints ?? options.evaluationResponse,
  );
  if (maturedPoints.some((point) => forecastIdentityKey(point) === key)) {
    return null;
  }

  const generationMarket = signal.market ?? signal.forecast_market ?? {
    market_id: signal.market_id ?? signal.forecast_market_id ?? null,
    market_start_ms: signal.market_start_ms ?? signal.forecast_market_start_ms ?? null,
    market_end_ms: signal.market_end_ms ?? signal.forecast_market_end_ms ?? null,
  };
  const plotValue = financialChartNumber(projectedDecimal);
  if (plotValue === null) {
    return null;
  }

  return Object.freeze({
    targetMs,
    value: plotValue,
    plotValue,
    projectedDecimal,
    generatedMs,
    horizonMs,
    modelVersion,
    key,
    selectionIdentity,
    generationMarket,
    signal,
    unconnected: true,
  });
}

export const buildLiveGhost = deriveLiveGhost;

function findContextRows(payload) {
  const candidates = [
    payload?.points,
    payload?.data,
    payload?.rows,
    payload?.chainlink,
    payload?.series?.chainlink,
    payload?.prices?.chainlink,
    payload?.market_data,
  ];
  return candidates.find(Array.isArray) ?? [];
}

function contextTimestamp(row) {
  return safeInteger(
    row?.targetMs ??
      row?.target_ms ??
      row?.timestamp_ms ??
      row?.time_ms ??
      row?.bucket_start_ms ??
      row?.source_timestamp_ms ??
      row?.ts_ms,
  );
}

function nestedFinancialValue(value) {
  if (typeof value === "string" || value === null) {
    return value;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value.value ?? value.price ?? value.close ?? value.actual ?? undefined;
}

function contextChainlinkValue(row) {
  const candidates = [
    row?.chainlink,
    row?.chainlink_price,
    row?.chainlink_value,
    row?.prices?.chainlink,
    row?.values?.chainlink,
    row?.sources?.chainlink,
    row?.price_sources?.chainlink,
    row?.value,
  ];
  for (const candidate of candidates) {
    const value = nestedFinancialValue(candidate);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

/** Normalize the one-second context without carrying values across gaps. */
export function normalizeContextActualSeries(payload, marketValue) {
  const market = normalizeMarketWindow(marketValue ?? payload?.market);
  if (!market) {
    return [];
  }

  const rows = findContextRows(payload);
  return rows
    .map((row) => {
      const targetMs = contextTimestamp(row);
      if (targetMs === null || !targetBelongsToMarket(targetMs, market)) {
        return null;
      }
      const rawValue = contextChainlinkValue(row);
      const decimal = rawValue === null ? null : decimalStringOrNull(rawValue);
      const plotValue = financialChartNumber(decimal);
      return Object.freeze({
        targetMs,
        value: plotValue,
        plotValue,
        decimal,
        actualDecimal: decimal,
        contextual: true,
        missing: decimal === null,
      });
    })
    .filter(Boolean)
    .sort((left, right) => left.targetMs - right.targetMs);
}

export const normalizeContextualActual = normalizeContextActualSeries;

function observedSourceEntries(sources) {
  if (Array.isArray(sources)) {
    return sources;
  }
  if (Array.isArray(sources?.sources)) {
    return sources.sources;
  }
  if (Array.isArray(sources?.providers)) {
    return sources.providers;
  }
  if (sources?.sources && typeof sources.sources === "object") {
    return Object.entries(sources.sources).map(([provider, value]) => ({
      provider,
      ...(value && typeof value === "object" ? value : { open: value }),
    }));
  }
  return [];
}

/** Apply official-then-observed threshold priority without relabeling fallback data. */
export function chooseOpeningThreshold(dataPayload, sourcesPayload) {
  const officialDecimal = decimalStringOrNull(
    dataPayload?.market?.chainlink_resolution?.open ??
      dataPayload?.market?.chainlinkResolution?.open ??
      null,
  );
  if (officialDecimal !== null) {
    const plotValue = financialChartNumber(officialDecimal);
    return Object.freeze({
      kind: "official",
      label: "Official market open",
      decimal: officialDecimal,
      value: plotValue,
      plotValue,
    });
  }

  const observed = observedSourceEntries(sourcesPayload).find(
    (source) =>
      (source.provider ?? source.provider_name ?? source.name) ===
      "polymarket_chainlink_rtds",
  );
  const observedDecimal = decimalStringOrNull(
    observed?.open ?? observed?.opening_value ?? observed?.value?.open ?? null,
  );
  if (observedDecimal === null) {
    return null;
  }
  const plotValue = financialChartNumber(observedDecimal);
  return Object.freeze({
    kind: "observed",
    label: "Observed window open",
    decimal: observedDecimal,
    value: plotValue,
    plotValue,
  });
}

/** Distinguish a healthy-but-missing actual from stale and fresh live values. */
export function normalizeLiveActual(
  livePayload,
  { receivedStaleMs = 2_500, sourceStaleMs = 5_000 } = {},
) {
  const chainlink = livePayload?.prices?.chainlink ?? livePayload?.chainlink ?? null;
  const decimal = decimalStringOrNull(chainlink?.value ?? null);
  if (decimal === null) {
    return Object.freeze({
      status: "unavailable",
      label: "Actual price unavailable",
      decimal: null,
      value: null,
      plotValue: null,
      receivedAgeMs: safeInteger(chainlink?.received_age_ms),
      sourceAgeMs: safeInteger(chainlink?.source_age_ms),
    });
  }

  const receivedAgeMs = safeInteger(
    chainlink.receivedAgeMs ?? chainlink.received_age_ms,
  );
  const sourceAgeMs = safeInteger(chainlink.sourceAgeMs ?? chainlink.source_age_ms);
  const limitsValid =
    positiveInteger(receivedStaleMs) !== null && positiveInteger(sourceStaleMs) !== null;
  const fresh =
    limitsValid &&
    receivedAgeMs !== null &&
    sourceAgeMs !== null &&
    receivedAgeMs >= 0 &&
    sourceAgeMs >= 0 &&
    receivedAgeMs <= receivedStaleMs &&
    sourceAgeMs <= sourceStaleMs;
  const plotValue = financialChartNumber(decimal);

  return Object.freeze({
    status: fresh ? "live" : "stale",
    label: fresh ? "Live" : "Stale",
    decimal,
    value: plotValue,
    plotValue,
    receivedAgeMs,
    sourceAgeMs,
  });
}
