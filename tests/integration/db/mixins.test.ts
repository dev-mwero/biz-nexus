import { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { hasAuditFields } from "@/db/mixins/audit-fields";
import { slugField } from "@/db/mixins/slug";
import { isSoftDeleteSchema } from "@/db/mixins/soft-delete";
import {
  MixinCompanyModel,
  MixinCompanyRepository,
  PlainRecordModel,
  PlainRecordRepository,
} from "../../support/fixtures/mixin-models";

const ORG = new Types.ObjectId("64b0000000000000000000a1");
const OTHER_ORG = new Types.ObjectId("64b0000000000000000000b2");
const ALICE = new Types.ObjectId("64b0000000000000000000c3");
const BOB = new Types.ObjectId("64b0000000000000000000d4");

beforeEach(async () => {
  await connectToDatabase();
  await MixinCompanyModel.deleteMany({});
  await PlainRecordModel.deleteMany({});
});

afterEach(async () => {
  await MixinCompanyModel.deleteMany({});
  await PlainRecordModel.deleteMany({});
});

async function seed(actorId: Types.ObjectId = ALICE) {
  return new MixinCompanyRepository(ORG, actorId).create({
    name: "Acme",
    slug: "acme",
  });
}

describe("markers", () => {
  it("the mixin marks the schema the repository reads", () => {
    expect(isSoftDeleteSchema(MixinCompanyModel.schema)).toBe(true);
    expect(hasAuditFields(MixinCompanyModel.schema)).toBe(true);
    expect(slugField(MixinCompanyModel.schema)).toBe("slug");
  });

  it("a schema without the mixins is unmarked, and adapts", async () => {
    // The repository must not assume every collection has these features, or
    // the first non-soft-delete collection would query for a field that does
    // not exist and match nothing.
    expect(isSoftDeleteSchema(PlainRecordModel.schema)).toBe(false);
    expect(hasAuditFields(PlainRecordModel.schema)).toBe(false);

    const record = await new PlainRecordRepository(ORG).create({
      name: "Plain",
    });
    expect(
      await new PlainRecordRepository(ORG).findById(record._id),
    ).not.toBeNull();
  });
});

describe("SoftDelete", () => {
  it("defaults deletedAt to null", async () => {
    const company = await seed();
    expect(company.deletedAt).toBeNull();
  });

  it("hides a deleted record from find", async () => {
    const company = await seed();
    const repo = new MixinCompanyRepository(ORG, ALICE);
    await repo.softDeleteById(company._id);

    expect(await repo.find({})).toHaveLength(0);
  });

  it("hides a deleted record from findById", async () => {
    const company = await seed();
    const repo = new MixinCompanyRepository(ORG, ALICE);
    await repo.softDeleteById(company._id);

    expect(await repo.findById(company._id)).toBeNull();
  });

  it("hides a deleted record from a count and from exists", async () => {
    const company = await seed();
    const repo = new MixinCompanyRepository(ORG, ALICE);
    await repo.softDeleteById(company._id);

    expect(await repo.countDocuments({})).toBe(0);
    expect(await repo.exists({ name: "Acme" })).toBe(false);
  });

  it("refuses to update a deleted record", async () => {
    // A deleted row that can still be updated is a row the audit view and the
    // live view disagree about.
    const company = await seed();
    const repo = new MixinCompanyRepository(ORG, ALICE);
    await repo.softDeleteById(company._id);

    const result = await repo.updateOne({ _id: company._id } as never, {
      $set: { name: "Zombie" },
    });

    expect(result.matchedCount).toBe(0);
    expect((await MixinCompanyModel.findById(company._id))?.name).toBe("Acme");
  });

  it("refuses to delete an already-deleted record", async () => {
    const company = await seed();
    const repo = new MixinCompanyRepository(ORG, ALICE);
    await repo.softDeleteById(company._id);

    const again = await repo.softDeleteById(company._id);
    expect(again.matchedCount).toBe(0);
  });

  it("restores a deleted record", async () => {
    const company = await seed();
    const repo = new MixinCompanyRepository(ORG, ALICE);
    await repo.softDeleteById(company._id);
    await repo.restoreById(company._id);

    expect(await repo.findById(company._id)).not.toBeNull();
  });

  it("does not restore across organisations", async () => {
    // restoreById bypasses the soft-delete filter, so the organisation scope is
    // the only thing standing between one tenant and another's trash.
    const company = await seed();
    const repoA = new MixinCompanyRepository(ORG, ALICE);
    await repoA.softDeleteById(company._id);

    const result = await new MixinCompanyRepository(OTHER_ORG, BOB).restoreById(
      company._id,
    );

    expect(result.matchedCount).toBe(0);
    expect(
      (await MixinCompanyModel.findById(company._id))?.deletedAt,
    ).not.toBeNull();
  });

  it("findWithDeleted sees the trash", async () => {
    const company = await seed();
    const repo = new MixinCompanyRepository(ORG, ALICE);
    await repo.softDeleteById(company._id);

    expect(await repo.findWithDeleted({})).toHaveLength(1);
    expect(await repo.findOnlyDeleted({})).toHaveLength(1);
    expect(await repo.countWithDeleted({})).toBe(1);
  });

  it("keeps the tenant scope on the deleted-reading methods", async () => {
    const acme = await seed();
    const other = await new MixinCompanyRepository(OTHER_ORG, BOB).create({
      name: "Beta",
      slug: "beta",
    });

    await new MixinCompanyRepository(ORG, ALICE).softDeleteById(acme._id);
    await new MixinCompanyRepository(OTHER_ORG, BOB).softDeleteById(other._id);

    // Both deleted, but each organisation sees only its own.
    expect(
      await new MixinCompanyRepository(ORG, ALICE).findOnlyDeleted({}),
    ).toHaveLength(1);
    expect(
      await new MixinCompanyRepository(OTHER_ORG, BOB).findOnlyDeleted({}),
    ).toHaveLength(1);
  });

  it("refuses a hard delete on a soft-delete collection", async () => {
    // The one-word slip this prevents: deleteOne() reading identically to
    // softDeleteOne() at the call site while destroying the row for good.
    const repo = new MixinCompanyRepository(ORG, ALICE);
    expect(() => repo.deleteOne({} as never)).toThrow(/soft-delete collection/);
    expect(() => repo.deleteMany({} as never)).toThrow(
      /soft-delete collection/,
    );
  });

  it("allows a hard delete when it is named as one", async () => {
    const repo = new MixinCompanyRepository(ORG, ALICE);
    const company = await seed();

    await repo.hardDeleteById(company._id);

    expect(await MixinCompanyModel.findById(company._id)).toBeNull();
  });

  it("softDeleteOne hides a single match", async () => {
    const repo = new MixinCompanyRepository(ORG, ALICE);
    await repo.create({ name: "One", slug: "one" });
    await repo.create({ name: "Two", slug: "two" });

    await repo.softDeleteOne({ name: "One" } as never);

    expect((await repo.find({})).map((c) => c.name)).toEqual(["Two"]);
  });

  it("softDeleteMany hides every match", async () => {
    const repo = new MixinCompanyRepository(ORG, ALICE);
    await repo.create({ name: "One", slug: "one" });
    await repo.create({ name: "Two", slug: "two" });

    const result = await repo.softDeleteMany({} as never);

    expect(result.modifiedCount).toBe(2);
    expect(await repo.find({})).toHaveLength(0);
    expect(await repo.countWithDeleted({})).toBe(2);
  });

  it("still allows a hard delete on a collection without the mixin", async () => {
    // Sessions and tokens are meant to be erased, and the guard must not make
    // that impossible — only deliberate.
    const repo = new PlainRecordRepository(ORG);
    const record = await repo.create({ name: "Plain" });

    await repo.deleteOne({ _id: record._id } as never);

    expect(await PlainRecordModel.findById(record._id)).toBeNull();
  });

  it("a model without the mixin is not filtered on a field it lacks", async () => {
    // The failure this prevents: a collection with no deletedAt being queried
    // as though every row were deleted, so the account simply looks empty.
    await new PlainRecordRepository(ORG).create({ name: "Plain" });

    expect(await new PlainRecordRepository(ORG).countDocuments({})).toBe(1);
  });
});

describe("AuditFields", () => {
  it("stamps createdBy and updatedBy on create", async () => {
    const company = await seed(ALICE);
    expect(company.createdBy?.toString()).toBe(ALICE.toString());
    expect(company.updatedBy?.toString()).toBe(ALICE.toString());
  });

  it("moves updatedBy on update but leaves createdBy alone", async () => {
    const company = await seed(ALICE);
    await new MixinCompanyRepository(ORG, BOB).updateOne(
      { _id: company._id } as never,
      { $set: { name: "Acme Corp" } },
    );

    const after = await MixinCompanyModel.findById(company._id);
    expect(after?.createdBy?.toString()).toBe(ALICE.toString());
    expect(after?.updatedBy?.toString()).toBe(BOB.toString());
  });

  it("ignores a caller-supplied author", async () => {
    // A client that can name its own author is an audit log that records what
    // the client wanted.
    const repo = new MixinCompanyRepository(ORG, ALICE);
    const company = await repo.create({
      name: "Acme",
      slug: "acme",
      createdBy: BOB,
    } as never);

    expect(company.createdBy?.toString()).toBe(ALICE.toString());
  });

  it("stamps the delete and the restore", async () => {
    const company = await seed(ALICE);
    await new MixinCompanyRepository(ORG, BOB).softDeleteById(company._id);
    expect(
      (await MixinCompanyModel.findById(company._id))?.updatedBy?.toString(),
    ).toBe(BOB.toString());

    await new MixinCompanyRepository(ORG, ALICE).restoreById(company._id);
    expect(
      (await MixinCompanyModel.findById(company._id))?.updatedBy?.toString(),
    ).toBe(ALICE.toString());
  });

  it("leaves the fields absent when there is no acting user", async () => {
    // A migration or a scheduled job has no user. Null would read as "deleted
    // by nobody", which is a different claim from "not tracked here".
    const company = await new MixinCompanyRepository(ORG).create({
      name: "Seeded",
      slug: "seeded",
    });

    expect(company.createdBy ?? null).toBeNull();
  });

  it("stamps findByIdAndUpdate", async () => {
    const company = await seed(ALICE);
    await new MixinCompanyRepository(ORG, BOB).findByIdAndUpdate(company._id, {
      $set: { name: "Renamed" },
    });

    expect(
      (await MixinCompanyModel.findById(company._id))?.updatedBy?.toString(),
    ).toBe(BOB.toString());
  });
});
