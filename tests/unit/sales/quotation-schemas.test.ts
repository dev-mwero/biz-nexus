import { describe, expect, it } from "vitest";
import {
  createQuotationBody,
  quotationLineBody,
  updateQuotationBody,
} from "@/modules/quotations";
import { MAX_UNIT_PRICE_MINOR } from "@/shared/lib/money";

const companyId = "507f1f77bcf86cd799439011";
const productId = "507f1f77bcf86cd799439012";

function validLine(overrides: Record<string, unknown> = {}) {
  return {
    productId,
    quantityMilli: 1000,
    taxRateBps: 1600,
    ...overrides,
  };
}

function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    companyId,
    validUntil: "2026-12-31",
    lineItems: [validLine()],
    ...overrides,
  };
}

/**
 * The wire contract for quotation writes.
 *
 * `strictObject` is the property under test: a key the schema does not know is
 * rejected, not silently dropped. The server-owned declarations are asserted
 * separately - they must parse, because refusing them is the service's job and
 * the message there can name the field.
 */
describe("quotation request schemas", () => {
  describe("strict objects", () => {
    it("rejects an unknown key on create", () => {
      const result = createQuotationBody.safeParse(
        validCreateBody({ surprise: true }),
      );
      expect(result.success).toBe(false);
    });

    it("rejects an unknown key on update", () => {
      const result = updateQuotationBody.safeParse({ surprise: true });
      expect(result.success).toBe(false);
    });

    it("rejects an unknown key on a line", () => {
      const result = quotationLineBody.safeParse(validLine({ surprise: true }));
      expect(result.success).toBe(false);
    });
  });

  describe("create body", () => {
    it("parses a valid body", () => {
      const result = createQuotationBody.safeParse(validCreateBody());

      expect(result.success).toBe(true);
    });

    it("accepts omitted optional references", () => {
      const result = createQuotationBody.safeParse({
        companyId,
        validUntil: "2026-12-31",
        lineItems: [validLine()],
      });
      expect(result.success).toBe(true);
    });

    it("rejects a date that does not exist", () => {
      const result = createQuotationBody.safeParse(
        validCreateBody({ validUntil: "2026-02-30" }),
      );
      expect(result.success).toBe(false);
    });

    it("rejects an empty line list and one of 101 lines", () => {
      expect(
        createQuotationBody.safeParse(validCreateBody({ lineItems: [] }))
          .success,
      ).toBe(false);

      const tooMany = Array.from({ length: 101 }, () => validLine());
      expect(
        createQuotationBody.safeParse(validCreateBody({ lineItems: tooMany }))
          .success,
      ).toBe(false);
    });

    it("accepts 100 lines", () => {
      const lines = Array.from({ length: 100 }, () => validLine());
      expect(
        createQuotationBody.safeParse(validCreateBody({ lineItems: lines }))
          .success,
      ).toBe(true);
    });

    it("rejects quantity zero and a negative quantity", () => {
      for (const quantityMilli of [0, -1]) {
        const result = createQuotationBody.safeParse(
          validCreateBody({ lineItems: [validLine({ quantityMilli })] }),
        );
        expect(result.success).toBe(false);
      }
    });

    it("rejects tax rates outside 0 to 10,000 basis points", () => {
      for (const taxRateBps of [-1, 10_001]) {
        const result = createQuotationBody.safeParse(
          validCreateBody({ lineItems: [validLine({ taxRateBps })] }),
        );
        expect(result.success).toBe(false);
      }
    });

    it("rejects unit prices outside the range and accepts both ends", () => {
      for (const unitPriceMinor of [-1, MAX_UNIT_PRICE_MINOR + 1]) {
        expect(
          createQuotationBody.safeParse(
            validCreateBody({ lineItems: [validLine({ unitPriceMinor })] }),
          ).success,
        ).toBe(false);
      }

      for (const unitPriceMinor of [0, MAX_UNIT_PRICE_MINOR]) {
        expect(
          createQuotationBody.safeParse(
            validCreateBody({ lineItems: [validLine({ unitPriceMinor })] }),
          ).success,
        ).toBe(true);
      }
    });
  });

  describe("update body", () => {
    it("parses a valid partial body", () => {
      const result = updateQuotationBody.safeParse({
        validUntil: "2026-11-30",
        lineItems: [validLine()],
        terms: "Net 30",
      });

      expect(result.success).toBe(true);
    });

    it("rejects a date that does not exist", () => {
      const result = updateQuotationBody.safeParse({
        validUntil: "2026-02-30",
      });
      expect(result.success).toBe(false);
    });

    it("rejects an empty line list and one of 101 lines", () => {
      expect(updateQuotationBody.safeParse({ lineItems: [] }).success).toBe(
        false,
      );

      const tooMany = Array.from({ length: 101 }, () => validLine());
      expect(
        updateQuotationBody.safeParse({ lineItems: tooMany }).success,
      ).toBe(false);
    });

    it("rejects quantity zero and a negative quantity", () => {
      for (const quantityMilli of [0, -1]) {
        const result = updateQuotationBody.safeParse({
          lineItems: [validLine({ quantityMilli })],
        });
        expect(result.success).toBe(false);
      }
    });

    it("rejects tax rates outside 0 to 10,000 basis points", () => {
      for (const taxRateBps of [-1, 10_001]) {
        expect(
          updateQuotationBody.safeParse({
            lineItems: [validLine({ taxRateBps })],
          }).success,
        ).toBe(false);
      }
    });
  });

  describe("declared but refused fields", () => {
    // The schema accepts these so `strictObject` does not call a known but
    // server-owned field a typo. The service refuses them by name with a
    // message that says who owns the field; that refusal is not this layer's
    // test. What is asserted here is that they parse, which is the contract
    // the service relies on.
    it("parses create bodies carrying server-owned fields", () => {
      const result = createQuotationBody.safeParse(
        validCreateBody({
          currency: "USD",
          organizationId: "507f1f77bcf86cd799439013",
          number: "Q-2026-000001",
          status: "DRAFT",
          currentRevisionId: "507f1f77bcf86cd799439014",
          currentRevisionNumber: 1,
          subtotalMinor: 1000,
          taxMinor: 160,
          totalMinor: 1160,
          acceptedRevisionId: null,
          acceptedAt: null,
          orderId: null,
          convertedAt: null,
          companyName: "Acme",
          contactName: null,
        }),
      );

      expect(result.success).toBe(true);
    });

    it("parses update bodies carrying server-owned fields, including companyId", () => {
      const result = updateQuotationBody.safeParse({
        companyId,
        status: "SENT",
        number: "Q-2026-000002",
        totalMinor: 2000,
      });

      expect(result.success).toBe(true);
    });

    it("parses line bodies carrying server-owned line fields", () => {
      const result = quotationLineBody.safeParse(
        validLine({
          position: 0,
          productName: "Widget",
          sku: "SKU-1",
          unitLabel: "each",
          listPriceMinor: 1000,
          lineSubtotalMinor: 1000,
          lineTaxMinor: 160,
          lineTotalMinor: 1160,
        }),
      );

      expect(result.success).toBe(true);
    });
  });
});
