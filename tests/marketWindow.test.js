import { describe, expect, it } from "vitest";

import {
  MARKET_WINDOW_DURATION_MS,
  evaluationTargetMs,
  formatElapsedTime,
  isFiveMinuteMarketWindow,
  liveForecastTargetMs,
  normalizeMarketWindow,
  targetBelongsToMarket,
} from "../src/domain/marketWindow.js";
import { MARKET } from "./fixtures/shadowEvaluations.js";

describe("marketWindow", () => {
  it("normalizes the fixed five-minute window", () => {
    const market = normalizeMarketWindow(MARKET);
    expect(market).toMatchObject({
      marketId: 42,
      marketStartMs: 1_000_000,
      marketEndMs: 1_300_000,
      durationMs: MARKET_WINDOW_DURATION_MS,
    });
    expect(isFiveMinuteMarketWindow(market)).toBe(true);
  });

  it("uses a half-open target-time boundary", () => {
    expect(targetBelongsToMarket(MARKET.market_start_ms, MARKET)).toBe(true);
    expect(targetBelongsToMarket(MARKET.market_end_ms - 1, MARKET)).toBe(true);
    expect(targetBelongsToMarket(MARKET.market_end_ms, MARKET)).toBe(false);
    expect(targetBelongsToMarket(MARKET.market_start_ms - 1, MARKET)).toBe(false);
  });

  it("allows a preceding-market generation to target the selected market", () => {
    const point = { generated_ms: 997_000, target_ms: 1_000_000, horizon_ms: 3_000 };
    expect(point.generated_ms).toBeLessThan(MARKET.market_start_ms);
    expect(targetBelongsToMarket(point, MARKET)).toBe(true);
  });

  it("reads an evaluation target instead of substituting generation time", () => {
    expect(evaluationTargetMs({ generated_ms: 997_000, target_ms: 1_000_000 })).toBe(
      1_000_000,
    );
  });

  it("derives only a live ghost target from generated time plus horizon", () => {
    expect(liveForecastTargetMs({ generated_ms: 1_003_000, horizon_ms: 3_000 })).toBe(
      1_006_000,
    );
    expect(liveForecastTargetMs({ generated_ms: 1_003_000, horizon_ms: 0 })).toBeNull();
  });

  it("formats elapsed axis boundaries through 05:00", () => {
    expect(formatElapsedTime(MARKET.market_start_ms, MARKET)).toBe("00:00");
    expect(formatElapsedTime(MARKET.market_end_ms, MARKET)).toBe("05:00");
  });

  it("fails closed for malformed or string-coerced timestamps", () => {
    expect(normalizeMarketWindow({ market_start_ms: "1000", market_end_ms: 301_000 })).toBeNull();
    expect(targetBelongsToMarket("1000000", MARKET)).toBe(false);
  });
});
