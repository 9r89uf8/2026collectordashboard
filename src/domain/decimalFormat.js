import Decimal from "decimal.js";

export const EMPTY_DECIMAL_TEXT = "—";

/**
 * Parse only exact string values (or an existing Decimal). Financial API
 * values are strings by contract; accepting a JS number here would make lost
 * precision look authoritative.
 */
export function toDecimalOrNull(value) {
  if (value instanceof Decimal) {
    return value.isFinite() ? new Decimal(value) : null;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  try {
    const decimal = new Decimal(value);
    return decimal.isFinite() ? decimal : null;
  } catch {
    return null;
  }
}

export const parseFinancialDecimal = toDecimalOrNull;

/** Preserve the API's exact spelling while ensuring it is a finite decimal. */
export function decimalStringOrNull(value) {
  return toDecimalOrNull(value) === null ? null : value instanceof Decimal ? value.toString() : value;
}

/** Convert only at the chart boundary, preserving null and rejecting overflow. */
export function financialChartNumber(value) {
  const decimal = toDecimalOrNull(value);
  if (decimal === null) {
    return null;
  }

  const chartNumber = decimal.toNumber();
  return Number.isFinite(chartNumber) ? chartNumber : null;
}

function groupedFixed(decimal, decimalPlaces, grouping) {
  const rounded = decimal.toDecimalPlaces(decimalPlaces, Decimal.ROUND_HALF_UP);
  const unsigned = rounded.abs().toFixed(decimalPlaces);
  const [integerPart, fractionPart] = unsigned.split(".");
  const integer = grouping
    ? integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    : integerPart;
  return fractionPart === undefined ? integer : `${integer}.${fractionPart}`;
}

export function formatDecimal(
  value,
  {
    decimalPlaces = 2,
    grouping = true,
    sign = "negative",
    suffix = "",
    nullText = EMPTY_DECIMAL_TEXT,
  } = {},
) {
  const decimal = toDecimalOrNull(value);
  if (decimal === null || !Number.isInteger(decimalPlaces) || decimalPlaces < 0) {
    return nullText;
  }

  const magnitude = groupedFixed(decimal, decimalPlaces, grouping);
  const signText = decimal.isNegative() && !decimal.isZero() ? "-" : sign === "always" && !decimal.isZero() ? "+" : "";
  return `${signText}${magnitude}${suffix}`;
}

export function formatCurrency(
  value,
  {
    decimalPlaces = 2,
    sign = "negative",
    currencySymbol = "$",
    nullText = EMPTY_DECIMAL_TEXT,
  } = {},
) {
  const decimal = toDecimalOrNull(value);
  if (decimal === null || !Number.isInteger(decimalPlaces) || decimalPlaces < 0) {
    return nullText;
  }

  const magnitude = groupedFixed(decimal, decimalPlaces, true);
  const signText = decimal.isNegative() && !decimal.isZero() ? "-" : sign === "always" && !decimal.isZero() ? "+" : "";
  return `${signText}${currencySymbol}${magnitude}`;
}

export function formatBasisPoints(value, options = {}) {
  return formatDecimal(value, { decimalPlaces: 2, suffix: " bps", ...options });
}

export function subtractDecimals(minuend, subtrahend) {
  const left = toDecimalOrNull(minuend);
  const right = toDecimalOrNull(subtrahend);
  return left === null || right === null ? null : left.minus(right);
}

export function decimalDifferenceString(minuend, subtrahend) {
  return subtractDecimals(minuend, subtrahend)?.toString() ?? null;
}

export function absoluteDecimal(value) {
  return toDecimalOrNull(value)?.abs() ?? null;
}

export function absoluteDecimalString(value) {
  return absoluteDecimal(value)?.toString() ?? null;
}

export function decimalEquals(left, right) {
  const leftDecimal = toDecimalOrNull(left);
  const rightDecimal = toDecimalOrNull(right);
  return leftDecimal !== null && rightDecimal !== null && leftDecimal.equals(rightDecimal);
}

/** Format an unsigned USD magnitude without turning a tiny non-zero value into $0.00. */
export function formatUsdMagnitude(value, { nullText = EMPTY_DECIMAL_TEXT } = {}) {
  const decimal = toDecimalOrNull(value);
  if (decimal === null) return nullText;

  const exact = decimal.abs();
  const rounded = exact.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  if (!exact.isZero() && rounded.isZero()) return "<$0.01";
  return `$${groupedFixed(rounded, 2, true)}`;
}

export function formatRatioMagnitudeAsPercent(value, { nullText = "N/A" } = {}) {
  const decimal = toDecimalOrNull(value);
  if (decimal === null) return nullText;
  return `${groupedFixed(decimal.abs().times(100), 1, true)}%`;
}

export function describeMaeAdvantage(value) {
  const decimal = toDecimalOrNull(value);
  if (decimal === null) return "N/A";
  if (decimal.isZero()) return "Same MAE as no change";
  return `${formatUsdMagnitude(decimal)} ${decimal.isPositive() ? "closer" : "worse"}`;
}

export function describeSkillChange(value) {
  const decimal = toDecimalOrNull(value);
  if (decimal === null) return "N/A — no-change error was zero";
  if (decimal.isZero()) return "Same error as no change";
  return `${formatRatioMagnitudeAsPercent(decimal)} ${decimal.isPositive() ? "lower" : "higher"}`;
}

export const describeMaeChange = describeSkillChange;
export const describeRmseChange = describeSkillChange;

export function describeBias(value) {
  const decimal = toDecimalOrNull(value);
  if (decimal === null) return "N/A";
  if (decimal.isZero()) return "No average signed bias";
  return `${formatUsdMagnitude(decimal)} ${decimal.isPositive() ? "high" : "low"} on average`;
}
