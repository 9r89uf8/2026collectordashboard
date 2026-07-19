import { describe, expect, it } from "vitest";

import {
  CHART_SERIES_NAMES,
  DEFAULT_CHART_PALETTE,
  createCatchupChartOptions,
} from "../src/charts/catchupChartOptions.js";

const MARKET_START_MS = Date.UTC(2026, 6, 14, 21, 0, 0);
const MARKET_END_MS = MARKET_START_MS + 300_000;
const IDENTITY_LABEL = "Configured candidate — historical primary unverified";

const scoredPoint = Object.freeze({
  targetMs: MARKET_START_MS + 3_507,
  generatedMs: MARKET_START_MS + 507,
  horizonMs: 3_000,
  modelVersion: "catchup_ratio_l3000_b100",
  projectedDecimal: "64103.0700",
  actualDecimal: "64099.8200",
  futuresAtForecastDecimal: "64110.5000",
  futuresAtForecastSourceTimestampMs: MARKET_START_MS + 420,
  futuresAtForecastReceivedMs: MARKET_START_MS + 475,
  baselineDecimal: "64080.4700",
  forecastErrorDecimal: "3.2500",
  baselineErrorDecimal: "-19.3500",
  valid: true,
  status: "valid",
  key: "catchup_ratio_l3000_b100:507:3000",
});

const invalidPoint = Object.freeze({
  targetMs: MARKET_START_MS + 4_007,
  generatedMs: MARKET_START_MS + 1_007,
  horizonMs: 3_000,
  modelVersion: "catchup_ratio_l3000_b100",
  projectedDecimal: null,
  actualDecimal: "64100.0000",
  futuresAtForecastDecimal: null,
  futuresAtForecastSourceTimestampMs: null,
  futuresAtForecastReceivedMs: null,
  baselineDecimal: null,
  valid: false,
  status: "invalid",
  invalidReasons: ["stale_chainlink"],
});

function linePoint(point, decimalField, plotValue) {
  return {
    mode: "live",
    targetMs: point.targetMs,
    decimal: point[decimalField],
    [decimalField]: point[decimalField],
    futuresAtForecastSourceTimestampMs:
      point.futuresAtForecastSourceTimestampMs,
    futuresAtForecastReceivedMs: point.futuresAtForecastReceivedMs,
    plotValue,
    value: plotValue,
  };
}

function chartModel(overrides = {}) {
  const separator = {
    targetMs: MARKET_START_MS + 4_257,
    plotValue: null,
    value: null,
    decimal: null,
    separator: true,
  };

  return {
    market: {
      marketId: 42,
      marketStartMs: MARKET_START_MS,
      marketEndMs: MARKET_END_MS,
    },
    shadowSeries: {
      actual: [
        linePoint(scoredPoint, "actualDecimal", 64_099.82),
        linePoint(invalidPoint, "actualDecimal", 64_100),
        separator,
        // The chart layer also enforces the half-open target boundary.
        { targetMs: MARKET_END_MS, decimal: "99999", plotValue: 99_999, value: 99_999 },
      ],
      futures: [
        linePoint(scoredPoint, "futuresAtForecastDecimal", 64_110.5),
        linePoint(invalidPoint, "futuresAtForecastDecimal", null),
        separator,
      ],
      projected: [
        linePoint(scoredPoint, "projectedDecimal", 64_103.07),
        linePoint(invalidPoint, "projectedDecimal", null),
        separator,
      ],
      baseline: [
        linePoint(scoredPoint, "baselineDecimal", 64_080.47),
        linePoint(invalidPoint, "baselineDecimal", null),
        separator,
      ],
      points: [scoredPoint, invalidPoint],
      projectionVisible: true,
      identity: {
        lineLabel: IDENTITY_LABEL,
        projectionVisible: true,
      },
      ghost: {
        targetMs: MARKET_START_MS + 5_507,
        generatedMs: MARKET_START_MS + 2_507,
        horizonMs: 3_000,
        modelVersion: "catchup_ratio_l3000_b100",
        projectedDecimal: "64104.1250",
        plotValue: 64_104.125,
        value: 64_104.125,
        valid: true,
        key: "catchup_ratio_l3000_b100:future:3000",
      },
      threshold: {
        label: "Official market open",
        decimal: "64090.0000",
        plotValue: 64_090,
      },
      series: { contextualActual: [] },
    },
    // This legacy browser-derived input must never override persisted
    // futures-at-forecast evidence from shadowSeries.
    futuresAtTargets: [
      {
        targetMs: scoredPoint.targetMs,
        futuresDecimal: "99999.0000",
        plotValue: 99_999,
        value: 99_999,
      },
    ],
    ...overrides,
  };
}

function namedSeries(options, name) {
  return options.series.find((series) => series.name === name);
}

describe("createCatchupChartOptions", () => {
  it("locks the elapsed time axis to the exact half-open five-minute window", () => {
    const options = createCatchupChartOptions(chartModel());
    const actual = namedSeries(options, CHART_SERIES_NAMES.actual);

    expect(options.xAxis).toMatchObject({
      type: "time",
      min: MARKET_START_MS,
      max: MARKET_END_MS,
      minInterval: 60_000,
      maxInterval: 60_000,
    });
    expect(options.xAxis.axisLabel.formatter(MARKET_START_MS)).toBe("00:00");
    expect(options.xAxis.axisLabel.formatter(MARKET_END_MS)).toBe("05:00");
    expect(actual.data.every((datum) => datum.value[0] < MARKET_END_MS)).toBe(true);
  });

  it("keeps target-aligned price lines unsmoothed and disconnected across null gaps", () => {
    const options = createCatchupChartOptions(chartModel());
    const projected = options.series.find((series) => series.name.includes(IDENTITY_LABEL));
    const actual = namedSeries(options, CHART_SERIES_NAMES.actual);
    const futures = namedSeries(options, CHART_SERIES_NAMES.futures);
    const baseline = namedSeries(options, CHART_SERIES_NAMES.baseline);

    for (const series of [actual, futures, projected, baseline]) {
      expect(series).toMatchObject({
        type: "line",
        showSymbol: false,
        smooth: false,
        connectNulls: false,
      });
    }
    expect(projected.data[0].value[0]).toBe(scoredPoint.targetMs);
    expect(projected.data[0].value[0]).not.toBe(scoredPoint.generatedMs);
    expect(futures.data[0].value[0]).toBe(scoredPoint.targetMs);
    expect(projected.data.filter((datum) => datum.value[1] === null)).toHaveLength(2);
    expect(futures.data.filter((datum) => datum.value[1] === null)).toHaveLength(2);
  });

  it("formats tooltip evidence from the retained decimal strings", () => {
    const options = createCatchupChartOptions(chartModel());
    const projected = options.series.find((series) => series.name.includes(IDENTITY_LABEL));
    const actual = namedSeries(options, CHART_SERIES_NAMES.actual);
    const futures = namedSeries(options, CHART_SERIES_NAMES.futures);
    const tooltip = options.tooltip.formatter([
      { data: projected.data[0] },
      { data: actual.data[0] },
      { data: futures.data[0] },
    ]);

    expect(tooltip).toContain("21:00:03.507 UTC");
    expect(tooltip).toContain("$64,103.07");
    expect(tooltip).toContain("$64,099.82");
    expect(tooltip).toContain("Futures at forecast");
    expect(tooltip).toContain("$64,110.50");
    expect(tooltip).toContain("Forecast generated");
    expect(tooltip).toContain("21:00:00.507 UTC");
    expect(tooltip).toContain("Futures source timestamp");
    expect(tooltip).toContain("87 ms before generated");
    expect(tooltip).toContain("Futures received timestamp");
    expect(tooltip).toContain("32 ms before generated");
    expect(tooltip).toContain("chart-tooltip__row--wrap");
    expect(tooltip).toContain("+$3.25");
    expect(tooltip).toContain("−$19.35");
    expect(tooltip).toContain("3.0 seconds earlier");
  });

  it("renders a single unconnected hollow live ghost and enables chart ARIA", () => {
    const options = createCatchupChartOptions(chartModel());
    const ghost = namedSeries(options, CHART_SERIES_NAMES.liveGhost);

    expect(ghost).toMatchObject({
      type: "scatter",
      symbol: "circle",
    });
    expect(ghost.data).toHaveLength(1);
    expect(ghost.itemStyle.color).toBe(DEFAULT_CHART_PALETTE.panel);
    expect(ghost.itemStyle.borderColor).toBe(DEFAULT_CHART_PALETTE.projected);
    expect(ghost.itemStyle.borderWidth).toBeGreaterThan(0);
    expect(options.aria.show).toBe(true);
    expect(options.aria.label.description).toContain("hollow live projection marker");
    expect(options.aria.label.description).toContain(
      "target-aligned persisted futures-at-forecast snapshots",
    );
  });

  it("styles persisted forecast futures distinctly and ignores legacy live futures input", () => {
    const options = createCatchupChartOptions(chartModel());
    const futures = namedSeries(options, CHART_SERIES_NAMES.futures);

    expect(futures.lineStyle.color).toBe(DEFAULT_CHART_PALETTE.futures);
    expect(futures.lineStyle.type).toEqual([2, 3]);
    expect(futures.data[0].raw.futuresAtForecastDecimal).toBe("64110.5000");
    expect(futures.data[0].value[1]).toBe(64_110.5);
    expect(futures.data[0].value[1]).not.toBe(99_999);
    expect(options.graphic[0].style.text).toContain("persisted futures snapshots");
  });

  it("hides the baseline by default and labels historical projection identity honestly", () => {
    const options = createCatchupChartOptions(chartModel());
    const projected = options.series.find((series) => series.name.includes(IDENTITY_LABEL));

    expect(options.legend.selected[CHART_SERIES_NAMES.baseline]).toBe(false);
    expect(options.legend.selected[CHART_SERIES_NAMES.contextualActual]).toBe(false);
    expect(projected.name).toBe(`${IDENTITY_LABEL} · projected`);
    expect(projected.lineStyle.type).toEqual([8, 5]);
  });

  it("shows one-second context only as the default fallback when paired actual is absent", () => {
    const model = chartModel();
    model.shadowSeries.actual = [];
    model.shadowSeries.futures = [];
    model.shadowSeries.projected = [];
    model.shadowSeries.baseline = [];
    model.shadowSeries.points = [];
    model.contextualActual = [
      {
        targetMs: scoredPoint.targetMs,
        actualDecimal: scoredPoint.actualDecimal,
        decimal: scoredPoint.actualDecimal,
        plotValue: 64_099.82,
        value: 64_099.82,
      },
    ];

    const options = createCatchupChartOptions(model);

    expect(options.legend.selected[CHART_SERIES_NAMES.contextualActual]).toBe(true);
    expect(namedSeries(options, CHART_SERIES_NAMES.contextualActual)).toBeDefined();
  });

  it("keeps context hidden when evaluation targets exist but paired actual is null", () => {
    const model = chartModel();
    model.shadowSeries.actual = [
      linePoint({ ...scoredPoint, actualDecimal: null }, "actualDecimal", null),
    ];
    model.contextualActual = [
      {
        targetMs: scoredPoint.targetMs,
        actualDecimal: scoredPoint.actualDecimal,
        decimal: scoredPoint.actualDecimal,
        plotValue: 64_099.82,
        value: 64_099.82,
      },
    ];

    const options = createCatchupChartOptions(model);
    expect(options.legend.selected[CHART_SERIES_NAMES.contextualActual]).toBe(false);
  });

  it("shows persisted futures and forecast-time tooltip evidence in Recent mode", () => {
    const model = chartModel({ mode: "recent" });
    const options = createCatchupChartOptions(model);
    const projected = options.series.find((series) => series.name.includes(IDENTITY_LABEL));
    const futures = namedSeries(options, CHART_SERIES_NAMES.futures);
    const tooltip = options.tooltip.formatter([
      { data: projected.data[0] },
      { data: futures.data[0] },
    ]);

    expect(futures).toBeDefined();
    expect(tooltip).toContain("Futures at forecast");
    expect(tooltip).toContain("32 ms before generated");
    expect(options.graphic[0].style.text).toContain("persisted futures snapshots");
  });

  it("fails closed by omitting projections, baseline, and ghost", () => {
    const model = chartModel();
    model.shadowSeries.projectionVisible = false;
    model.shadowSeries.identity.projectionVisible = false;
    const options = createCatchupChartOptions(model);
    const names = options.series.map((series) => series.name);

    expect(names).not.toContain(CHART_SERIES_NAMES.baseline);
    expect(names).not.toContain(CHART_SERIES_NAMES.liveGhost);
    expect(names.some((name) => name.includes("projected"))).toBe(false);
    expect(names).toContain(CHART_SERIES_NAMES.actual);
    expect(names).toContain(CHART_SERIES_NAMES.futures);
  });
});
