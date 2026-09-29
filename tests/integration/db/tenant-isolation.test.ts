import { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { TenantAggregateRepository } from "@/db/tenant-repository";
import {
  ContactModel,
  ContactRepository,
  type FixtureContact,
} from "../../support/fixtures/contact-repository";

/**
 * The isolation suite, and the reason the whole repository layer exists.
 *
 * MongoDB has no row-level security, so every one of these assertions is
 * checking that *this code* added the scope — not that MongoDB did. A test that
 * passed because of a database feature that does not exist would be worse than
 * no test at all, because it would be read as evidence.
 *
 * The case that matters most is last: a caller who is a member of *both*
 * organisations, holding an explicit id from the other one. An implementation
 * that scopes by "the user's current org" passes every other test here and
 * still leaks on that one.
 */

const ORG_A = new Types.ObjectId("64b0000000000000000000a1");
const ORG_B = new Types.ObjectId("64b0000000000000000000b2");
const USER = new Types.ObjectId("64b0000000000000000000c3");

let contactA: FixtureContact;
let contactB: FixtureContact;

beforeEach(async () => {
  await connectToDatabase();
  await ContactModel.deleteMany({});

  const repoA = new ContactRepository(ORG_A);
  const repoB = new ContactRepository(ORG_B);

  contactA = await repoA.create({
    name: "Alice Acme",
    email: "alice@acme.test",
    ownerId: USER,
  });
  contactB = await repoB.create({
    name: "Bob Beta",
    email: "bob@beta.test",
    ownerId: USER,
  });
});

afterEach(async () => {
  await ContactModel.deleteMany({});
});

describe("tenant isolation", () => {
  it("scopes a plain find", async () => {
    const found = await new ContactRepository(ORG_A).find({});
    expect(found.map((c) => c.name)).toEqual(["Alice Acme"]);
  });

  it("returns null for a foreign id rather than the record", async () => {
    // The core assertion. A 404 here is the whole product promise; a returned
    // document is a disclosure of another customer's name and email.
    const result = await new ContactRepository(ORG_A).findById(contactB._id);
    expect(result).toBeNull();
  });

  it("finds its own record", async () => {
    const result = await new ContactRepository(ORG_A).findById(contactA._id);
    expect(result?.name).toBe("Alice Acme");
  });

  it("excludes foreign ids from a batch lookup", async () => {
    const found = await new ContactRepository(ORG_A).findByIds([
      contactA._id,
      contactB._id,
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("Alice Acme");
  });

  it("does not count another organisation's records", async () => {
    expect(await new ContactRepository(ORG_A).countDocuments({})).toBe(1);
    expect(await new ContactRepository(ORG_B).countDocuments({})).toBe(1);
  });

  it("reports existence only within the scope", async () => {
    const repoA = new ContactRepository(ORG_A);
    expect(await repoA.exists({ name: "Alice Acme" })).toBe(true);
    expect(await repoA.exists({ name: "Bob Beta" })).toBe(false);
  });

  it("cannot update a foreign record", async () => {
    const result = await new ContactRepository(ORG_A).updateOne(
      { _id: contactB._id } as never,
      { $set: { name: "Compromised" } },
    );

    expect(result.matchedCount).toBe(0);
    expect((await ContactModel.findById(contactB._id))?.name).toBe("Bob Beta");
  });

  it("cannot update a foreign record through findByIdAndUpdate", async () => {
    const result = await new ContactRepository(ORG_A).findByIdAndUpdate(
      contactB._id,
      {
        $set: { name: "Compromised" },
      },
    );

    // Both halves matter: null so the caller sees a miss, and the document
    // untouched so the miss was real rather than cosmetic.
    expect(result).toBeNull();
    expect((await ContactModel.findById(contactB._id))?.name).toBe("Bob Beta");
  });

  it("cannot delete a foreign record", async () => {
    const result = await new ContactRepository(ORG_A).deleteOne({
      _id: contactB._id,
    } as never);

    expect(result.deletedCount).toBe(0);
    expect(await ContactModel.findById(contactB._id)).not.toBeNull();
  });

  it("cannot updateMany across the boundary", async () => {
    await new ContactRepository(ORG_A).updateMany({} as never, {
      $set: { name: "Compromised" },
    });

    expect((await ContactModel.findById(contactB._id))?.name).toBe("Bob Beta");
  });

  it("writes the scope on create", async () => {
    // A document saved without the scope would be invisible to every scoped
    // read, and therefore invisible to the user who just created it.
    const created = await new ContactRepository(ORG_A).create({
      name: "Carol",
      email: "carol@acme.test",
      ownerId: USER,
    });

    expect(created.organizationId.toString()).toBe(ORG_A.toString());
    expect(
      await new ContactRepository(ORG_A).findById(created._id),
    ).not.toBeNull();
  });

  it("stamps the scope on every document in insertMany", async () => {
    await new ContactRepository(ORG_A).insertMany([
      { name: "D", email: "d@acme.test", ownerId: USER },
      { name: "E", email: "e@acme.test", ownerId: USER },
    ]);

    const docs = await ContactModel.find({ organizationId: ORG_A });
    expect(docs).toHaveLength(3);
  });
});

describe("tenant isolation with a caller who belongs to both organisations", () => {
  /**
   * The case that separates a real implementation from a plausible one.
   *
   * Every test above passes for an implementation that scopes by "the user's
   * current organisation". This one does not: the caller is entitled to both,
   * the id is explicit, and the answer is still 404. SECURITY.md calls this the
   * strongest case, and it is right.
   */
  it("returns 404 for an explicit id from the other organisation", async () => {
    const repoForA = new ContactRepository(ORG_A);

    // The caller can see both orgs and holds a valid id for B's record.
    const result = await repoForA.findById(contactB._id);

    expect(result).toBeNull();
  });

  it("still cannot update it", async () => {
    await new ContactRepository(ORG_A).updateOne(
      { _id: contactB._id } as never,
      {
        $set: { name: "Compromised" },
      },
    );

    expect((await ContactModel.findById(contactB._id))?.name).toBe("Bob Beta");
  });

  it("reverses cleanly: B is equally unable to reach A", async () => {
    expect(
      await new ContactRepository(ORG_B).findById(contactA._id),
    ).toBeNull();
  });
});

describe("aggregates", () => {
  it("counts only the calling organisation's rows", async () => {
    const repo = new TenantAggregateRepository<FixtureContact>(
      ContactModel,
      ORG_A,
    );

    const [result] = await repo
      .aggregate<{ count: number }>([
        { $match: { organizationId: { $in: [ORG_A] } } },
        { $group: { _id: null, count: { $sum: 1 } } },
      ])
      .exec();

    expect(result.count).toBe(1);
  });

  it("refuses a pipeline that does not start with a scoped $match", () => {
    const repo = new TenantAggregateRepository<FixtureContact>(
      ContactModel,
      ORG_A,
    );

    expect(() =>
      repo.aggregate([{ $group: { _id: null, count: { $sum: 1 } } }] as never),
    ).toThrow(/must begin with a \$match/);
  });

  it("refuses an unscoped $match", () => {
    const repo = new TenantAggregateRepository<FixtureContact>(
      ContactModel,
      ORG_A,
    );

    expect(() => repo.aggregate([{ $match: {} }])).toThrow(/organizationId/);
  });

  it("refuses a $match that appears only after a $lookup", () => {
    // Correct MongoDB, still a leak: the lookup has already read the other
    // collection by the time the match runs.
    const repo = new TenantAggregateRepository<FixtureContact>(
      ContactModel,
      ORG_A,
    );

    expect(() =>
      repo.aggregate([
        {
          $lookup: {
            from: "test_contacts",
            localField: "_id",
            foreignField: "_id",
            as: "all",
          },
        },
        { $match: { organizationId: { $in: [ORG_A] } } },
      ] as never),
    ).toThrow(/must begin with a \$match/);
  });
});

describe("construction", () => {
  it("refuses a blank organizationId", () => {
    // A blank id matches nothing and reads like an empty account, which is a
    // far worse failure than refusing to construct.
    expect(() => new ContactRepository("")).toThrow(
      /requires an organizationId/,
    );
  });

  it("refuses a malformed organizationId", () => {
    expect(() => new ContactRepository("not-an-object-id")).toThrow(
      /invalid organizationId/,
    );
  });

  it("accepts a string id and exposes it as an ObjectId", () => {
    const repo = new ContactRepository(ORG_A.toString());
    expect(repo.organizationId).toBeInstanceOf(Types.ObjectId);
    expect(repo.organizationId.toString()).toBe(ORG_A.toString());
  });
});

describe("the escape hatch", () => {
  it("refuses to run without a real reason", () => {
    const repo = new ContactRepository(ORG_A);
    expect(() => repo.findUnscoped("")).toThrow(/requires a real reason/);
    expect(() => repo.findUnscoped("login")).toThrow(/requires a real reason/);
  });

  it("refuses a whitespace reason", () => {
    const repo = new ContactRepository(ORG_A);
    expect(() => repo.findUnscoped("            ", {})).toThrow(
      /requires a real reason/,
    );
  });

  it("crosses tenants when given a genuine reason", async () => {
    // Login by email, before an organisation is known. The one legitimate
    // cross-tenant read in the product.
    const found = await new ContactRepository(ORG_A).findUnscoped(
      "resolving a user by email during login, before an organisation is known",
      { email: "bob@beta.test" },
    );

    expect(found).toHaveLength(1);
    expect(found[0].name).toBe("Bob Beta");
  });
});
