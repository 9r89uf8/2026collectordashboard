import { describe, expect, it } from "vitest";

import {
  HISTORICAL_UNVERIFIED_LABEL,
  VERIFIED_PRIMARY_LABEL,
  buildShadowSeries,
  chooseOpeningThreshold,
  deriveLiveGhost,
  normalizeContextActualSeries,
  normalizeLiveActual,
  validateProjectionIdentity,
} from "../src/domain/shadowSeries.js";
import {
  ARTIFACT,
  COMPLETED_EVALUATIONS,
  FINGERPRINT,
  LIVE_PAYLOAD,
  MARKET,
  MODEL_VERSION,
  OTHER_ARTIFACT,
  OTHER_FINGERPRINT,
  evaluationAttempt,
} from "./fixtures/shadowEvaluations.js";

const configured = { configuredModelVersion: MODEL_VERSION };

describe("buildShadowSeries", () => {
  it("aligns projected and paired actual values at target_ms", () => {
    const result = buildShadowSeries(COMPLETED_EVALUATIONS, configured);
    const firstProjection = result.projected.find((point) => !point.separator);
    const firstActual = result.actual.find((point) => !point.separator);

    expect(firstProjection.targetMs).toBe(1_000_000);
    expect(firstProjection.targetMs).not.toBe(997_000);
    expect(firstActual.targetMs).toBe(firstProjection.targetMs);
    expect(firstProjection.decimal).toBe("64103.07");
    expect(firstActual.decimal).toBe("64099.82");
  });

  it("uses persisted forecast-time futures at target_ms and ignores a conflicting live map", () => {
    const evaluations = {
      ...COMPLETED_EVALUATIONS,
      points: COMPLETED_EVALUATIONS.points.map((point, index) =>
        index === 0
          ? {
              ...point,
              futures_at_forecast: "64121.3000",
              // Provider event clocks are metadata, not the causal receipt
              // boundary, so a source timestamp after generation is retained.
              futures_at_forecast_source_timestamp_ms: point.generated_ms + 100,
              futures_at_forecast_received_ms: point.generated_ms - 50,
            }
          : index === 1
            ? {
                ...point,
                futures_at_forecast: "not-a-decimal",
                futures_at_forecast_source_timestamp_ms: point.generated_ms - 100,
                futures_at_forecast_received_ms: point.generated_ms - 50,
              }
            : {
                ...point,
                futures_at_forecast: null,
                futures_at_forecast_source_timestamp_ms: null,
                futures_at_forecast_received_ms: null,
              },
      ),
    };
    const result = buildShadowSeries(evaluations, {
      ...configured,
      futuresByTargetMs: {
        "1000000": {
          decimal: "99999.0000",
          receivedMs: 1_000_000,
          sourceTimestampMs: 999_990,
        },
      },
    });
    const first = result.futures.find((point) => point.targetMs === 1_000_000);
    const malformed = result.futures.find((point) => point.targetMs === 1_000_500);
    const normalized = result.points.find((point) => point.targetMs === 1_000_000);

    expect(first).toMatchObject({
      targetMs: 1_000_000,
      futuresAtForecastDecimal: "64121.3000",
      futuresAtForecastSourceTimestampMs: 997_100,
      futuresAtForecastReceivedMs: 996_950,
      plotValue: 64_121.3,
      missing: false,
    });
    expect(normalized).toMatchObject({
      futuresAtForecastDecimal: "64121.3000",
      futuresAtForecastSourceTimestampMs: 997_100,
      futuresAtForecastReceivedMs: 996_950,
    });
    expect(first.decimal).not.toBe("99999.0000");
    expect(malformed).toMatchObject({ plotValue: null, missing: true });
    expect(result.futures.filter((point) => point.separator)).toHaveLength(1);
    expect(result.stats).toMatchObject({ futuresMatched: 1, futuresMissing: 3 });
  });

  it("renders gaps for incomplete, malformed, or future-received persisted futures", () => {
    const generatedMs = COMPLETED_EVALUATIONS.points[0].generated_ms;
    const invalidObservations = [
      {
        futures_at_forecast: null,
        futures_at_forecast_source_timestamp_ms: null,
        futures_at_forecast_received_ms: null,
      },
      {
        futures_at_forecast: "64121.30",
        futures_at_forecast_source_timestamp_ms: null,
        futures_at_forecast_received_ms: generatedMs - 25,
      },
      {
        futures_at_forecast: "64121.30",
        futures_at_forecast_source_timestamp_ms: -1,
        futures_at_forecast_received_ms: generatedMs - 25,
      },
      {
        futures_at_forecast: "64121.30",
        futures_at_forecast_source_timestamp_ms: generatedMs - 50,
        futures_at_forecast_received_ms: null,
      },
      {
        futures_at_forecast: "64121.30",
        futures_at_forecast_source_timestamp_ms: generatedMs - 50,
        futures_at_forecast_received_ms: generatedMs + 1,
      },
      {
        futures_at_forecast: "0",
        futures_at_forecast_source_timestamp_ms: generatedMs - 50,
        futures_at_forecast_received_ms: generatedMs - 25,
      },
    ];

    for (const observation of invalidObservations) {
      const evaluations = {
        ...COMPLETED_EVALUATIONS,
        points: COMPLETED_EVALUATIONS.points.map((point, index) => ({
          ...point,
          ...(index === 0
            ? observation
            : {
                futures_at_forecast: null,
                futures_at_forecast_source_timestamp_ms: null,
                futures_at_forecast_received_ms: null,
              }),
        })),
      };

      const result = buildShadowSeries(evaluations, configured);
      const first = result.futures.find((point) => point.targetMs === 1_000_000);

      expect(first).toMatchObject({
        decimal: null,
        plotValue: null,
        missing: true,
        futuresAtForecastSourceTimestampMs: null,
        futuresAtForecastReceivedMs: null,
      });
    }
  });

  it("keeps a boundary-crossing target and excludes target == market_end_ms", () => {
    const result = buildShadowSeries(COMPLETED_EVALUATIONS, configured);
    expect(result.points[0].generatedMs).toBeLessThan(MARKET.market_start_ms);
    expect(result.points[0].targetMs).toBe(MARKET.market_start_ms);
    expect(result.points.some((point) => point.targetMs === MARKET.market_end_ms)).toBe(false);
    expect(result.stats.outOfWindow).toBe(1);
  });

  it("breaks an invalid projection and keeps valid-without-actual unscored", () => {
    const result = buildShadowSeries(COMPLETED_EVALUATIONS, configured);
    const invalid = result.points.find((point) => point.valid === false);
    const unscored = result.points.find(
      (point) => point.valid && point.actualDecimal === null,
    );

    expect(invalid.projectedDecimal).toBeNull();
    expect(invalid.projectedPlotValue).toBeNull();
    expect(unscored.projectedDecimal).toBe("64106.00");
    expect(unscored.actualPlotValue).toBeNull();
    expect(unscored.scored).toBe(false);
    expect(result.stats.validWithoutActual).toBe(1);
  });

  it("inserts a separator for missing generation buckets without a fake attempt", () => {
    const result = buildShadowSeries(COMPLETED_EVALUATIONS, configured);
    expect(result.points).toHaveLength(4);
    expect(result.separators).toHaveLength(1);
    expect(result.separators[0]).toMatchObject({
      missingBucketCount: 1,
      reason: "unobserved-retained-bucket",
    });
    expect(result.separators[0].targetMs).toBeGreaterThan(1_001_000);
    expect(result.separators[0].targetMs).toBeLessThan(1_002_000);
    expect(result.actual.filter((point) => point.separator)).toHaveLength(1);
    expect(result.projected.filter((point) => point.separator)).toHaveLength(1);
    expect(result.baseline.filter((point) => point.separator)).toHaveLength(1);
    expect(result.stats.attempts).toBe(4);
  });

  it("keeps exact decimal strings beside null-safe chart copies", () => {
    const result = buildShadowSeries(COMPLETED_EVALUATIONS, configured);
    expect(result.points[0]).toMatchObject({
      projectedDecimal: "64103.07",
      projectedPlotValue: 64103.07,
      forecastErrorDecimal: "3.25",
      absoluteErrorDecimal: "3.25",
    });
    expect(result.points[2].actualPlotValue).toBeNull();
  });

  it("rejects a row whose declared target disagrees with generated + horizon", () => {
    const response = structuredClone(COMPLETED_EVALUATIONS);
    response.points[0].target_ms += 1;
    const result = buildShadowSeries(response, configured);
    expect(result.stats.malformed).toBe(1);
    expect(result.points.some((point) => point.generatedMs === 997_000)).toBe(false);
  });

  it("uses generation buckets rather than exact target spacing", () => {
    const response = structuredClone(COMPLETED_EVALUATIONS);
    response.points = [
      evaluationAttempt({ generated_ms: 997_001 }),
      evaluationAttempt({ generated_ms: 997_999 }),
    ];
    const result = buildShadowSeries(response, configured);
    expect(result.points[1].targetMs - result.points[0].targetMs).toBe(998);
    expect(result.separators).toHaveLength(0);
  });
});

describe("projection identity", () => {
  it("labels coherent history as unverified without current live evidence", () => {
    const identity = validateProjectionIdentity(COMPLETED_EVALUATIONS, configured);
    expect(identity.projectionVisible).toBe(true);
    expect(identity.verifiedPrimary).toBe(false);
    expect(identity.lineLabel).toBe(HISTORICAL_UNVERIFIED_LABEL);
  });

  it("calls the line primary only when live model and both hashes match", () => {
    const identity = validateProjectionIdentity(COMPLETED_EVALUATIONS, {
      ...configured,
      livePayload: LIVE_PAYLOAD,
      isCurrentMarket: true,
    });
    expect(identity).toMatchObject({
      projectionVisible: true,
      verifiedPrimary: true,
      lineLabel: VERIFIED_PRIMARY_LABEL,
      code: "verified-primary",
    });
  });

  it("fails closed on configured/live model mismatch", () => {
    const livePayload = structuredClone(LIVE_PAYLOAD);
    livePayload.signals.chainlink_catchup.model_version = "catchup_ratio_l3500_b100";
    const result = buildShadowSeries(COMPLETED_EVALUATIONS, {
      ...configured,
      livePayload,
      isCurrentMarket: true,
    });

    expect(result.projectionVisible).toBe(false);
    expect(result.identity.code).toBe("configured-live-model-mismatch");
    expect(result.projected.every((point) => point.plotValue === null)).toBe(true);
    expect(result.baseline.every((point) => point.plotValue === null)).toBe(true);
    expect(result.actual.some((point) => point.plotValue !== null)).toBe(true);
    expect(result.ghost).toBeNull();
  });

  it("fails closed when one market contains more than one identity", () => {
    const response = structuredClone(COMPLETED_EVALUATIONS);
    response.model.selection_identities.push({
      fingerprint_sha256: OTHER_FINGERPRINT,
      artifact_sha256: OTHER_ARTIFACT,
    });
    response.points[1].selection_fingerprint_sha256 = OTHER_FINGERPRINT;
    response.points[1].selection_artifact_sha256 = OTHER_ARTIFACT;

    const result = buildShadowSeries(response, configured);
    expect(result.identity.code).toBe("selection-change");
    expect(result.projectionVisible).toBe(false);
    expect(result.projected.every((point) => point.plotValue === null)).toBe(true);
  });

  it("fails current history closed when either live identity component differs", () => {
    const livePayload = structuredClone(LIVE_PAYLOAD);
    livePayload.signals.chainlink_catchup.selection_artifact_sha256 = OTHER_ARTIFACT;
    const identity = validateProjectionIdentity(COMPLETED_EVALUATIONS, {
      ...configured,
      livePayload,
      isCurrentMarket: true,
    });
    expect(identity).toMatchObject({
      projectionVisible: false,
      code: "current-selection-identity-mismatch",
    });
  });

  it("shows a coherent older identity only as a historical unverified candidate", () => {
    const response = structuredClone(COMPLETED_EVALUATIONS);
    response.market.market_id = 41;
    response.model.selection_identities[0] = {
      fingerprint_sha256: OTHER_FINGERPRINT,
      artifact_sha256: OTHER_ARTIFACT,
    };
    for (const point of response.points) {
      point.selection_fingerprint_sha256 = OTHER_FINGERPRINT;
      point.selection_artifact_sha256 = OTHER_ARTIFACT;
    }
    const identity = validateProjectionIdentity(response, {
      ...configured,
      livePayload: LIVE_PAYLOAD,
      isCurrentMarket: false,
    });
    expect(identity).toMatchObject({
      projectionVisible: true,
      verifiedPrimary: false,
      code: "historical-primary-unverified",
      lineLabel: HISTORICAL_UNVERIFIED_LABEL,
    });
  });
});

describe("live ghost", () => {
  it("derives the future target and keeps the marker unconnected", () => {
    const ghost = deriveLiveGhost(LIVE_PAYLOAD, {
      market: MARKET,
      configuredModelVersion: MODEL_VERSION,
      maturedPoints: COMPLETED_EVALUATIONS.points,
    });
    expect(ghost).toMatchObject({
      generatedMs: 1_003_000,
      horizonMs: 3_000,
      targetMs: 1_006_000,
      projectedDecimal: "64108.25",
      unconnected: true,
    });
  });

  it("removes null, invalid, out-of-window, or malformed ghosts", () => {
    expect(
      deriveLiveGhost({ ...LIVE_PAYLOAD, signals: { chainlink_catchup: null } }, {
        market: MARKET,
        configuredModelVersion: MODEL_VERSION,
      }),
    ).toBeNull();

    const invalid = structuredClone(LIVE_PAYLOAD);
    invalid.signals.chainlink_catchup.valid = false;
    expect(
      deriveLiveGhost(invalid, { market: MARKET, configuredModelVersion: MODEL_VERSION }),
    ).toBeNull();

    const outside = structuredClone(LIVE_PAYLOAD);
    outside.signals.chainlink_catchup.generated_ms = MARKET.market_end_ms - 1_000;
    expect(
      deriveLiveGhost(outside, { market: MARKET, configuredModelVersion: MODEL_VERSION }),
    ).toBeNull();
  });

  it("deduplicates the ghost after its exact matured record appears", () => {
    const matured = evaluationAttempt({
      generated_ms: 1_003_000,
      target_ms: 1_006_000,
      horizon_ms: 3_000,
    });
    expect(
      deriveLiveGhost(LIVE_PAYLOAD, {
        market: MARKET,
        configuredModelVersion: MODEL_VERSION,
        maturedPoints: [matured],
      }),
    ).toBeNull();
  });
});

describe("actual context", () => {
  it("normalizes one-second actuals and preserves observation gaps", () => {
    const context = normalizeContextActualSeries(
      {
        market: MARKET,
        points: [
          { timestamp_ms: 1_000_000, chainlink: { value: "64080.47" } },
          { timestamp_ms: 1_001_000, chainlink: { value: null } },
          { timestamp_ms: MARKET.market_end_ms, chainlink: { value: "99999" } },
        ],
      },
      MARKET,
    );
    expect(context).toHaveLength(2);
    expect(context[0]).toMatchObject({ decimal: "64080.47", plotValue: 64080.47 });
    expect(context[1]).toMatchObject({ decimal: null, plotValue: null, missing: true });
  });

  it("prioritizes the official open and labels an observed fallback honestly", () => {
    const sources = {
      sources: [{ provider: "polymarket_chainlink_rtds", open: "64070.10" }],
    };
    expect(
      chooseOpeningThreshold(
        { market: { chainlink_resolution: { open: "64075.25" } } },
        sources,
      ),
    ).toMatchObject({ kind: "official", label: "Official market open", decimal: "64075.25" });
    expect(chooseOpeningThreshold({ market: {} }, sources)).toMatchObject({
      kind: "observed",
      label: "Observed window open",
      decimal: "64070.10",
    });
  });

  it("distinguishes a successful missing actual from stale and fresh values", () => {
    expect(normalizeLiveActual({ prices: { chainlink: { value: null } } }).status).toBe(
      "unavailable",
    );
    expect(normalizeLiveActual(LIVE_PAYLOAD).status).toBe("live");

    const stale = structuredClone(LIVE_PAYLOAD);
    stale.prices.chainlink.source_age_ms = 5_001;
    expect(normalizeLiveActual(stale).status).toBe("stale");
  });
});
