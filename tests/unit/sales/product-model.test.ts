import {
  connectToDatabase,
  disconnectDatabase,
} from "@tests/support/auth-contract";
import { Types } from "mongoose";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  ProductModel,
  productSchemaDefinition,
} from "@/modules/products";
import { MAX_UNIT_PRICE_MINOR } from "@/shared/lib/money";

/**
 * The product schema and its indexes.
 *
 * The indexes are asserted structurally, from `schema.indexes()`, because each
 * one encodes a rule the application depends on: the partial unique SKU index
 * is what makes SKUs case-insensitively unique per organisation *without*
 * rejecting the products that have none, and the text index is what the
 * catalogue search reads. A dropped or subtly changed index would not fail any
 * other test; it would just stop enforcing the rule.
 */
beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
});

afterEach(async () => {
  await ProductModel.deleteMany({});
});

const orgId = new Types.ObjectId();
const userId = new Types.ObjectId();

async function seed(overrides: Record<string, unknown> = {}) {
  return ProductModel.create({
    organizationId: orgId,
    name: "Widget",
    type: "PRODUCT",
    unitPriceMinor: 1000,
    currency: "USD",
    createdBy: userId,
    ...overrides,
  });
}

describe("Product model", () => {
  describe("enums", () => {
    it("names the two product types", () => {
      expect(PRODUCT_TYPES).toEqual(["PRODUCT", "SERVICE"]);
    });

    it("names the two statuses", () => {
      expect(PRODUCT_STATUSES).toEqual(["ACTIVE", "ARCHIVED"]);
    });
  });

  describe("defaults and fields", () => {
    it("defaults status to ACTIVE and leaves sku absent", async () => {
      const product = await seed();

      expect(product.status).toBe("ACTIVE");
      expect(product.sku).toBeNull();
      expect(product.skuNormalized).toBeNull();
      expect(product.deletedAt).toBeNull();
      expect(product.createdAt).toBeInstanceOf(Date);
      expect(product.updatedAt).toBeInstanceOf(Date);
    });

    it("trims the name", async () => {
      const product = await seed({ name: "  Trimmed  " });
      expect(product.name).toBe("Trimmed");
    });

    it("rejects a negative unit price", async () => {
      await expect(seed({ unitPriceMinor: -1 })).rejects.toThrow();
    });

    it("rejects a unit price above the cap", async () => {
      await expect(
        seed({ unitPriceMinor: MAX_UNIT_PRICE_MINOR + 1 }),
      ).rejects.toThrow();
    });

    it("requires a unit price", async () => {
      await expect(
        ProductModel.create({
          organizationId: orgId,
          name: "No price",
          type: "PRODUCT",
          currency: "USD",
        }),
      ).rejects.toThrow();
    });

    it("rejects a name longer than 160 characters", async () => {
      await expect(seed({ name: "x".repeat(161) })).rejects.toThrow();
    });

    it("requires a known type", async () => {
      await expect(seed({ type: "THING" })).rejects.toThrow();
    });
  });

  describe("indexes", () => {
    const indexes = productSchemaDefinition.indexes();

    it("indexes the catalogue list", () => {
      expect(indexes.map(([spec]) => spec)).toContainEqual({
        organizationId: 1,
        status: 1,
        type: 1,
        name: 1,
      });
    });

    it("indexes recent edits", () => {
      expect(indexes.map(([spec]) => spec)).toContainEqual({
        organizationId: 1,
        updatedAt: -1,
      });
    });

    it("has a unique, partial, case-insensitive SKU index", () => {
      const entry = indexes.find(
        ([spec]) =>
          spec.organizationId === 1 &&
          spec.skuNormalized === 1 &&
          Object.keys(spec).length === 2,
      );

      expect(entry).toBeDefined();
      expect(entry?.[1]?.unique).toBe(true);
      expect(entry?.[1]?.partialFilterExpression).toEqual({
        deletedAt: null,
        skuNormalized: { $type: "string" },
      });
    });

    it("has a tenant-prefixed text index", () => {
      expect(indexes.map(([spec]) => spec)).toContainEqual({
        organizationId: 1,
        name: "text",
        sku: "text",
        description: "text",
      });
    });

    it("actually builds every index against MongoDB", async () => {
      // Declaring an index is not the same as having one. The partial unique SKU
      // index carries a `partialFilterExpression`, which MongoDB validates only
      // when the index is built; a malformed filter would surface in production
      // and nowhere else. Building it here is what makes that a test failure.
      await ProductModel.createIndexes();

      const names = (await ProductModel.collection.indexes()).map(
        (index) => index.name,
      );
      expect(names).toContain("organizationId_1_status_1_type_1_name_1");
      expect(names).toContain("organizationId_1_skuNormalized_1");
      expect(names).toContain(
        "organizationId_1_name_text_sku_text_description_text",
      );
      expect(names).toContain("organizationId_1_updatedAt_-1");
    });
  });

  describe("soft delete", () => {
    it("stores deletedAt as a date when set", async () => {
      const product = await seed();
      product.deletedAt = new Date();
      await product.save();

      const reread = await ProductModel.findById(product._id);
      expect(reread?.deletedAt).toBeInstanceOf(Date);
    });
  });
});
