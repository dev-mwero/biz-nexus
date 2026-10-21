import { describe, expect, it } from "vitest";
import {
  DOCUMENT_TYPES,
  DocumentNumberError,
  formatDocumentNumber,
} from "@/modules/document-numbers";

describe("formatDocumentNumber", () => {
  it("formats quotations and orders with their prefixes", () => {
    expect(formatDocumentNumber(DOCUMENT_TYPES.QUOTATION, 2026, 42)).toBe(
      "Q-2026-000042",
    );
    expect(formatDocumentNumber(DOCUMENT_TYPES.SALES_ORDER, 2026, 42)).toBe(
      "SO-2026-000042",
    );
  });

  it("keeps six digits and grows rather than truncates", () => {
    expect(formatDocumentNumber(DOCUMENT_TYPES.QUOTATION, 2026, 999_999)).toBe(
      "Q-2026-999999",
    );
    // Truncating would reuse a number that has already been issued.
    expect(
      formatDocumentNumber(DOCUMENT_TYPES.QUOTATION, 2026, 1_000_000),
    ).toBe("Q-2026-1000000");
  });

  it("rejects values that cannot be a sequence", () => {
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        () => formatDocumentNumber(DOCUMENT_TYPES.QUOTATION, 2026, value),
        String(value),
      ).toThrow(DocumentNumberError);
    }
  });

  it("rejects an invalid year", () => {
    for (const year of [0, -1, 10_000, 2026.5]) {
      expect(
        () => formatDocumentNumber(DOCUMENT_TYPES.QUOTATION, year, 1),
        String(year),
      ).toThrow(DocumentNumberError);
    }
  });

  it("rejects an unknown document type", () => {
    expect(() => formatDocumentNumber("INVOICE" as never, 2026, 1)).toThrow(
      DocumentNumberError,
    );
  });
});
