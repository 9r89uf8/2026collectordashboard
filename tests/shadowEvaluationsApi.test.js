import { describe, expect, it } from "vitest";

import { shadowEvaluationsDownloadUrl } from "../src/api/shadowEvaluations.js";

describe("shadowEvaluationsDownloadUrl", () => {
  it("builds the proxy-prefixed ID-addressed download URL", () => {
    expect(
      shadowEvaluationsDownloadUrl(42, "catchup_ratio_l3000_b100"),
    ).toBe(
      "/api/markets/42/shadow-evaluations/download?model_version=catchup_ratio_l3000_b100",
    );
  });

  it("accepts a trimmed non-negative market ID and encodes the model query", () => {
    expect(shadowEvaluationsDownloadUrl(" 42 ", "model version/+"))
      .toBe(
        "/api/markets/42/shadow-evaluations/download?model_version=model+version%2F%2B",
      );
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.MAX_SAFE_INTEGER + 1,
    "",
    "-1",
    "1.5",
    "not-a-market",
    "9007199254740992",
    null,
  ])("rejects invalid market ID %j", (marketId) => {
    expect(() => shadowEvaluationsDownloadUrl(marketId, "model"))
      .toThrow(TypeError);
  });

  it.each([undefined, null, "", "   "])(
    "rejects invalid model version %j",
    (modelVersion) => {
      expect(() => shadowEvaluationsDownloadUrl(42, modelVersion))
        .toThrow(TypeError);
    },
  );
});
