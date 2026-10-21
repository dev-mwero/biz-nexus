import {
  connectToDatabase,
  disconnectDatabase,
} from "@tests/support/auth-contract";
import { Types } from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  QUOTATION_REVISION_STATUSES,
  QUOTATION_STATUSES,
  QuotationModel,
  QuotationRevisionModel,
  quotationRevisionSchemaDefinition,
  quotationSchemaDefinition,
} from "@/modules/quotations";
import { MAX_QUANTITY_MILLI, MAX_UNIT_PRICE_MINOR } from "@/shared/lib/money";

/**
 * The quotation and revision schemas and their indexes.
 *
 * The indexes are asserted structurally because each one encodes a rule the
 * application depends on: the unique `(organizationId, number)` key is what
 * makes quotation numbers unambiguous per tenant, and the unique
 * `(organizationId, quotationId, revision)` key is what keeps history from
 * containing two revision 3s. A dropped index would not fail any other test; it
 * would just stop enforcing the rule.
 */
beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
});

afterEach(async () => {
  await QuotationModel.deleteMany({});
  await QuotationRevisionModel.deleteMany({});
});

const orgId = new Types.ObjectId();
const userId = new Types.ObjectId();

function quotationSeed(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: orgId,
    number: "Q-2026-000001",
    currentRevisionId: new Types.ObjectId(),
    currentRevisionNumber: 1,
    companyId: new Types.ObjectId(),
    companyName: "Acme",
    ownerId: userId,
    currency: "USD",
    validUntil: "2026-12-31",
    subtotalMinor: 1000,
    taxMinor: 160,
    totalMinor: 1160,
    ...overrides,
  };
}

function lineSeed(overrides: Record<string, unknown> = {}) {
  return {
    position: 0,
    productId: new Types.ObjectId(),
    productName: "Widget",
    sku: null,
    unitLabel: null,
    listPriceMinor: 1000,
    unitPriceMinor: 1000,
    quantityMilli: 1000,
    taxRateBps: 1600,
    lineSubtotalMinor: 1000,
    lineTaxMinor: 160,
    lineTotalMinor: 1160,
    ...overrides,
  };
}

function revisionSeed(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: orgId,
    quotationId: new Types.ObjectId(),
    revision: 1,
    lineItems: [lineSeed()],
    subtotalMinor: 1000,
    taxMinor: 160,
    totalMinor: 1160,
    validUntil: "2026-12-31",
    customerSnapshot: {
      companyName: "Acme",
      contactName: null,
      contactEmail: null,
      billingAddress: null,
    },
    ...overrides,
  };
}

describe("Quotation model", () => {
  describe("enums", () => {
    it("names the five quotation statuses", () => {
      expect(QUOTATION_STATUSES).toEqual([
        "DRAFT",
        "SENT",
        "ACCEPTED",
        "REJECTED",
        "VOID",
      ]);
    });

    it("names the six revision statuses", () => {
      expect(QUOTATION_REVISION_STATUSES).toEqual([
        "DRAFT",
        "SENT",
        "ACCEPTED",
        "REJECTED",
        "SUPERSEDED",
        "VOID",
      ]);
    });
  });

  describe("defaults and fields", () => {
    it("defaults to DRAFT with empty lifecycle references", async () => {
      const quotation = await QuotationModel.create(quotationSeed());

      expect(quotation.status).toBe("DRAFT");
      expect(quotation.acceptedRevisionId).toBeNull();
      expect(quotation.acceptedAt).toBeNull();
      expect(quotation.orderId).toBeNull();
      expect(quotation.convertedAt).toBeNull();
      expect(quotation.contactId).toBeNull();
      expect(quotation.contactName).toBeNull();
      expect(quotation.dealId).toBeNull();
      expect(quotation.deletedAt).toBeNull();
      expect(quotation.createdAt).toBeInstanceOf(Date);
      expect(quotation.updatedAt).toBeInstanceOf(Date);
    });

    it("trims the company name snapshot", async () => {
      const quotation = await QuotationModel.create(
        quotationSeed({ companyName: "  Trimmed  " }),
      );
      expect(quotation.companyName).toBe("Trimmed");
    });

    it("rejects a missing company name", async () => {
      const document: Record<string, unknown> = quotationSeed();
      document.companyName = undefined;
      await expect(QuotationModel.create(document)).rejects.toThrow();
    });

    it("rejects a negative total", async () => {
      await expect(
        QuotationModel.create(quotationSeed({ totalMinor: -1 })),
      ).rejects.toThrow();
    });

    it("rejects a non-integer total", async () => {
      await expect(
        QuotationModel.create(quotationSeed({ subtotalMinor: 1.5 })),
      ).rejects.toThrow();
    });

    it("rejects a revision number below one", async () => {
      await expect(
        QuotationModel.create(quotationSeed({ currentRevisionNumber: 0 })),
      ).rejects.toThrow();
    });

    it("rejects a date that is not a real calendar day", async () => {
      await expect(
        QuotationModel.create(quotationSeed({ validUntil: "2026-02-30" })),
      ).rejects.toThrow();
    });

    it("accepts a real calendar day", async () => {
      const quotation = await QuotationModel.create(
        quotationSeed({ validUntil: "2026-02-28" }),
      );
      expect(quotation.validUntil).toBe("2026-02-28");
    });

    it("rejects every required field when it is absent", async () => {
      const required = [
        "number",
        "currentRevisionId",
        "currentRevisionNumber",
        "companyId",
        "companyName",
        "ownerId",
        "currency",
        "validUntil",
        "subtotalMinor",
        "taxMinor",
        "totalMinor",
      ];

      for (const field of required) {
        const document: Record<string, unknown> = quotationSeed();
        delete document[field];
        await expect(QuotationModel.create(document)).rejects.toThrow();
      }
    });
  });

  describe("indexes", () => {
    const indexes = quotationSchemaDefinition.indexes();

    it("has the nine declared indexes", () => {
      const specs = indexes.map(([spec]) => spec);
      expect(specs).toContainEqual({ organizationId: 1, number: 1 });
      expect(specs).toContainEqual({
        organizationId: 1,
        status: 1,
        createdAt: -1,
      });
      expect(specs).toContainEqual({
        organizationId: 1,
        companyId: 1,
        createdAt: -1,
      });
      expect(specs).toContainEqual({
        organizationId: 1,
        contactId: 1,
        createdAt: -1,
      });
      expect(specs).toContainEqual({
        organizationId: 1,
        dealId: 1,
        createdAt: -1,
      });
      expect(specs).toContainEqual({
        organizationId: 1,
        ownerId: 1,
        updatedAt: -1,
      });
      expect(specs).toContainEqual({
        organizationId: 1,
        status: 1,
        validUntil: 1,
      });
      expect(specs).toContainEqual({ organizationId: 1, totalMinor: -1 });
      expect(specs).toContainEqual({
        organizationId: 1,
        number: 1,
        companyName: 1,
      });
    });

    it("makes the number unique per organisation", () => {
      const entry = indexes.find(
        ([spec]) =>
          Object.keys(spec).length === 2 &&
          spec.organizationId === 1 &&
          spec.number === 1,
      );

      expect(entry?.[1]?.unique).toBe(true);
    });
  });
});

describe("Quotation revision model", () => {
  describe("line items", () => {
    it("rejects an empty line list", async () => {
      await expect(
        QuotationRevisionModel.create(revisionSeed({ lineItems: [] })),
      ).rejects.toThrow();
    });

    it("rejects more than one hundred lines", async () => {
      const lineItems = Array.from({ length: 101 }, (_, index) =>
        lineSeed({ position: index }),
      );
      await expect(
        QuotationRevisionModel.create(revisionSeed({ lineItems })),
      ).rejects.toThrow();
    });

    it("accepts one hundred lines", async () => {
      const lineItems = Array.from({ length: 100 }, (_, index) =>
        lineSeed({ position: index }),
      );
      const revision = await QuotationRevisionModel.create(
        revisionSeed({ lineItems }),
      );
      expect(revision.lineItems).toHaveLength(100);
    });

    it("accepts quantity of one and the cap", async () => {
      for (const quantityMilli of [1, MAX_QUANTITY_MILLI]) {
        const revision = await QuotationRevisionModel.create(
          revisionSeed({ lineItems: [lineSeed({ quantityMilli })] }),
        );
        expect(revision.lineItems[0].quantityMilli).toBe(quantityMilli);
        await QuotationRevisionModel.deleteMany({});
      }
    });

    it("rejects quantity of zero, a negative, and above the cap", async () => {
      for (const quantityMilli of [0, -1, MAX_QUANTITY_MILLI + 1]) {
        await expect(
          QuotationRevisionModel.create(
            revisionSeed({ lineItems: [lineSeed({ quantityMilli })] }),
          ),
        ).rejects.toThrow();
      }
    });

    it("accepts tax rates at both ends of the range", async () => {
      for (const taxRateBps of [0, 10_000]) {
        const revision = await QuotationRevisionModel.create(
          revisionSeed({ lineItems: [lineSeed({ taxRateBps })] }),
        );
        expect(revision.lineItems[0].taxRateBps).toBe(taxRateBps);
        await QuotationRevisionModel.deleteMany({});
      }
    });

    it("rejects tax rates outside the range", async () => {
      for (const taxRateBps of [-1, 10_001]) {
        await expect(
          QuotationRevisionModel.create(
            revisionSeed({ lineItems: [lineSeed({ taxRateBps })] }),
          ),
        ).rejects.toThrow();
      }
    });

    it("accepts prices at zero and the cap", async () => {
      for (const price of [0, MAX_UNIT_PRICE_MINOR]) {
        const revision = await QuotationRevisionModel.create(
          revisionSeed({
            lineItems: [
              lineSeed({ unitPriceMinor: price, listPriceMinor: price }),
            ],
          }),
        );
        expect(revision.lineItems[0].unitPriceMinor).toBe(price);
        expect(revision.lineItems[0].listPriceMinor).toBe(price);
        await QuotationRevisionModel.deleteMany({});
      }
    });

    it("rejects prices outside the range", async () => {
      for (const price of [-1, MAX_UNIT_PRICE_MINOR + 1]) {
        await expect(
          QuotationRevisionModel.create(
            revisionSeed({ lineItems: [lineSeed({ unitPriceMinor: price })] }),
          ),
        ).rejects.toThrow();
        await expect(
          QuotationRevisionModel.create(
            revisionSeed({ lineItems: [lineSeed({ listPriceMinor: price })] }),
          ),
        ).rejects.toThrow();
      }
    });
  });

  describe("content limits", () => {
    it("defaults status to DRAFT and lifecycle dates to null", async () => {
      const revision = await QuotationRevisionModel.create(revisionSeed());

      expect(revision.status).toBe("DRAFT");
      expect(revision.sentAt).toBeNull();
      expect(revision.acceptedAt).toBeNull();
      expect(revision.rejectedAt).toBeNull();
      expect(revision.supersededAt).toBeNull();
      expect(revision.voidedAt).toBeNull();
      expect(revision.terms).toBeNull();
      expect(revision.notes).toBeNull();
      expect(revision.createdAt).toBeInstanceOf(Date);
      expect(revision.updatedAt).toBeInstanceOf(Date);
    });

    it("rejects terms and notes longer than five thousand characters", async () => {
      await expect(
        QuotationRevisionModel.create(
          revisionSeed({ terms: "x".repeat(5001) }),
        ),
      ).rejects.toThrow();
      await expect(
        QuotationRevisionModel.create(
          revisionSeed({ notes: "x".repeat(5001) }),
        ),
      ).rejects.toThrow();
    });

    it("accepts terms and notes at the limit", async () => {
      const revision = await QuotationRevisionModel.create(
        revisionSeed({
          terms: "x".repeat(5000),
          notes: "y".repeat(5000),
        }),
      );
      expect(revision.terms).toHaveLength(5000);
      expect(revision.notes).toHaveLength(5000);
    });

    it("requires the customer snapshot's company name", async () => {
      await expect(
        QuotationRevisionModel.create(
          revisionSeed({
            customerSnapshot: {
              contactName: "Ada",
              contactEmail: null,
              billingAddress: null,
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it("rejects a date that is not a real calendar day", async () => {
      await expect(
        QuotationRevisionModel.create(
          revisionSeed({ validUntil: "2026-02-30" }),
        ),
      ).rejects.toThrow();
    });

    it("has no deletedAt path and no soft-delete plugin", () => {
      expect(
        quotationRevisionSchemaDefinition.path("deletedAt"),
      ).toBeUndefined();
    });
  });

  describe("indexes", () => {
    const indexes = quotationRevisionSchemaDefinition.indexes();

    it("has the three declared indexes", () => {
      const specs = indexes.map(([spec]) => spec);
      expect(specs).toContainEqual({
        organizationId: 1,
        quotationId: 1,
        revision: 1,
      });
      expect(specs).toContainEqual({
        organizationId: 1,
        quotationId: 1,
        status: 1,
      });
      expect(specs).toContainEqual({
        organizationId: 1,
        quotationId: 1,
        createdAt: -1,
      });
    });

    it("makes the revision number unique within a quotation", () => {
      const entry = indexes.find(
        ([spec]) =>
          Object.keys(spec).length === 3 &&
          spec.organizationId === 1 &&
          spec.quotationId === 1 &&
          spec.revision === 1,
      );

      expect(entry?.[1]?.unique).toBe(true);
    });
  });
});
