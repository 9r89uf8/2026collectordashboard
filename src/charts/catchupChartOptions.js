import Decimal from "decimal.js";

export const CHART_SERIES_NAMES = Object.freeze({
  actual: "Actual Chainlink",
  futures: "Futures at forecast",
  projected: "Projected Chainlink",
  baseline: "No-change baseline",
  contextualActual: "Actual context (1s)",
  liveGhost: "Live projection",
});

export const DEFAULT_CHART_PALETTE = Object.freeze({
  page: "#080c12",
  panel: "#111821",
  panelRaised: "#16202b",
  grid: "#263341",
  text: "#ecf2f8",
  muted: "#8d9aaa",
  actual: "#42c7e8",
  futures: "#e879f9",
  projected: "#f4b860",
  baseline: "#8793a3",
  threshold: "#a78bfa",
  positive: "#4fd18b",
  negative: "#ff7474",
});

export const FORECAST_PATH_NOTE =
  "Dashed: independent three-second target projections, not a continuous path.";
export const FUTURES_PATH_NOTE =
  "Dotted: persisted futures snapshots captured when forecasts were generated, plotted at target time for comparison.";

const FINANCIAL_FIELDS = Object.freeze({
  actual: ["actualDecimal", "actual_chainlink", "actual"],
  futures: ["futuresAtForecastDecimal", "futures_at_forecast", "futuresDecimal"],
  projected: ["projectedDecimal", "projected_chainlink", "projected"],
  baseline: ["baselineDecimal", "chainlinkAtForecastDecimal", "chainlink_at_forecast", "baseline"],
  contextualActual: ["actualDecimal", "contextualActualDecimal", "chainlink", "price"],
  liveGhost: ["projectedDecimal", "projected_chainlink", "projected"],
  threshold: ["thresholdDecimal", "openDecimal", "open"],
});

const TOOLTIP_FIELD_ALIASES = Object.freeze({
  targetMs: ["targetMs", "target_ms"],
  generatedMs: ["generatedMs", "generated_ms"],
  horizonMs: ["horizonMs", "horizon_ms"],
  projectedDecimal: ["projectedDecimal", "projected_chainlink", "projected"],
  actualDecimal: ["actualDecimal", "actual_chainlink", "actual"],
  futuresAtForecastDecimal: [
    "futuresAtForecastDecimal",
    "futures_at_forecast",
    "futuresDecimal",
  ],
  futuresAtForecastSourceTimestampMs: [
    "futuresAtForecastSourceTimestampMs",
    "futures_at_forecast_source_timestamp_ms",
  ],
  futuresAtForecastReceivedMs: [
    "futuresAtForecastReceivedMs",
    "futures_at_forecast_received_ms",
  ],
  baselineDecimal: ["baselineDecimal", "chainlinkAtForecastDecimal", "chainlink_at_forecast", "baseline"],
  forecastErrorDecimal: ["forecastErrorDecimal", "forecast_error"],
  baselineErrorDecimal: ["baselineErrorDecimal", "baseline_error"],
  status: ["status"],
  invalidReasons: ["invalidReasons", "invalid_reasons"],
  modelVersion: ["modelVersion", "model_version"],
  forecastMarketId: ["forecastMarketId", "forecast_market_id", "generationMarketId"],
});

function firstPresent(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function firstFinite(...values) {
  return values.find((value) => Number.isFinite(value));
}

function aliasedValue(source, aliases) {
  if (!source || typeof source !== "object") return undefined;
  return firstPresent(...aliases.map((alias) => source[alias]));
}

function tooltipValue(source, field) {
  return aliasedValue(source, TOOLTIP_FIELD_ALIASES[field]);
}

function safeDecimal(value) {
  if (value === null || value === undefined || value === "") return null;

  try {
    return new Decimal(value);
  } catch {
    return null;
  }
}

/**
 * Converts one financial value at the chart-rendering boundary. Application
 * state and tooltip payloads must retain their original decimal strings.
 */
export function financialChartNumber(value) {
  const decimal = safeDecimal(value);
  return decimal === null ? null : decimal.toNumber();
}

function decimalString(value) {
  const decimal = safeDecimal(value);
  return decimal === null ? null : decimal.toString();
}

function groupInteger(integer) {
  const [whole, fraction] = integer.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return fraction === undefined ? grouped : `${grouped}.${fraction}`;
}

export function formatFinancial(value, { signed = false, currency = true, places = 2 } = {}) {
  const decimal = safeDecimal(value);
  if (decimal === null) return "—";

  const negative = decimal.isNegative() && !decimal.isZero();
  const sign = negative ? "−" : signed && !decimal.isZero() ? "+" : "";
  const magnitude = decimal.abs().toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed(places);
  return `${sign}${currency ? "$" : ""}${groupInteger(magnitude)}`;
}

function formatAxisPrice(value) {
  const decimal = safeDecimal(value);
  return decimal === null ? "—" : formatFinancial(decimal.toString(), { places: 2 });
}

function twoDigits(value) {
  return String(value).padStart(2, "0");
}

function threeDigits(value) {
  return String(value).padStart(3, "0");
}

export function formatUtcTimestamp(timestampMs) {
  const date = new Date(timestampMs);
  if (!Number.isFinite(timestampMs) || Number.isNaN(date.getTime())) return "Unknown UTC time";

  return `${twoDigits(date.getUTCHours())}:${twoDigits(date.getUTCMinutes())}:${twoDigits(
    date.getUTCSeconds(),
  )}.${threeDigits(date.getUTCMilliseconds())} UTC`;
}

function formatUtcWindowTimestamp(timestampMs) {
  const date = new Date(timestampMs);
  if (!Number.isFinite(timestampMs) || Number.isNaN(date.getTime())) return "unknown UTC time";

  return `${date.getUTCFullYear()}-${twoDigits(date.getUTCMonth() + 1)}-${twoDigits(
    date.getUTCDate(),
  )} ${twoDigits(date.getUTCHours())}:${twoDigits(date.getUTCMinutes())}:${twoDigits(
    date.getUTCSeconds(),
  )} UTC`;
}

export function formatElapsed(timestampMs, marketStartMs) {
  const elapsedMs = Math.max(0, timestampMs - marketStartMs);
  const totalSeconds = Math.round(elapsedMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${twoDigits(minutes)}:${twoDigits(seconds)}`;
}

function formatHorizon(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "—";
  const seconds = milliseconds / 1_000;
  const exact = seconds.toFixed(3).replace(/0+$/, "").replace(/\.$/, ".0");
  return `${exact} seconds earlier`;
}

function formatRelativeToGenerated(timestampMs, generatedMs) {
  if (!Number.isFinite(timestampMs)) return "Unavailable";
  const timestamp = formatUtcTimestamp(timestampMs);
  if (!Number.isFinite(generatedMs)) return timestamp;

  const offsetMs = timestampMs - generatedMs;
  if (offsetMs === 0) return `${timestamp} · at generation`;
  return `${timestamp} · ${Math.abs(offsetMs)} ms ${
    offsetMs < 0 ? "before" : "after"
  } generated`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function tooltipRow(label, value, modifier = "") {
  return `<div class="chart-tooltip__row${modifier ? ` chart-tooltip__row--${modifier}` : ""}">
    <span class="chart-tooltip__label">${escapeHtml(label)}</span>
    <span class="chart-tooltip__value">${escapeHtml(value)}</span>
  </div>`;
}

function computeDifference(left, right) {
  const leftDecimal = safeDecimal(left);
  const rightDecimal = safeDecimal(right);
  return leftDecimal === null || rightDecimal === null ? null : leftDecimal.minus(rightDecimal).toString();
}

function mergeTooltipRaws(raws) {
  const merged = {};

  // The normalized point normally contains the whole evidence record. Merge
  // sparse line-specific payloads without allowing undefined fields to erase it.
  for (const raw of raws) {
    if (!raw || typeof raw !== "object") continue;
    for (const [key, value] of Object.entries(raw)) {
      if (value !== undefined && value !== null && merged[key] === undefined) {
        merged[key] = value;
      }
    }
  }

  return merged;
}

function rawFromParam(param) {
  if (param?.data?.raw && typeof param.data.raw === "object") return param.data.raw;
  return null;
}

function formatThresholdTooltip(raw) {
  const label = firstPresent(raw.thresholdLabel, raw.label, "Market opening threshold");
  const decimal = firstPresent(raw.thresholdDecimal, raw.decimal, raw.value);
  return `<div class="chart-tooltip">
    <div class="chart-tooltip__title">${escapeHtml(label)}</div>
    ${tooltipRow("Opening value", formatFinancial(decimal))}
  </div>`;
}

function formatContextTooltip(raw) {
  const targetMs = firstFinite(tooltipValue(raw, "targetMs"), raw.timestampMs, raw.timestamp_ms);
  const actual = firstPresent(
    tooltipValue(raw, "actualDecimal"),
    raw.contextualActualDecimal,
    raw.decimal,
    raw.value,
  );

  return `<div class="chart-tooltip">
    <div class="chart-tooltip__title">Context observation</div>
    ${tooltipRow("Observed", formatUtcTimestamp(targetMs))}
    ${tooltipRow("Actual context", formatFinancial(actual))}
  </div>`;
}

function formatForecastTooltip(raw, { marketId, threshold } = {}) {
  const targetMs = firstFinite(tooltipValue(raw, "targetMs"));
  const generatedMs = firstFinite(tooltipValue(raw, "generatedMs"));
  const horizonMs = firstFinite(
    tooltipValue(raw, "horizonMs"),
    Number.isFinite(targetMs) && Number.isFinite(generatedMs) ? targetMs - generatedMs : undefined,
  );
  const projected = tooltipValue(raw, "projectedDecimal");
  const actual = tooltipValue(raw, "actualDecimal");
  const futuresAtForecast = tooltipValue(raw, "futuresAtForecastDecimal");
  const futuresSourceTimestampMs = firstFinite(
    tooltipValue(raw, "futuresAtForecastSourceTimestampMs"),
  );
  const futuresReceivedMs = firstFinite(
    tooltipValue(raw, "futuresAtForecastReceivedMs"),
  );
  const baseline = tooltipValue(raw, "baselineDecimal");
  const forecastError = firstPresent(
    tooltipValue(raw, "forecastErrorDecimal"),
    computeDifference(projected, actual),
  );
  const baselineError = firstPresent(
    tooltipValue(raw, "baselineErrorDecimal"),
    computeDifference(baseline, actual),
  );
  const absoluteError = safeDecimal(forecastError)?.abs().toString() ?? null;
  const thresholdDecimal = firstPresent(threshold?.decimal, threshold?.thresholdDecimal, threshold?.value);
  const actualMargin = computeDifference(actual, thresholdDecimal);
  const status = firstPresent(tooltipValue(raw, "status"), raw.valid === true ? "valid" : undefined, "unknown");
  const invalidReasons = tooltipValue(raw, "invalidReasons");
  const forecastMarketId = firstPresent(
    tooltipValue(raw, "forecastMarketId"),
    raw.generationMarket?.marketId,
    raw.generationMarket?.market_id,
    raw.signal?.forecast_market_id,
    raw.signal?.market_id,
    raw.signal?.market?.market_id,
  );

  const rows = [
    tooltipRow("Target", formatUtcTimestamp(targetMs)),
    tooltipRow("Forecast generated", formatUtcTimestamp(generatedMs)),
    tooltipRow("Projected Chainlink", formatFinancial(projected)),
    tooltipRow("Actual Chainlink", formatFinancial(actual)),
    tooltipRow("Futures at forecast", formatFinancial(futuresAtForecast)),
  ];

  if (safeDecimal(futuresAtForecast) !== null) {
    rows.push(
      tooltipRow(
        "Futures source timestamp",
        formatRelativeToGenerated(futuresSourceTimestampMs, generatedMs),
        "wrap",
      ),
      tooltipRow(
        "Futures received timestamp",
        formatRelativeToGenerated(futuresReceivedMs, generatedMs),
        "wrap",
      ),
    );
  }

  if (actualMargin !== null) {
    rows.push(tooltipRow("Actual vs market open", formatFinancial(actualMargin, { signed: true })));
  }

  rows.push(
    tooltipRow("Forecast error", formatFinancial(forecastError, { signed: true })),
    tooltipRow("Absolute error", formatFinancial(absoluteError)),
    tooltipRow("No-change error", formatFinancial(baselineError, { signed: true })),
    tooltipRow("Generated", formatHorizon(horizonMs)),
    tooltipRow("Status", String(status)),
  );

  if (forecastMarketId !== undefined && String(forecastMarketId) !== String(marketId)) {
    rows.push(tooltipRow("Generated in market", String(forecastMarketId)));
  }

  if (Array.isArray(invalidReasons) && invalidReasons.length > 0) {
    rows.push(tooltipRow("Reason", invalidReasons.join(", "), "warning"));
  }

  return `<div class="chart-tooltip">
    <div class="chart-tooltip__title">Forecast target</div>
    ${rows.join("")}
  </div>`;
}

export function createTooltipFormatter(context = {}) {
  return (incomingParams) => {
    const params = Array.isArray(incomingParams) ? incomingParams : [incomingParams];
    const raws = params.map(rawFromParam).filter(Boolean);
    if (raws.length === 0) return "";

    const thresholdRaw = raws.find((raw) => raw.kind === "threshold");
    const evidenceRaws = raws.filter(
      (raw) => raw.kind !== "threshold" && raw.kind !== "contextualActual",
    );

    if (evidenceRaws.length > 0) {
      const priority = [...evidenceRaws].sort((left, right) => {
        const leftHasForecast = tooltipValue(left, "projectedDecimal") !== undefined ? 1 : 0;
        const rightHasForecast = tooltipValue(right, "projectedDecimal") !== undefined ? 1 : 0;
        return rightHasForecast - leftHasForecast;
      });
      return formatForecastTooltip(mergeTooltipRaws(priority), context);
    }

    const contextRaw = raws.find((raw) => raw.kind === "contextualActual");
    if (contextRaw) return formatContextTooltip(contextRaw);
    if (thresholdRaw) return formatThresholdTooltip(thresholdRaw);
    return "";
  };
}

function resolveMarket(model) {
  const market = model.market ?? model.window ?? {};
  const startMs = firstFinite(
    model.marketStartMs,
    model.market_start_ms,
    market.startMs,
    market.marketStartMs,
    market.market_start_ms,
  );
  const endMs = firstFinite(
    model.marketEndMs,
    model.market_end_ms,
    market.endMs,
    market.marketEndMs,
    market.market_end_ms,
  );
  const marketId = firstPresent(
    model.marketId,
    model.market_id,
    market.id,
    market.marketId,
    market.market_id,
  );

  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    throw new TypeError("Catch-up chart requires a finite market start and end time.");
  }

  return { startMs, endMs, marketId };
}

function resolveShadowSeries(model) {
  const source = model.shadowSeries ?? model.seriesModel ?? model.series ?? {};
  return {
    actual: source.actual ?? model.actual ?? [],
    futures:
      source.futures ??
      source.series?.futures ??
      [],
    projected: source.projected ?? model.projected ?? [],
    baseline: source.baseline ?? model.baseline ?? [],
    points: source.points ?? model.points ?? [],
    identity: source.identity ?? model.identity ?? null,
    projectionVisible: firstPresent(
      model.projectionVisible,
      source.projectionVisible,
      true,
    ),
  };
}

function resolveContextualActual(model) {
  return (
    model.contextualActual ??
    model.contextActual ??
    model.contextualSeries ??
    model.context?.actual ??
    model.shadowSeries?.series?.contextualActual ??
    model.shadowSeries?.contextualActual ??
    []
  );
}

function resolveThreshold(model) {
  const threshold =
    model.threshold ??
    model.openingThreshold ??
    model.shadowSeries?.threshold ??
    null;
  if (!threshold) return null;

  const decimal = firstPresent(
    threshold.decimal,
    threshold.thresholdDecimal,
    threshold.openDecimal,
    typeof threshold.value === "string" ? threshold.value : undefined,
  );
  const plotValue = firstPresent(
    Number.isFinite(threshold.plotValue) ? threshold.plotValue : undefined,
    financialChartNumber(decimal),
    Number.isFinite(threshold.value) ? threshold.value : undefined,
  );
  if (!Number.isFinite(plotValue)) return null;

  return {
    ...threshold,
    decimal: decimal ?? new Decimal(plotValue).toString(),
    plotValue,
    label: threshold.label ?? "Market opening threshold",
  };
}

function targetMsFor(item) {
  if (Array.isArray(item)) return firstFinite(item[0]);
  return firstFinite(item?.targetMs, item?.target_ms, item?.timestampMs, item?.timestamp_ms);
}

function plotValueFor(item, kind) {
  if (Array.isArray(item)) {
    return item[1] === null ? null : financialChartNumber(item[1]);
  }
  if (!item || typeof item !== "object") return null;
  if (item.plotValue === null || item.value === null) return null;
  if (Number.isFinite(item.plotValue)) return item.plotValue;

  const financialValue = firstPresent(
    ...FINANCIAL_FIELDS[kind].map((field) => item[field]),
    typeof item.value === "string" || item.value instanceof Decimal ? item.value : undefined,
  );
  if (financialValue !== undefined) return financialChartNumber(financialValue);
  return Number.isFinite(item.value) ? item.value : null;
}

function exactDecimalFor(item, kind) {
  if (Array.isArray(item)) return decimalString(item[1]);
  if (!item || typeof item !== "object") return null;
  return firstPresent(
    ...FINANCIAL_FIELDS[kind].map((field) => item[field]),
    item.decimal,
    typeof item.value === "string" ? item.value : undefined,
  );
}

function pointMetadataMap(points) {
  const map = new Map();
  for (const point of points) {
    const targetMs = targetMsFor(point);
    if (Number.isFinite(targetMs)) map.set(targetMs, point);
  }
  return map;
}

function lineDatum(item, kind, metadata) {
  const targetMs = targetMsFor(item);
  if (!Number.isFinite(targetMs)) return null;
  const plotValue = plotValueFor(item, kind);
  const itemObject = item && !Array.isArray(item) && typeof item === "object" ? item : {};
  const decimal = exactDecimalFor(item, kind);
  const raw = {
    ...(metadata ?? {}),
    ...itemObject,
    targetMs,
    kind,
  };

  if (decimal !== null) {
    const decimalField = {
      actual: "actualDecimal",
      futures: "futuresAtForecastDecimal",
      projected: "projectedDecimal",
      baseline: "baselineDecimal",
      contextualActual: "actualDecimal",
      liveGhost: "projectedDecimal",
    }[kind];
    raw[decimalField] ??= decimal;
  }

  return {
    value: [targetMs, plotValue],
    raw,
  };
}

function createLineData(items, kind, metadataByTarget) {
  return items
    .map((item) => lineDatum(item, kind, metadataByTarget.get(targetMsFor(item))))
    .filter(Boolean)
    .sort((left, right) => left.value[0] - right.value[0]);
}

function pointsInsideMarket(data, market) {
  return data.filter(
    (datum) => datum.value[0] >= market.startMs && datum.value[0] < market.endMs,
  );
}

function evidenceKey(item) {
  if (!item || typeof item !== "object") return null;
  if (item.key) return String(item.key);
  const modelVersion = firstPresent(item.modelVersion, item.model_version);
  const generatedMs = firstFinite(item.generatedMs, item.generated_ms);
  const horizonMs = firstFinite(item.horizonMs, item.horizon_ms);
  if (modelVersion === undefined || !Number.isFinite(generatedMs) || !Number.isFinite(horizonMs)) {
    return null;
  }
  return `${modelVersion}:${generatedMs}:${horizonMs}`;
}

function resolveGhost(model, points, projectionVisible, market) {
  if (!projectionVisible) return null;
  const ghost =
    model.liveGhost ??
    model.ghost ??
    model.shadowSeries?.ghost ??
    null;
  if (!ghost) return null;
  if (ghost.valid === false || ghost.signal?.valid === false) return null;

  const targetMs = targetMsFor(ghost);
  if (!Number.isFinite(targetMs) || targetMs < market.startMs || targetMs >= market.endMs) {
    return null;
  }

  const key = evidenceKey(ghost);
  if (key !== null && points.some((point) => evidenceKey(point) === key)) return null;
  return ghost;
}

function paddedAxisBound(bounds, edge) {
  if (!Number.isFinite(bounds?.min) || !Number.isFinite(bounds?.max)) {
    return edge === "min" ? 0 : 1;
  }
  const min = new Decimal(bounds.min);
  const max = new Decimal(bounds.max);
  const range = max.minus(min).abs();
  const magnitude = Decimal.max(min.abs(), max.abs(), 1);
  const padding = Decimal.max(range.times("0.08"), magnitude.times("0.00001"), "0.05");
  return (edge === "min" ? min.minus(padding) : max.plus(padding)).toNumber();
}

function lineSeries({ name, data, color, width, type = "solid", z = 3, opacity = 1, hidden = false }) {
  return {
    name,
    type: "line",
    data,
    showSymbol: false,
    symbol: "none",
    smooth: false,
    connectNulls: false,
    animation: false,
    silent: false,
    z,
    lineStyle: {
      color,
      width,
      type,
      opacity,
    },
    itemStyle: { color, opacity },
    emphasis: {
      focus: "series",
      lineStyle: { width: width + 1 },
    },
    selectedMode: hidden ? false : undefined,
  };
}

function thresholdSeries(threshold, market, palette, showEndLabel = true) {
  const raw = {
    ...threshold,
    targetMs: market.startMs,
    thresholdDecimal: threshold.decimal,
    thresholdLabel: threshold.label,
    kind: "threshold",
  };

  return {
    name: threshold.label,
    type: "line",
    data: [
      { value: [market.startMs, threshold.plotValue], raw },
      {
        value: [market.endMs, threshold.plotValue],
        raw: { ...raw, targetMs: market.endMs },
      },
    ],
    showSymbol: false,
    symbol: "none",
    smooth: false,
    connectNulls: false,
    animation: false,
    silent: false,
    z: 1,
    lineStyle: {
      color: palette.threshold,
      width: 1,
      type: "solid",
      opacity: 0.8,
    },
    itemStyle: { color: palette.threshold },
    endLabel: {
      show: showEndLabel,
      formatter: threshold.label,
      color: palette.threshold,
      backgroundColor: palette.panel,
      borderRadius: 3,
      padding: [2, 4],
      fontSize: 10,
      fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
    },
  };
}

function ghostSeries(ghost, metadataByTarget, palette) {
  const datum = lineDatum(ghost, "liveGhost", metadataByTarget.get(targetMsFor(ghost)));
  if (!datum || datum.value[1] === null) return null;
  datum.raw.isLiveGhost = true;

  return {
    name: CHART_SERIES_NAMES.liveGhost,
    type: "scatter",
    data: [datum],
    symbol: "circle",
    symbolSize: 11,
    z: 8,
    itemStyle: {
      color: palette.panel,
      borderColor: palette.projected,
      borderWidth: 2.5,
      shadowBlur: 8,
      shadowColor: "rgba(244, 184, 96, 0.28)",
    },
    emphasis: {
      scale: 1.25,
      itemStyle: {
        color: palette.panel,
        borderColor: palette.text,
        borderWidth: 3,
      },
    },
  };
}

function visibleSeriesDescription({
  actualData,
  futuresData,
  projectedData,
  contextData,
  ghost,
  threshold,
  projectionVisible,
  projectionSeriesName,
}) {
  const descriptions = [];
  if (actualData.some((datum) => datum.value[1] !== null)) descriptions.push("paired actual Chainlink");
  if (futuresData.some((datum) => datum.value[1] !== null)) {
    descriptions.push("target-aligned persisted futures-at-forecast snapshots");
  }
  if (projectionVisible && projectedData.some((datum) => datum.value[1] !== null)) {
    descriptions.push(`dashed ${projectionSeriesName}`);
  }
  if (contextData.some((datum) => datum.value[1] !== null)) descriptions.push("one-second actual context");
  if (ghost) descriptions.push("a hollow live projection marker");
  if (threshold) descriptions.push(threshold.label.toLowerCase());
  return descriptions.length > 0 ? descriptions.join(", ") : "no retained price observations";
}

function ariaDescription(model, market, seriesState) {
  if (model.ariaDescription) return model.ariaDescription;
  const visible = visibleSeriesDescription(seriesState);
  return `Oracle Catch-Up chart for market ${market.marketId ?? "unknown"}, from ${formatUtcWindowTimestamp(
    market.startMs,
  )} through ${formatUtcWindowTimestamp(market.endMs)}. The x-axis is elapsed market time from zero to five minutes. Visible series: ${visible}. Projected values are independent target forecasts, not a predicted continuous path.`;
}

/**
 * Build a complete ECharts option from normalized application data.
 *
 * Expected model shape:
 * {
 *   market: { marketId, marketStartMs, marketEndMs },
 *   shadowSeries: { actual, futures, projected, baseline, points, projectionVisible },
 *   shadowSeries.futures: [{ targetMs, plotValue, futuresAtForecastDecimal,
 *     futuresAtForecastSourceTimestampMs, futuresAtForecastReceivedMs }],
 *   contextualActual: [{ targetMs, plotValue, decimal }],
 *   liveGhost: { targetMs, plotValue, projectedDecimal, generatedMs, horizonMs } | null,
 *   threshold: { plotValue, decimal, label } | null
 * }
 */
export function createCatchupChartOptions(model, runtime = {}) {
  if (!model || typeof model !== "object") {
    throw new TypeError("Catch-up chart options require a normalized model object.");
  }

  const market = resolveMarket(model);
  const shadow = resolveShadowSeries(model);
  const projectionVisible = shadow.projectionVisible !== false;
  const contextualActual = resolveContextualActual(model);
  const threshold = resolveThreshold(model);
  const metadataByTarget = pointMetadataMap(shadow.points);
  const actualData = pointsInsideMarket(
    createLineData(shadow.actual, "actual", metadataByTarget),
    market,
  );
  const futuresData = pointsInsideMarket(
    createLineData(shadow.futures, "futures", metadataByTarget),
    market,
  );
  const projectedData = pointsInsideMarket(
    createLineData(shadow.projected, "projected", metadataByTarget),
    market,
  );
  const baselineData = pointsInsideMarket(
    createLineData(shadow.baseline, "baseline", metadataByTarget),
    market,
  );
  const contextData = pointsInsideMarket(
    createLineData(contextualActual, "contextualActual", metadataByTarget),
    market,
  );
  const ghost = resolveGhost(model, shadow.points, projectionVisible, market);
  const palette = { ...DEFAULT_CHART_PALETTE, ...(runtime.palette ?? model.palette ?? {}) };
  const containerWidth = firstFinite(runtime.containerWidth, model.containerWidth, 900);
  const compact = runtime.compact ?? containerWidth < 680;
  const reducedMotion = runtime.reducedMotion ?? model.reducedMotion ?? false;
  const hasEvaluationTargets = shadow.points.some((point) => {
    const targetMs = targetMsFor(point);
    return Number.isFinite(targetMs) && targetMs >= market.startMs && targetMs < market.endMs;
  });
  const legendSelected = {
    [CHART_SERIES_NAMES.baseline]: false,
    [CHART_SERIES_NAMES.contextualActual]: !hasEvaluationTargets,
    ...(model.legendSelected ?? {}),
    ...(runtime.legendSelected ?? {}),
  };
  const identityLineLabel = shadow.identity?.lineLabel;
  const projectionSeriesName = identityLineLabel
    ? `${identityLineLabel} · projected`
    : CHART_SERIES_NAMES.projected;

  const series = [];
  if (contextData.length > 0) {
    series.push(
      lineSeries({
        name: CHART_SERIES_NAMES.contextualActual,
        data: contextData,
        color: palette.actual,
        width: 1,
        type: [5, 5],
        z: 2,
        opacity: 0.38,
      }),
    );
  }
  series.push(
    lineSeries({
      name: CHART_SERIES_NAMES.actual,
      data: actualData,
      color: palette.actual,
      width: 2.25,
      z: 5,
    }),
  );
  if (futuresData.length > 0) {
    series.push(
      lineSeries({
        name: CHART_SERIES_NAMES.futures,
        data: futuresData,
        color: palette.futures,
        width: 1.75,
        type: [2, 3],
        z: 3,
      }),
    );
  }
  if (projectionVisible) {
    series.push(
      lineSeries({
        name: projectionSeriesName,
        data: projectedData,
        color: palette.projected,
        width: 2,
        type: [8, 5],
        z: 4,
      }),
      lineSeries({
        name: CHART_SERIES_NAMES.baseline,
        data: baselineData,
        color: palette.baseline,
        width: 1.25,
        type: [2, 5],
        z: 2,
        opacity: 0.66,
        hidden: true,
      }),
    );
  }
  if (threshold) series.push(thresholdSeries(threshold, market, palette, !compact));
  const liveGhostSeries = ghostSeries(ghost, metadataByTarget, palette);
  if (liveGhostSeries) series.push(liveGhostSeries);

  const noteTop = 40;
  const noteWidth = Math.max(240, containerWidth - (compact ? 42 : 80));
  const noteLineHeight = compact && containerWidth < 470 ? 15 : 14;
  const chartNotes = [
    projectionVisible ? FORECAST_PATH_NOTE : null,
    futuresData.length > 0 ? FUTURES_PATH_NOTE : null,
  ].filter(Boolean);
  const noteNeedsTwoLines = containerWidth < (futuresData.length > 0 ? 880 : 620);
  const chartTop = chartNotes.length > 0 ? (noteNeedsTwoLines ? 93 : 76) : 62;
  const seriesState = {
    actualData,
    futuresData,
    projectedData,
    contextData: legendSelected[CHART_SERIES_NAMES.contextualActual]
      ? contextData
      : [],
    ghost: liveGhostSeries,
    threshold,
    projectionVisible,
    projectionSeriesName,
  };

  return {
    backgroundColor: "transparent",
    useUTC: true,
    animation: !reducedMotion,
    animationDuration: reducedMotion ? 0 : 260,
    animationDurationUpdate: reducedMotion ? 0 : 180,
    animationEasing: "cubicOut",
    animationEasingUpdate: "cubicOut",
    aria: {
      show: true,
      enabled: true,
      label: {
        enabled: true,
        description: ariaDescription(model, market, seriesState),
      },
      decal: { show: false },
    },
    color: [palette.actual, palette.futures, palette.projected, palette.baseline, palette.threshold],
    grid: {
      top: chartTop,
      right: compact ? 13 : threshold ? 128 : 24,
      bottom: compact ? 18 : 20,
      left: compact ? 10 : 18,
      containLabel: true,
    },
    legend: {
      show: true,
      type: "scroll",
      top: 5,
      left: compact ? 7 : 13,
      right: 10,
      itemWidth: 27,
      itemHeight: 8,
      itemGap: compact ? 12 : 19,
      icon: "roundRect",
      selected: legendSelected,
      pageIconColor: palette.text,
      pageIconInactiveColor: palette.grid,
      pageTextStyle: { color: palette.muted },
      textStyle: {
        color: palette.muted,
        fontSize: 11,
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      },
    },
    graphic: chartNotes.length > 0
      ? [
          {
            type: "text",
            left: compact ? 10 : 16,
            top: noteTop,
            silent: true,
            style: {
              text: chartNotes.join(" "),
              fill: palette.muted,
              opacity: 0.78,
              font: "10.5px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
              width: noteWidth,
              overflow: "break",
              lineHeight: noteLineHeight,
            },
          },
        ]
      : [],
    tooltip: {
      trigger: "axis",
      triggerOn: "mousemove|click",
      confine: true,
      appendToBody: false,
      transitionDuration: reducedMotion ? 0 : 0.12,
      backgroundColor: palette.panelRaised,
      borderColor: palette.grid,
      borderWidth: 1,
      padding: 0,
      extraCssText:
        "border-radius:8px;box-shadow:0 16px 42px rgba(0,0,0,.42);backdrop-filter:blur(8px);",
      textStyle: {
        color: palette.text,
        fontSize: 12,
      },
      formatter: createTooltipFormatter({
        marketId: market.marketId,
        threshold,
      }),
      axisPointer: {
        type: "cross",
        snap: true,
        lineStyle: {
          color: palette.muted,
          type: "dashed",
          width: 1,
          opacity: 0.62,
        },
        crossStyle: {
          color: palette.muted,
          type: "dashed",
          width: 1,
          opacity: 0.55,
        },
        label: {
          show: true,
          color: palette.text,
          backgroundColor: palette.panelRaised,
          borderColor: palette.grid,
          borderWidth: 1,
          formatter(params) {
            return params.axisDimension === "x"
              ? formatElapsed(params.value, market.startMs)
              : formatAxisPrice(params.value);
          },
        },
      },
    },
    xAxis: {
      type: "time",
      min: market.startMs,
      max: market.endMs,
      minInterval: 60_000,
      maxInterval: 60_000,
      splitNumber: 5,
      boundaryGap: false,
      axisLine: {
        show: true,
        lineStyle: { color: palette.grid, width: 1 },
      },
      axisTick: {
        show: true,
        alignWithLabel: true,
        lineStyle: { color: palette.grid },
      },
      axisLabel: {
        color: palette.muted,
        fontSize: 10,
        fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
        margin: 10,
        hideOverlap: true,
        showMinLabel: true,
        showMaxLabel: true,
        formatter(value) {
          return formatElapsed(value, market.startMs);
        },
      },
      splitLine: {
        show: true,
        lineStyle: { color: palette.grid, width: 1, opacity: 0.5 },
      },
      axisPointer: { show: true },
    },
    yAxis: {
      type: "value",
      scale: true,
      min: (bounds) => paddedAxisBound(bounds, "min"),
      max: (bounds) => paddedAxisBound(bounds, "max"),
      splitNumber: compact ? 4 : 5,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: palette.muted,
        fontSize: 10,
        fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
        margin: 10,
        formatter: formatAxisPrice,
      },
      splitLine: {
        show: true,
        lineStyle: { color: palette.grid, width: 1, opacity: 0.62 },
      },
      axisPointer: { show: true },
    },
    series,
  };
}

export default createCatchupChartOptions;
