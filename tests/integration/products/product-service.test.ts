import {
  connectToDatabase,
  disconnectDatabase,
} from "@tests/support/auth-contract";
import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UserModel } from "@/modules/identity";
import { OrganizationModel } from "@/modules/organizations";
import { ProductModel } from "@/modules/products/product.model";
import { ProductRepository } from "@/modules/products/product.repository";
import {
  type CreateProductInput,
  ProductError,
  ProductService,
  type UpdateProductInput,
} from "@/modules/products/product.service";
import { MAX_UNIT_PRICE_MINOR } from "@/shared/lib/money";

/**
 * The product service's own rules.
 *
 * These are the decisions the service makes that no schema can: which currency
 * a price is denominated in, what a SKU normalises to, and which fields a
 * client is allowed to write. A schema can require a price to be a number, but
 * only the service knows the number is minor units in the organisation's
 * currency and that the field naming it is not the client's to set.
 */

function asObjectId(id: string | Types.ObjectId): Types.ObjectId {
  return typeof id === "string" ? new Types.ObjectId(id) : id;
}

async function seedOrganisation(currency = "USD") {
  const org = await OrganizationModel.create({
    name: `Org-${new Types.ObjectId()}`,
    slug: `org-${new Types.ObjectId()}`,
    currency,
  });
  const user = await UserModel.create({
    email: `user-${new Types.ObjectId()}@example.com`,
    name: "Actor",
    passwordHash: "hash",
    emailVerifiedAt: new Date(),
  });
  return { org, user };
}

let organizationId: Types.ObjectId;
let actorId: Types.ObjectId;
let service: ProductService;

beforeAll(async () => {
  await connectToDatabase();
  await ProductModel.createIndexes();
});

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await ProductModel.deleteMany({});
  await OrganizationModel.deleteMany({});
  await UserModel.deleteMany({});

  const { org, user } = await seedOrganisation("USD");
  organizationId = asObjectId(org._id);
  actorId = asObjectId(user._id);
  service = new ProductService(
    new ProductRepository(organizationId, actorId),
    actorId,
  );
});

const base = {
  name: "Widget",
  type: "PRODUCT" as const,
  unitPriceMinor: 1000,
};

describe("ProductService", () => {
  describe("create price bounds", () => {
    it("rejects a negative price", async () => {
      await expect(
        service.create({ ...base, unitPriceMinor: -1 }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });

    it("rejects a fractional price", async () => {
      await expect(
        service.create({ ...base, unitPriceMinor: 10.5 }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });

    it("rejects a price above the cap", async () => {
      await expect(
        service.create({
          ...base,
          unitPriceMinor: MAX_UNIT_PRICE_MINOR + 1,
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });

    it("accepts zero and the cap", async () => {
      const zero = await service.create({ ...base, unitPriceMinor: 0 });
      const cap = await service.create({
        ...base,
        name: "Capped",
        unitPriceMinor: MAX_UNIT_PRICE_MINOR,
      });

      expect(zero.unitPriceMinor).toBe(0);
      expect(cap.unitPriceMinor).toBe(MAX_UNIT_PRICE_MINOR);
    });
  });

  describe("currency", () => {
    it("snapshots the organisation's currency", async () => {
      const { org, user } = await seedOrganisation("JPY");
      const jpyService = new ProductService(
        new ProductRepository(asObjectId(org._id), asObjectId(user._id)),
        asObjectId(user._id),
      );

      const product = await jpyService.create(base);
      expect(product.currency).toBe("JPY");
    });

    it("never takes the currency from the request", async () => {
      const product = await service.create({
        ...base,
        currency: "GBP",
      } as CreateProductInput);

      expect(product.currency).toBe("USD");
    });
  });

  describe("SKU normalisation", () => {
    it("stores the SKU uppercased and trimmed, wired to the uniqueness key", async () => {
      const product = await service.create({
        ...base,
        sku: "  abc-1  ",
      });

      expect(product.sku).toBe("abc-1");
      expect(product.skuNormalized).toBe("ABC-1");
    });

    it("treats a blank SKU as no SKU", async () => {
      const product = await service.create({ ...base, sku: "   " });

      expect(product.sku).toBeNull();
      expect(product.skuNormalized).toBeNull();
    });

    it("leaves both SKU fields null when none is given", async () => {
      const product = await service.create(base);

      expect(product.sku).toBeNull();
      expect(product.skuNormalized).toBeNull();
    });

    it("recomputes the normalised key on update", async () => {
      const product = await service.create({ ...base, sku: "abc-1" });

      const updated = await service.update(product._id, { sku: "xyz-9" });

      expect(updated?.sku).toBe("xyz-9");
      expect(updated?.skuNormalized).toBe("XYZ-9");
    });

    it("clears the normalised key when the SKU is removed", async () => {
      const product = await service.create({ ...base, sku: "abc-1" });

      const updated = await service.update(product._id, { sku: null });

      expect(updated?.sku).toBeNull();
      expect(updated?.skuNormalized).toBeNull();
    });

    it("rejects a SKU that collides with a different product", async () => {
      await service.create({ ...base, name: "First", sku: "abc-1" });
      const second = await service.create({
        ...base,
        name: "Second",
        sku: "def-2",
      });

      await expect(
        service.update(second._id, { sku: "ABC-1" }),
      ).rejects.toMatchObject({ code: "SLUG_CONFLICT" });
    });

    it("lets a product keep its own SKU on update", async () => {
      const product = await service.create({ ...base, sku: "abc-1" });

      const updated = await service.update(product._id, { sku: "abc-1" });
      expect(updated?.skuNormalized).toBe("ABC-1");
    });
  });

  describe("archive and restore", () => {
    it("archives and restores without deleting", async () => {
      const product = await service.create(base);

      const archived = await service.archive(product._id);
      expect(archived?.status).toBe("ARCHIVED");
      expect(await service.getById(product._id)).not.toBeNull();

      const restored = await service.restore(product._id);
      expect(restored?.status).toBe("ACTIVE");
    });

    it("returns null when archiving a product that is not there", async () => {
      const missing = await service.archive(new Types.ObjectId());
      expect(missing).toBeNull();
    });
  });

  describe("update allowlist", () => {
    it("refuses the server-owned currency field", async () => {
      const product = await service.create(base);

      await expect(
        service.update(product._id, { currency: "GBP" }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });

    it("refuses the server-owned organisation field", async () => {
      const product = await service.create(base);

      await expect(
        service.update(product._id, {
          organizationId: new Types.ObjectId(),
        }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });

    it("refuses the derived skuNormalized field", async () => {
      const product = await service.create(base);

      await expect(
        service.update(product._id, {
          skuNormalized: "HACKED",
        } as UpdateProductInput),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });

    it("refuses an unknown field", async () => {
      const product = await service.create(base);

      await expect(
        service.update(product._id, {
          slug: "nope",
        } as unknown as UpdateProductInput),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });

    it("applies an allowlisted field", async () => {
      const product = await service.create(base);

      const updated = await service.update(product._id, {
        name: "Renamed",
        unitPriceMinor: 2500,
      });

      expect(updated?.name).toBe("Renamed");
      expect(updated?.unitPriceMinor).toBe(2500);
    });

    it("validates price bounds on update", async () => {
      const product = await service.create(base);

      await expect(
        service.update(product._id, { unitPriceMinor: -5 }),
      ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });
  });

  describe("delete", () => {
    it("soft-deletes a product", async () => {
      const product = await service.create(base);

      await service.delete(product._id);

      expect(await service.getById(product._id)).toBeNull();
      const raw = await ProductModel.findById(product._id);
      expect(raw?.deletedAt).toBeInstanceOf(Date);
    });

    it("reports a missing product as not found", async () => {
      await expect(service.delete(new Types.ObjectId())).rejects.toBeInstanceOf(
        ProductError,
      );
    });
  });
});
