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
  ProductError,
  ProductService,
} from "@/modules/products/product.service";

/**
 * The product repository against a real MongoDB.
 *
 * Every isolation and uniqueness claim in the module is a claim about the
 * database, not about the code that calls it: the tenant scope is a filter that
 * either reaches MongoDB or does not, the SKU index is a unique index that
 * either rejects a duplicate or does not, and the soft-delete exclusion is what
 * `deletedAt: null` in the scope produces. An in-memory fake would assert the
 * mock's behaviour and pass while the index was missing.
 */

function asObjectId(id: string | Types.ObjectId): Types.ObjectId {
  return typeof id === "string" ? new Types.ObjectId(id) : id;
}

async function seedOrganisation(label: string, currency = "USD") {
  const org = await OrganizationModel.create({
    name: label,
    slug: `${label.toLowerCase()}-${new Types.ObjectId()}`,
    currency,
  });
  const user = await UserModel.create({
    email: `${label.toLowerCase()}-${new Types.ObjectId()}@example.com`,
    name: label,
    passwordHash: "hash",
    emailVerifiedAt: new Date(),
  });
  return { org, user };
}

function repositoryFor(organizationId: Types.ObjectId, userId: Types.ObjectId) {
  return new ProductRepository(organizationId, userId);
}

function serviceFor(organizationId: Types.ObjectId, userId: Types.ObjectId) {
  return new ProductService(repositoryFor(organizationId, userId), userId);
}

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
});

describe("ProductRepository", () => {
  describe("tenant scope", () => {
    it("does not read another organisation's product by id", async () => {
      const acme = await seedOrganisation("Acme");
      const globex = await seedOrganisation("Globex");

      const acmeRepo = repositoryFor(
        asObjectId(acme.org._id),
        asObjectId(acme.user._id),
      );
      const created = await acmeRepo.create({
        name: "Acme widget",
        type: "PRODUCT",
        unitPriceMinor: 1000,
        currency: "USD",
      });

      const globexRepo = repositoryFor(
        asObjectId(globex.org._id),
        asObjectId(globex.user._id),
      );

      expect(await globexRepo.findProductById(created._id)).toBeNull();
    });

    it("lists only the organisation's own products", async () => {
      const acme = await seedOrganisation("Acme");
      const globex = await seedOrganisation("Globex");

      await repositoryFor(
        asObjectId(acme.org._id),
        asObjectId(acme.user._id),
      ).create({
        name: "Acme widget",
        type: "PRODUCT",
        unitPriceMinor: 1000,
        currency: "USD",
      });
      await repositoryFor(
        asObjectId(globex.org._id),
        asObjectId(globex.user._id),
      ).create({
        name: "Globex widget",
        type: "PRODUCT",
        unitPriceMinor: 2000,
        currency: "USD",
      });

      const acmeList = await repositoryFor(
        asObjectId(acme.org._id),
        asObjectId(acme.user._id),
      ).findProducts();

      expect(acmeList).toHaveLength(1);
      expect(acmeList[0].name).toBe("Acme widget");
    });
  });

  describe("SKU uniqueness per organisation", () => {
    it("allows the same SKU in two organisations", async () => {
      const acme = await seedOrganisation("Acme");
      const globex = await seedOrganisation("Globex");

      await serviceFor(
        asObjectId(acme.org._id),
        asObjectId(acme.user._id),
      ).create({
        name: "Acme widget",
        sku: "SKU-1",
        type: "PRODUCT",
        unitPriceMinor: 1000,
      });
      const second = await serviceFor(
        asObjectId(globex.org._id),
        asObjectId(globex.user._id),
      ).create({
        name: "Globex widget",
        sku: "SKU-1",
        type: "PRODUCT",
        unitPriceMinor: 2000,
      });

      expect(second.skuNormalized).toBe("SKU-1");
    });

    it("rejects a duplicate SKU within one organisation, case-insensitively", async () => {
      const acme = await seedOrganisation("Acme");
      const service = serviceFor(
        asObjectId(acme.org._id),
        asObjectId(acme.user._id),
      );

      await service.create({
        name: "First",
        sku: "sku-1",
        type: "PRODUCT",
        unitPriceMinor: 1000,
      });

      await expect(
        service.create({
          name: "Second",
          sku: "SKU-1",
          type: "PRODUCT",
          unitPriceMinor: 2000,
        }),
      ).rejects.toMatchObject({ code: "SLUG_CONFLICT" });
    });

    it("frees the SKU when the holding product is soft-deleted", async () => {
      const acme = await seedOrganisation("Acme");
      const service = serviceFor(
        asObjectId(acme.org._id),
        asObjectId(acme.user._id),
      );

      const first = await service.create({
        name: "First",
        sku: "SKU-1",
        type: "PRODUCT",
        unitPriceMinor: 1000,
      });
      await service.delete(first._id);

      const second = await service.create({
        name: "Second",
        sku: "SKU-1",
        type: "PRODUCT",
        unitPriceMinor: 2000,
      });

      expect(second.skuNormalized).toBe("SKU-1");
    });
  });

  describe("soft delete", () => {
    it("excludes a deleted product from reads", async () => {
      const acme = await seedOrganisation("Acme");
      const repo = repositoryFor(
        asObjectId(acme.org._id),
        asObjectId(acme.user._id),
      );
      const created = await repo.create({
        name: "Doomed",
        type: "PRODUCT",
        unitPriceMinor: 1000,
        currency: "USD",
      });

      await repo.softDeleteById(created._id);

      expect(await repo.findProductById(created._id)).toBeNull();
      expect(await repo.findProducts()).toHaveLength(0);

      const raw = await ProductModel.findById(created._id);
      expect(raw?.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe("currency snapshot", () => {
    it("stores the organisation's currency, not a default", async () => {
      const acme = await seedOrganisation("Acme", "EUR");

      const product = await serviceFor(
        asObjectId(acme.org._id),
        asObjectId(acme.user._id),
      ).create({
        name: "Euro widget",
        type: "PRODUCT",
        unitPriceMinor: 1000,
      });

      expect(product.currency).toBe("EUR");
    });

    it("refuses to create when the organisation cannot be read", async () => {
      const missingOrg = new Types.ObjectId();
      const userId = new Types.ObjectId();

      await expect(
        serviceFor(missingOrg, userId).create({
          name: "Orphan",
          type: "PRODUCT",
          unitPriceMinor: 1000,
        }),
      ).rejects.toBeInstanceOf(ProductError);
    });
  });
});
