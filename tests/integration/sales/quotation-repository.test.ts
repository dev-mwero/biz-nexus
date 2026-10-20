import {
  connectToDatabase,
  disconnectDatabase,
} from "@tests/support/auth-contract";
import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { UserModel } from "@/modules/identity";
import { OrganizationModel } from "@/modules/organizations";
import {
  QuotationModel,
  QuotationRepository,
  QuotationRevisionModel,
  QuotationRevisionRepository,
} from "@/modules/quotations";

/**
 * The quotation repositories against a real MongoDB.
 *
 * Every isolation and uniqueness claim in the module is a claim about the
 * database: the tenant scope is a filter that either reaches MongoDB or does
 * not, the revision index either rejects a duplicate or does not, and the
 * soft-delete exclusion is what `deletedAt: null` in the scope produces. An
 * in-memory fake would assert the mock's behaviour and pass while the index was
 * missing.
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

function quotationsFor(organizationId: Types.ObjectId, userId: Types.ObjectId) {
  return new QuotationRepository(organizationId, userId);
}

function revisionsFor(organizationId: Types.ObjectId, userId: Types.ObjectId) {
  return new QuotationRevisionRepository(organizationId, userId);
}

function quotationInput(
  ownerId: Types.ObjectId,
  overrides: Record<string, unknown> = {},
) {
  return {
    number: "Q-2026-000001",
    currentRevisionId: new Types.ObjectId(),
    currentRevisionNumber: 1,
    companyId: new Types.ObjectId(),
    companyName: "Acme Customer",
    ownerId,
    currency: "USD",
    validUntil: "2026-12-31",
    subtotalMinor: 1000,
    taxMinor: 160,
    totalMinor: 1160,
    ...overrides,
  };
}

function lineInput(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
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

function revisionInput(
  quotationId: Types.ObjectId,
  overrides: Record<string, unknown> = {},
) {
  return {
    quotationId,
    revision: 1,
    lineItems: [lineInput()],
    subtotalMinor: 1000,
    taxMinor: 160,
    totalMinor: 1160,
    validUntil: "2026-12-31",
    customerSnapshot: {
      companyName: "Acme Customer",
      contactName: null,
      contactEmail: null,
      billingAddress: null,
    },
    ...overrides,
  };
}

beforeAll(async () => {
  await connectToDatabase();
  await QuotationModel.createIndexes();
  await QuotationRevisionModel.createIndexes();
});

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await QuotationModel.deleteMany({});
  await QuotationRevisionModel.deleteMany({});
  await OrganizationModel.deleteMany({});
  await UserModel.deleteMany({});
});

describe("QuotationRepository", () => {
  describe("tenant scope", () => {
    it("does not read another organisation's quotation by id or number", async () => {
      const acme = await seedOrganisation("Acme");
      const globex = await seedOrganisation("Globex");
      const ownerId = asObjectId(acme.user._id);

      const created = await quotationsFor(
        asObjectId(acme.org._id),
        ownerId,
      ).create(quotationInput(ownerId));

      const globexRepo = quotationsFor(
        asObjectId(globex.org._id),
        asObjectId(globex.user._id),
      );

      expect(await globexRepo.findQuotationById(created._id)).toBeNull();
      expect(await globexRepo.findQuotationByNumber(created.number)).toBeNull();
    });

    it("lists and counts only the organisation's own quotations", async () => {
      const acme = await seedOrganisation("Acme");
      const globex = await seedOrganisation("Globex");
      const acmeUser = asObjectId(acme.user._id);
      const globexUser = asObjectId(globex.user._id);

      await quotationsFor(asObjectId(acme.org._id), acmeUser).create(
        quotationInput(acmeUser, { number: "Q-2026-000001" }),
      );
      await quotationsFor(asObjectId(globex.org._id), globexUser).create(
        quotationInput(globexUser, { number: "Q-2026-000002" }),
      );

      const acmeRepo = quotationsFor(asObjectId(acme.org._id), acmeUser);

      expect(await acmeRepo.countQuotations()).toBe(1);
      const list = await acmeRepo.findQuotations();
      expect(list).toHaveLength(1);
      expect(list[0].number).toBe("Q-2026-000001");
    });
  });

  describe("writes", () => {
    it("stamps organisation and author on create", async () => {
      const acme = await seedOrganisation("Acme");
      const userId = asObjectId(acme.user._id);

      const created = await quotationsFor(
        asObjectId(acme.org._id),
        userId,
      ).create(quotationInput(userId));

      const raw = await QuotationModel.findById(created._id).lean();
      expect(raw?.organizationId.toString()).toBe(acme.org._id.toString());
      expect(raw?.createdBy?.toString()).toBe(userId.toString());
      expect(raw?.updatedBy?.toString()).toBe(userId.toString());
    });

    it("stamps updatedBy on update and changes only editable fields", async () => {
      const acme = await seedOrganisation("Acme");
      const firstUser = asObjectId(acme.user._id);
      const secondUser = new Types.ObjectId();

      const created = await quotationsFor(
        asObjectId(acme.org._id),
        firstUser,
      ).create(quotationInput(firstUser));

      const updated = await quotationsFor(
        asObjectId(acme.org._id),
        secondUser,
      ).update(created._id, { contactName: "Ada Lovelace" });

      expect(updated?.contactName).toBe("Ada Lovelace");

      const raw = await QuotationModel.findById(created._id).lean();
      expect(raw?.contactName).toBe("Ada Lovelace");
      expect(raw?.updatedBy?.toString()).toBe(secondUser.toString());
      expect(raw?.createdBy?.toString()).toBe(firstUser.toString());
    });

    it("hides a soft-deleted parent from reads while keeping the raw row", async () => {
      const acme = await seedOrganisation("Acme");
      const userId = asObjectId(acme.user._id);
      const repo = quotationsFor(asObjectId(acme.org._id), userId);

      const created = await repo.create(quotationInput(userId));

      await repo.softDeleteById(created._id);

      expect(await repo.findQuotationById(created._id)).toBeNull();
      expect(await repo.findQuotations()).toHaveLength(0);
      expect(await repo.countQuotations()).toBe(0);

      const raw = await QuotationModel.findById(created._id).lean();
      expect(raw).not.toBeNull();
      expect(raw?.deletedAt).toBeInstanceOf(Date);
    });
  });

  describe("indexes at the database", () => {
    it("builds the unique quotation number index", async () => {
      const indexes = await QuotationModel.collection.indexes();
      const entry = indexes.find(
        (index) => index.key.organizationId === 1 && index.key.number === 1,
      );

      expect(entry?.unique).toBe(true);
    });
  });
});

describe("QuotationRevisionRepository", () => {
  describe("tenant scope", () => {
    it("does not read another organisation's revision by id or number", async () => {
      const acme = await seedOrganisation("Acme");
      const globex = await seedOrganisation("Globex");
      const acmeUser = asObjectId(acme.user._id);
      const globexUser = asObjectId(globex.user._id);

      const quotation = await quotationsFor(
        asObjectId(acme.org._id),
        acmeUser,
      ).create(quotationInput(acmeUser));

      const revision = await revisionsFor(
        asObjectId(acme.org._id),
        acmeUser,
      ).create(revisionInput(quotation._id));

      const globexRepo = revisionsFor(asObjectId(globex.org._id), globexUser);

      expect(await globexRepo.findRevisionById(revision._id)).toBeNull();
      expect(
        await globexRepo.findRevisionByNumber(quotation._id, 1),
      ).toBeNull();
    });

    it("lists and counts only the organisation's own revisions", async () => {
      const acme = await seedOrganisation("Acme");
      const globex = await seedOrganisation("Globex");
      const acmeUser = asObjectId(acme.user._id);
      const globexUser = asObjectId(globex.user._id);

      const acmeQuotation = await quotationsFor(
        asObjectId(acme.org._id),
        acmeUser,
      ).create(quotationInput(acmeUser, { number: "Q-2026-000001" }));
      const globexQuotation = await quotationsFor(
        asObjectId(globex.org._id),
        globexUser,
      ).create(quotationInput(globexUser, { number: "Q-2026-000002" }));

      await revisionsFor(asObjectId(acme.org._id), acmeUser).create(
        revisionInput(acmeQuotation._id),
      );
      await revisionsFor(asObjectId(globex.org._id), globexUser).create(
        revisionInput(globexQuotation._id),
      );

      const acmeRepo = revisionsFor(asObjectId(acme.org._id), acmeUser);

      expect(await acmeRepo.countRevisions()).toBe(1);
      const list = await acmeRepo.listRevisions();
      expect(list).toHaveLength(1);
      expect(list[0].quotationId.toString()).toBe(acmeQuotation._id.toString());
    });
  });

  describe("writes", () => {
    it("stamps organisation and author on create", async () => {
      const acme = await seedOrganisation("Acme");
      const userId = asObjectId(acme.user._id);
      const quotationId = new Types.ObjectId();

      const created = await revisionsFor(
        asObjectId(acme.org._id),
        userId,
      ).create(revisionInput(quotationId));

      const raw = await QuotationRevisionModel.findById(created._id).lean();
      expect(raw?.organizationId.toString()).toBe(acme.org._id.toString());
      expect(raw?.createdBy?.toString()).toBe(userId.toString());
      expect(raw?.updatedBy?.toString()).toBe(userId.toString());
    });

    it("rejects a duplicate revision number within a quotation", async () => {
      const acme = await seedOrganisation("Acme");
      const userId = asObjectId(acme.user._id);
      const repo = revisionsFor(asObjectId(acme.org._id), userId);
      const quotationId = new Types.ObjectId();

      await repo.create(revisionInput(quotationId));

      await expect(repo.create(revisionInput(quotationId))).rejects.toThrow();
    });

    it("stamps updatedBy on update", async () => {
      const acme = await seedOrganisation("Acme");
      const firstUser = asObjectId(acme.user._id);
      const secondUser = new Types.ObjectId();
      const quotationId = new Types.ObjectId();

      const created = await revisionsFor(
        asObjectId(acme.org._id),
        firstUser,
      ).create(revisionInput(quotationId));

      const updated = await revisionsFor(
        asObjectId(acme.org._id),
        secondUser,
      ).update(created._id, { terms: "Net 30" });

      expect(updated?.terms).toBe("Net 30");

      const raw = await QuotationRevisionModel.findById(created._id).lean();
      expect(raw?.terms).toBe("Net 30");
      expect(raw?.updatedBy?.toString()).toBe(secondUser.toString());
      expect(raw?.createdBy?.toString()).toBe(firstUser.toString());
    });
  });

  describe("indexes at the database", () => {
    it("builds the unique quotation revision index", async () => {
      const indexes = await QuotationRevisionModel.collection.indexes();
      const entry = indexes.find(
        (index) =>
          index.key.organizationId === 1 &&
          index.key.quotationId === 1 &&
          index.key.revision === 1,
      );

      expect(entry?.unique).toBe(true);
    });
  });
});
