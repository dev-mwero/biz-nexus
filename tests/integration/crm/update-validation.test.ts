import mongoose, { Types } from "mongoose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { CompanyModel } from "@/modules/crm/company.model";
import { CompanyRepository } from "@/modules/crm/company.repository";
import { ContactModel } from "@/modules/crm/contact.model";
import { ContactRepository } from "@/modules/crm/contact.repository";
import { TagModel } from "@/modules/crm/tag.model";
import { TagRepository } from "@/modules/crm/tag.repository";
import { toErrorPayload } from "@/shared/errors/app-error";

/**
 * The same change, in the modules the deals suite cannot reach.
 *
 * Update validation is not a deals feature — it lives in `TenantRepository`, so
 * it now applies to every repository in the tree, and every one of them has
 * update paths that were relying on not being validated. Writing a full suite
 * per module would be the wrong shape for a change this broad; what matters is
 * that the three shapes of write below are checked once each, somewhere other
 * than where the change was found.
 *
 * Repository level rather than through a route, and deliberately: the routes in
 * these modules validate with zod before the repository is reached, so a route
 * test would mostly re-prove zod. The bug lived in the layer beneath that.
 */
const ORG_ID = new Types.ObjectId("64b0000000000000000000a1");
const ACTOR_ID = new Types.ObjectId("64b0000000000000000000c3");

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([
    CompanyModel.deleteMany({}),
    ContactModel.deleteMany({}),
    TagModel.deleteMany({}),
  ]);
});

function createCompany(overrides: Record<string, unknown> = {}) {
  return CompanyModel.create({
    organizationId: ORG_ID,
    name: "Acme",
    domain: "acme.example",
    status: "PROSPECT",
    ownerId: ACTOR_ID,
    size: 50,
    annualRevenue: 1000,
    tags: [],
    customFields: {},
    createdBy: ACTOR_ID,
    updatedBy: ACTOR_ID,
    ...overrides,
  });
}

/** The error a write was refused with, or a failure saying it was not refused. */
async function refusal(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error("expected the write to be refused, and it was not");
    },
    (error: unknown) => error,
  );
}

describe("CompanyRepository updates", () => {
  let repo: CompanyRepository;

  beforeEach(() => {
    repo = new CompanyRepository(ORG_ID, ACTOR_ID);
  });

  it("refuses a number its own schema says is too small", async () => {
    const company = await createCompany();

    const error = await refusal(
      repo.findByIdAndUpdate(company._id, { $set: { annualRevenue: -1 } }),
    );

    expect(error).toBeInstanceOf(mongoose.Error.ValidationError);
    expect(
      (await CompanyModel.findById(company._id).lean())?.annualRevenue,
    ).toBe(1000);
  });

  it("keeps a validator this codebase wrote, and its own words", async () => {
    // `website` carries a validator rather than a `maxlength`, so the message
    // has to come from the schema author instead of being synthesised. If this
    // one came back generic the client would be told only that something was
    // wrong with a field it had validated itself.
    const company = await createCompany();

    const error = await refusal(
      repo.findByIdAndUpdate(company._id, {
        $set: { website: "acme.example/pricing" },
      }),
    );

    expect(error).toBeInstanceOf(mongoose.Error.ValidationError);
    expect(toErrorPayload(error).details).toEqual([
      {
        path: "website",
        message:
          "Website must be a valid URL starting with http:// or https://",
      },
    ]);
  });

  it("still applies an update the schema accepts", async () => {
    const company = await createCompany();

    const updated = await repo.findByIdAndUpdate(company._id, {
      $set: { name: "Acme Industries", annualRevenue: 5000 },
    });

    expect(updated?.name).toBe("Acme Industries");
    expect(updated?.annualRevenue).toBe(5000);
    // The fields the update did not mention are still there, which is the
    // property that distinguishes a validated `$set` from a validated whole
    // document.
    expect(updated?.domain).toBe("acme.example");
  });
});

describe("ContactRepository updates", () => {
  it("refuses a name past the length its own schema declares", async () => {
    const contact = await ContactModel.create({
      organizationId: ORG_ID,
      firstName: "John",
      lastName: "Doe",
      ownerId: ACTOR_ID,
      emails: [],
      phones: [],
      status: "LEAD",
      tags: [],
      customFields: {},
      createdBy: ACTOR_ID,
      updatedBy: ACTOR_ID,
    });

    const error = await refusal(
      new ContactRepository(ORG_ID, ACTOR_ID).findByIdAndUpdate(contact._id, {
        $set: { firstName: "n".repeat(81) },
      }),
    );

    expect(error).toBeInstanceOf(mongoose.Error.ValidationError);
    expect((await ContactModel.findById(contact._id).lean())?.firstName).toBe(
      "John",
    );
  });
});

describe("the writes that do not set a value", () => {
  /**
   * `$inc` is the one write in the tree that carries no value for a validator to
   * check, and `tag.service` uses it — inside a transaction, while merging two
   * tags. Mongoose 9 runs update validators over `$set` and `$push` but not over
   * the target path of an `$inc` (see `mongoose/lib/helpers/updateValidators.js`),
   * so turning validation on must not have broken the counter it maintains.
   *
   * Asserted through `usageCount` rather than through the absence of an error,
   * because "did not throw" would also be true of a write that did nothing.
   */
  it("still increments the tag counter in both directions", async () => {
    const tag = await TagModel.create({
      organizationId: ORG_ID,
      name: "hot-lead",
      color: "red",
      usageCount: 5,
      createdBy: ACTOR_ID,
      updatedBy: ACTOR_ID,
    });
    const repo = new TagRepository(ORG_ID, ACTOR_ID);

    await repo.incrementUsage(tag._id, 3);
    expect((await TagModel.findById(tag._id).lean())?.usageCount).toBe(8);

    await repo.incrementUsage(tag._id, -8);
    expect((await TagModel.findById(tag._id).lean())?.usageCount).toBe(0);
  });

  it("still restores a soft-deleted row", async () => {
    // Soft delete and restore set server-generated fields through the model
    // directly rather than through this class, so they were never at risk. They
    // are here because a "validate every update" change is exactly the kind of
    // change that quietly stops a delete from being undoable.
    const company = await createCompany();
    const repo = new CompanyRepository(ORG_ID, ACTOR_ID);

    await repo.softDeleteById(company._id);
    expect(
      (await CompanyModel.findById(company._id).lean())?.deletedAt,
    ).not.toBe(null);

    await repo.restoreById(company._id);
    expect((await CompanyModel.findById(company._id).lean())?.deletedAt).toBe(
      null,
    );
  });
});
