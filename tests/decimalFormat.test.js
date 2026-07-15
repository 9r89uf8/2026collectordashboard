import { describe, expect, it } from "vitest";

import {
  absoluteDecimalString,
  decimalDifferenceString,
  financialChartNumber,
  formatBasisPoints,
  formatCurrency,
  toDecimalOrNull,
} from "../src/domain/decimalFormat.js";

describe("decimalFormat", () => {
  it("keeps null and invalid financial values away from numeric zero", () => {
    expect(financialChartNumber(null)).toBeNull();
    expect(financialChartNumber(undefined)).toBeNull();
    expect(financialChartNumber("not-a-decimal")).toBeNull();
    expect(financialChartNumber(0)).toBeNull();
    expect(financialChartNumber("0")).toBe(0);
  });

  it("does arithmetic with Decimal instead of binary floating point", () => {
    expect(decimalDifferenceString("0.3", "0.2")).toBe("0.1");
    expect(absoluteDecimalString("-19.350000000000000001")).toBe(
      "19.350000000000000001",
    );
    expect(toDecimalOrNull("9007199254740993")?.toString()).toBe("9007199254740993");
  });

  it("formats signed exact strings without routing through Number", () => {
    expect(formatCurrency("64103.075", { sign: "always" })).toBe("+$64,103.08");
    expect(formatCurrency("-19.35")).toBe("-$19.35");
    expect(formatCurrency(null)).toBe("—");
    expect(formatBasisPoints("3.526815580472490292", { sign: "always" })).toBe(
      "+3.53 bps",
    );
  });
});
