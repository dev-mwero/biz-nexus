/**
 * Money and quantity arithmetic for sales documents.
 *
 * ADR-0008: a sales amount is an integer number of the currency's minor unit.
 * `1250` is `$12.50` in USD and `¥1250` in JPY. Nothing in this module returns
 * a floating-point value except `fromMinorUnits`, which exists for display and
 * is never an input to arithmetic.
 *
 * The two rules that matter:
 *
 * 1. Round only at the points named here — line subtotal and line tax. Document
 *    totals are the sum of already-rounded lines. A second rounding pass is how
 *    two systems that agree on every line disagree on the total.
 * 2. Intermediate products use `BigInt`. `unitPriceMinor × quantityMilli` can
 *    exceed `Number.MAX_SAFE_INTEGER` even when the final minor-unit amount is
 *    safe, and the loss happens before the division if the product is a
 *    `Number`.
 */

export type CurrencyCode = string;

/** A quotation or order may have at most this many lines. */
export const MAX_LINE_ITEMS = 100;

/**
 * Caps are chosen so a maximally sized document stays inside
 * `Number.MAX_SAFE_INTEGER`:
 *
 *   100 lines × 2 × (1e8 minor × 1e8 milli / 1000) = 2e15
 *
 * The exact ceiling is a little over 9e15. These are abuse limits, not a
 * statement about what a real quote contains: 1e8 minor units is one million
 * dollars in a two-decimal currency, and 1e8 quantityMilli is one hundred
 * thousand units.
 */
export const MAX_UNIT_PRICE_MINOR = 100_000_000;
export const MAX_QUANTITY_MILLI = 100_000_000;
export const MAX_TAX_RATE_BPS = 10_000;

/** Raised for a value that cannot be represented exactly. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

const ZERO_DIGIT_CURRENCIES = new Set([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "ISK",
  "JPY",
  "KMF",
  "KRW",
  "PYG",
  "RWF",
  "UGX",
  "UYI",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

const THREE_DIGIT_CURRENCIES = new Set([
  "BHD",
  "IQD",
  "JOD",
  "KWD",
  "LYD",
  "OMR",
  "TND",
]);

const FOUR_DIGIT_CURRENCIES = new Set(["CLF", "UYW"]);

/**
 * How many decimal places the currency has.
 *
 * An unknown three-letter code is treated as two decimals rather than throwing.
 * A tenant may already hold a code this table does not name, and a read must
 * not fail because of it. A malformed code is a different case: it cannot be a
 * currency, so it is an error.
 */
export function minorUnitDigits(currency: CurrencyCode): 0 | 2 | 3 | 4 {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    throw new MoneyError("A currency must be a three-letter ISO 4217 code.");
  }
  if (ZERO_DIGIT_CURRENCIES.has(code)) return 0;
  if (THREE_DIGIT_CURRENCIES.has(code)) return 3;
  if (FOUR_DIGIT_CURRENCIES.has(code)) return 4;
  return 2;
}

interface ParsedDecimal {
  negative: boolean;
  whole: string;
  fraction: string;
}

/**
 * Parse a plain decimal string.
 *
 * Exponents, separators, whitespace and signs other than a leading `-` are
 * rejected. `Number("1e3")` is 1000 and `Number(" 1 ")` is 1; accepting either
 * would make a malformed amount look like a valid one.
 */
function parseDecimal(value: string | number, label: string): ParsedDecimal {
  const text = typeof value === "number" ? String(value) : value;

  if (!/^-?\d+(?:\.\d+)?$/.test(text)) {
    throw new MoneyError(`${label} must be a plain decimal number.`);
  }

  const negative = text.startsWith("-");
  const unsigned = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = unsigned.split(".");

  if (negative && Number(whole) === 0 && Number(fraction) === 0) {
    throw new MoneyError(`${label} must not be negative zero.`);
  }

  return { negative, whole, fraction };
}

/** Multiply by a power of ten without touching floating point. */
function pow10(exponent: number): bigint {
  return BigInt(10) ** BigInt(exponent);
}

function toSafeNumber(value: bigint, label: string): number {
  if (
    value < BigInt(Number.MIN_SAFE_INTEGER) ||
    value > BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    throw new MoneyError(`${label} is too large to represent exactly.`);
  }
  return Number(value);
}

function assertInteger(
  value: number,
  label: string,
  min: number,
  max: number,
): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a safe integer.`);
  }
  if (value < min || value > max) {
    throw new MoneyError(`${label} is out of range.`);
  }
}

/**
 * Convert a decimal amount in major units to integer minor units.
 *
 * This is a boundary function. It is used when a human or an import supplies a
 * decimal amount, and it refuses to discard precision: `"1.234"` in USD is an
 * error, not `1.23`, because rounding here would be indistinguishable from a
 * typo.
 */
export function toMinorUnits(
  amount: string | number,
  currency: CurrencyCode,
): number {
  const digits = minorUnitDigits(currency);
  const parsed = parseDecimal(amount, "Amount");

  if (parsed.fraction.length > digits) {
    throw new MoneyError(
      `An amount in ${currency.toUpperCase()} has at most ${digits} decimal place(s).`,
    );
  }

  const fraction = parsed.fraction.padEnd(digits, "0");
  const magnitude =
    BigInt(parsed.whole) * pow10(digits) + BigInt(fraction || "0");

  return toSafeNumber(parsed.negative ? -magnitude : magnitude, "Amount");
}

/**
 * Convert integer minor units to a major-unit number.
 *
 * Display only. The returned value is a `Number`, so feeding it back into a
 * calculation reintroduces the floating-point problem this module exists to
 * avoid.
 */
export function fromMinorUnits(minor: number, currency: CurrencyCode): number {
  assertInteger(
    minor,
    "Minor amount",
    -Number.MAX_SAFE_INTEGER,
    Number.MAX_SAFE_INTEGER,
  );
  return minor / 10 ** minorUnitDigits(currency);
}

/**
 * Divide and round half-up, for non-negative values.
 *
 * `(numerator + denominator / 2) / denominator` is half-up for non-negative
 * integers. Ties go away from zero, which is what a customer expects when a
 * fraction of a minor unit is exactly one half.
 */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (numerator < BigInt(0)) {
    throw new MoneyError("Rounding is defined for non-negative values only.");
  }
  if (denominator <= BigInt(0)) {
    throw new MoneyError("A rounding denominator must be positive.");
  }
  return (numerator + denominator / BigInt(2)) / denominator;
}

/**
 * Parse a decimal quantity into integer thousandths.
 *
 * `1.5` becomes `1500`; `0.001` becomes `1`. More than three decimal places is
 * an error because the stored representation cannot hold it. The API never
 * accepts a float quantity.
 */
export function toQuantityMilli(input: string | number): number {
  const parsed = parseDecimal(input, "Quantity");

  if (parsed.fraction.length > 3) {
    throw new MoneyError("A quantity has at most three decimal places.");
  }

  const fraction = parsed.fraction.padEnd(3, "0");
  const magnitude =
    BigInt(parsed.whole) * BigInt(1000) + BigInt(fraction || "0");
  const value = toSafeNumber(
    parsed.negative ? -magnitude : magnitude,
    "Quantity",
  );

  assertInteger(value, "Quantity", 1, MAX_QUANTITY_MILLI);
  return value;
}

/** Render thousandths as a trimmed decimal string, for a form input. */
export function fromQuantityMilli(value: number): string {
  assertInteger(value, "Quantity", 0, MAX_QUANTITY_MILLI);
  const whole = Math.trunc(value / 1000);
  const fraction = String(value % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/**
 * Parse a percentage into integer basis points.
 *
 * `16` becomes `1600`, `16.5` becomes `1650`, `0.01` becomes `1`. Two decimal
 * places is the maximum, because one basis point is 0.01%.
 */
export function percentToBps(percent: string | number): number {
  const parsed = parseDecimal(percent, "Tax rate");

  if (parsed.fraction.length > 2) {
    throw new MoneyError("A tax rate has at most two decimal places.");
  }

  const fraction = parsed.fraction.padEnd(2, "0");
  const magnitude =
    BigInt(parsed.whole) * BigInt(100) + BigInt(fraction || "0");
  const value = toSafeNumber(
    parsed.negative ? -magnitude : magnitude,
    "Tax rate",
  );

  assertInteger(value, "Tax rate", 0, MAX_TAX_RATE_BPS);
  return value;
}

/** Render basis points as a percentage number, for display. */
export function bpsToPercent(bps: number): number {
  assertInteger(bps, "Tax rate", 0, MAX_TAX_RATE_BPS);
  return bps / 100;
}

export interface LineMoneyInput {
  /** The agreed price per unit, in minor units. May be a negotiated override. */
  unitPriceMinor: number;
  /** Quantity in thousandths; `1500` is `1.5`. */
  quantityMilli: number;
  /** Tax rate in basis points; `1600` is `16%`. */
  taxRateBps: number;
}

export interface LineMoney {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * The only place a line's money is calculated.
 *
 * The round trips are exact because every intermediate is `BigInt` and every
 * output is checked against `Number.MAX_SAFE_INTEGER`.
 */
export function calculateLine(input: LineMoneyInput): LineMoney {
  assertInteger(input.unitPriceMinor, "Unit price", 0, MAX_UNIT_PRICE_MINOR);
  assertInteger(input.quantityMilli, "Quantity", 1, MAX_QUANTITY_MILLI);
  assertInteger(input.taxRateBps, "Tax rate", 0, MAX_TAX_RATE_BPS);

  const subtotal = roundHalfUp(
    BigInt(input.unitPriceMinor) * BigInt(input.quantityMilli),
    BigInt(1000),
  );
  const tax = roundHalfUp(subtotal * BigInt(input.taxRateBps), BigInt(10_000));
  const total = subtotal + tax;

  return {
    subtotalMinor: toSafeNumber(subtotal, "Line subtotal"),
    taxMinor: toSafeNumber(tax, "Line tax"),
    totalMinor: toSafeNumber(total, "Line total"),
  };
}

export interface DocumentMoney {
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * Sum already-rounded lines.
 *
 * There is deliberately no document-level rounding adjustment. If a caller
 * wants a total that differs from the sum of its lines, the lines are wrong.
 */
export function calculateDocument(lines: readonly LineMoney[]): DocumentMoney {
  if (lines.length === 0) {
    throw new MoneyError("A document needs at least one line.");
  }
  if (lines.length > MAX_LINE_ITEMS) {
    throw new MoneyError(`A document has at most ${MAX_LINE_ITEMS} lines.`);
  }

  let subtotal = BigInt(0);
  let tax = BigInt(0);
  let total = BigInt(0);

  for (const line of lines) {
    assertInteger(
      line.subtotalMinor,
      "Line subtotal",
      0,
      Number.MAX_SAFE_INTEGER,
    );
    assertInteger(line.taxMinor, "Line tax", 0, Number.MAX_SAFE_INTEGER);
    assertInteger(line.totalMinor, "Line total", 0, Number.MAX_SAFE_INTEGER);
    subtotal += BigInt(line.subtotalMinor);
    tax += BigInt(line.taxMinor);
    total += BigInt(line.totalMinor);
  }

  return {
    subtotalMinor: toSafeNumber(subtotal, "Document subtotal"),
    taxMinor: toSafeNumber(tax, "Document tax"),
    totalMinor: toSafeNumber(total, "Document total"),
  };
}
