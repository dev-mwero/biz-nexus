import { describe, expect, it } from "vitest";
import {
  bpsToPercent,
  calculateDocument,
  calculateLine,
  fromMinorUnits,
  fromQuantityMilli,
  MAX_LINE_ITEMS,
  MAX_QUANTITY_MILLI,
  MAX_TAX_RATE_BPS,
  MAX_UNIT_PRICE_MINOR,
  MoneyError,
  minorUnitDigits,
  percentToBps,
  roundHalfUp,
  toMinorUnits,
  toQuantityMilli,
} from "@/shared/lib/money";

describe("minorUnitDigits", () => {
  it("knows the common exponent tables", () => {
    expect(minorUnitDigits("USD")).toBe(2);
    expect(minorUnitDigits("EUR")).toBe(2);
    expect(minorUnitDigits("JPY")).toBe(0);
    expect(minorUnitDigits("KWD")).toBe(3);
    expect(minorUnitDigits("CLF")).toBe(4);
  });

  it("normalises case and whitespace", () => {
    expect(minorUnitDigits(" usd ")).toBe(2);
  });

  it("treats an unknown three-letter code as two decimals", () => {
    // A tenant can already hold a code this table does not name. Reading it
    // must not fail just because the table is incomplete.
    expect(minorUnitDigits("ZZZ")).toBe(2);
  });

  it("rejects a malformed code", () => {
    expect(() => minorUnitDigits("US")).toThrow(MoneyError);
    expect(() => minorUnitDigits("USDD")).toThrow(MoneyError);
    expect(() => minorUnitDigits("12$")).toThrow(MoneyError);
  });
});

describe("toMinorUnits", () => {
  it("converts decimal major units exactly", () => {
    expect(toMinorUnits("12.50", "USD")).toBe(1250);
    expect(toMinorUnits(12.5, "USD")).toBe(1250);
    expect(toMinorUnits("0.01", "USD")).toBe(1);
    expect(toMinorUnits("0", "USD")).toBe(0);
  });

  it("respects the currency exponent", () => {
    expect(toMinorUnits("1250", "JPY")).toBe(1250);
    expect(toMinorUnits("1.234", "KWD")).toBe(1234);
    expect(toMinorUnits("1.2345", "CLF")).toBe(12345);
  });

  it("keeps signs", () => {
    expect(toMinorUnits("-1.25", "USD")).toBe(-125);
  });

  it("rejects precision the currency cannot hold", () => {
    // Silently turning "1.234" into 123 would make a typo look valid.
    expect(() => toMinorUnits("1.234", "USD")).toThrow(MoneyError);
    expect(() => toMinorUnits("1.5", "JPY")).toThrow(MoneyError);
  });

  it("rejects formats that only look numeric", () => {
    for (const value of ["1e3", "1,000", " 1 ", "1.", ".5", "abc", "+1"]) {
      expect(() => toMinorUnits(value, "USD"), value).toThrow(MoneyError);
    }
  });

  it("rejects non-finite numbers", () => {
    expect(() => toMinorUnits(Number.NaN, "USD")).toThrow(MoneyError);
    expect(() => toMinorUnits(Number.POSITIVE_INFINITY, "USD")).toThrow(
      MoneyError,
    );
  });
});

describe("fromMinorUnits", () => {
  it("renders the major-unit value", () => {
    expect(fromMinorUnits(1250, "USD")).toBe(12.5);
    expect(fromMinorUnits(1250, "JPY")).toBe(1250);
    expect(fromMinorUnits(1, "KWD")).toBe(0.001);
    expect(fromMinorUnits(1, "CLF")).toBe(0.0001);
  });

  it("accepts negative and zero values", () => {
    expect(fromMinorUnits(0, "USD")).toBe(0);
    expect(fromMinorUnits(-125, "USD")).toBe(-1.25);
  });

  it("rejects a non-integer", () => {
    expect(() => fromMinorUnits(1.5, "USD")).toThrow(MoneyError);
  });
});

describe("roundHalfUp", () => {
  it("rounds ties away from zero", () => {
    expect(roundHalfUp(BigInt(5), BigInt(10))).toBe(BigInt(1));
    expect(roundHalfUp(BigInt(15), BigInt(10))).toBe(BigInt(2));
    expect(roundHalfUp(BigInt(4), BigInt(10))).toBe(BigInt(0));
  });

  it("only accepts non-negative numerators and positive denominators", () => {
    expect(() => roundHalfUp(BigInt(-1), BigInt(10))).toThrow(MoneyError);
    expect(() => roundHalfUp(BigInt(1), BigInt(0))).toThrow(MoneyError);
  });
});

describe("calculateLine", () => {
  it("calculates a taxed line", () => {
    // 1.5 units at $1.00, 16% tax.
    expect(
      calculateLine({
        unitPriceMinor: 100,
        quantityMilli: 1500,
        taxRateBps: 1600,
      }),
    ).toEqual({ subtotalMinor: 150, taxMinor: 24, totalMinor: 174 });
  });

  it("rounds a half minor unit up", () => {
    // 0.5 units at $0.01 is half a cent; the line is one cent.
    expect(
      calculateLine({
        unitPriceMinor: 1,
        quantityMilli: 500,
        taxRateBps: 0,
      }),
    ).toEqual({ subtotalMinor: 1, taxMinor: 0, totalMinor: 1 });
  });

  it("rounds tax after the subtotal, not before", () => {
    // Subtotal 1 cent, 50% tax. 0.5 cent rounds to 1 cent.
    expect(
      calculateLine({
        unitPriceMinor: 1,
        quantityMilli: 1000,
        taxRateBps: 5000,
      }),
    ).toEqual({ subtotalMinor: 1, taxMinor: 1, totalMinor: 2 });
  });

  it("supports zero-tax and zero-priced lines", () => {
    expect(
      calculateLine({
        unitPriceMinor: 0,
        quantityMilli: 2500,
        taxRateBps: 0,
      }),
    ).toEqual({ subtotalMinor: 0, taxMinor: 0, totalMinor: 0 });
  });

  it("rejects inputs outside the documented ranges", () => {
    expect(() =>
      calculateLine({
        unitPriceMinor: -1,
        quantityMilli: 1000,
        taxRateBps: 0,
      }),
    ).toThrow(MoneyError);
    expect(() =>
      calculateLine({
        unitPriceMinor: 1,
        quantityMilli: 0,
        taxRateBps: 0,
      }),
    ).toThrow(MoneyError);
    expect(() =>
      calculateLine({
        unitPriceMinor: 1,
        quantityMilli: 1000,
        taxRateBps: MAX_TAX_RATE_BPS + 1,
      }),
    ).toThrow(MoneyError);
    expect(() =>
      calculateLine({
        unitPriceMinor: MAX_UNIT_PRICE_MINOR + 1,
        quantityMilli: 1000,
        taxRateBps: 0,
      }),
    ).toThrow(MoneyError);
    expect(() =>
      calculateLine({
        unitPriceMinor: 1,
        quantityMilli: MAX_QUANTITY_MILLI + 1,
        taxRateBps: 0,
      }),
    ).toThrow(MoneyError);
  });

  it("rejects fractional minor units", () => {
    expect(() =>
      calculateLine({
        unitPriceMinor: 1.5,
        quantityMilli: 1000,
        taxRateBps: 0,
      }),
    ).toThrow(MoneyError);
  });
});

describe("calculateDocument", () => {
  it("sums rounded lines without re-rounding", () => {
    const first = calculateLine({
      unitPriceMinor: 100,
      quantityMilli: 1500,
      taxRateBps: 1600,
    });
    const second = calculateLine({
      unitPriceMinor: 250,
      quantityMilli: 2000,
      taxRateBps: 500,
    });

    expect(calculateDocument([first, second])).toEqual({
      subtotalMinor: 650,
      taxMinor: 49,
      totalMinor: 699,
    });
  });

  it("rejects an empty document", () => {
    expect(() => calculateDocument([])).toThrow(MoneyError);
  });

  it("rejects more lines than the cap", () => {
    const line = { subtotalMinor: 1, taxMinor: 0, totalMinor: 1 };
    expect(() =>
      calculateDocument(Array.from({ length: MAX_LINE_ITEMS + 1 }, () => line)),
    ).toThrow(MoneyError);
  });

  it("stays exact at the documented maximum", () => {
    const line = calculateLine({
      unitPriceMinor: MAX_UNIT_PRICE_MINOR,
      quantityMilli: MAX_QUANTITY_MILLI,
      taxRateBps: MAX_TAX_RATE_BPS,
    });
    const document = calculateDocument(
      Array.from({ length: MAX_LINE_ITEMS }, () => line),
    );

    expect(Number.isSafeInteger(document.totalMinor)).toBe(true);
    expect(document.totalMinor).toBe(line.totalMinor * MAX_LINE_ITEMS);
  });
});

describe("quantities", () => {
  it("parses a decimal quantity into thousandths", () => {
    expect(toQuantityMilli("1.5")).toBe(1500);
    expect(toQuantityMilli("1")).toBe(1000);
    expect(toQuantityMilli("0.001")).toBe(1);
    expect(toQuantityMilli(2.25)).toBe(2250);
  });

  it("rejects zero, negatives, and excess precision", () => {
    for (const value of ["0", "-1", "1.2345", "1e3", "1,000"]) {
      expect(() => toQuantityMilli(value), value).toThrow(MoneyError);
    }
  });

  it("renders thousandths without trailing zeros", () => {
    expect(fromQuantityMilli(1500)).toBe("1.5");
    expect(fromQuantityMilli(1000)).toBe("1");
    expect(fromQuantityMilli(1)).toBe("0.001");
    expect(fromQuantityMilli(0)).toBe("0");
  });
});

describe("tax rates", () => {
  it("parses percentages into basis points", () => {
    expect(percentToBps("16")).toBe(1600);
    expect(percentToBps("16.5")).toBe(1650);
    expect(percentToBps("0.01")).toBe(1);
    expect(percentToBps("100")).toBe(MAX_TAX_RATE_BPS);
  });

  it("rejects out-of-range and over-precise rates", () => {
    for (const value of ["-1", "100.01", "1.234", "abc"]) {
      expect(() => percentToBps(value), value).toThrow(MoneyError);
    }
  });

  it("renders basis points as a percentage", () => {
    expect(bpsToPercent(1600)).toBe(16);
    expect(bpsToPercent(1650)).toBe(16.5);
    expect(bpsToPercent(1)).toBe(0.01);
  });
});
