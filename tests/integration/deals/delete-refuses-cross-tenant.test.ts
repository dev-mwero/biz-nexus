import {
  connectToDatabase,
  disconnectDatabase,
} from "@tests/support/auth-contract";
import { Types } from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DealModel } from "@/modules/deals/deal.model";
import { DealRepository } from "@/modules/deals/deal.repository";
import { DealError, DealService } from "@/modules/deals/deal.service";
import { PipelineModel } from "@/modules/pipelines";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";

/**
 * `DealService.delete` has to distinguish "deleted" from "there was nothing to
 * delete", because `DELETE /api/v1/deals/:id` answers `204` from whatever this
 * returns. It did not used to: the method returned `void`, the repository's
 * `softDeleteById` is scoped and so silently matched nothing, and the route
 * reported success for a deal that belonged to somebody else.
 *
 * The tenancy boundary held throughout — the record was never written to — so
 * nothing here is about the record surviving. It is about the answer being true,
 * which is the difference between a caller that retries on failure and one that
 * walks away believing a deal is archived when it is not.
 */

function asObjectId(id: string | Types.ObjectId): Types.ObjectId {
  return typeof id === "string" ? new Types.ObjectId(id) : id;
}

async function seedOrganisation(label: string) {
  const { OrganizationModel } = await import("@/modules/organizations");
  const { UserModel } = await import("@/modules/identity");

  const org = await OrganizationModel.create({
    name: label,
    slug: `${label.toLowerCase()}-${new Types.ObjectId()}`,
  });
  const user = await UserModel.create({
    email: `${label.toLowerCase()}-${new Types.ObjectId()}@example.com`,
    name: label,
    passwordHash: "hash",
    emailVerifiedAt: new Date(),
  });
  return { org, user };
}

async function seedDeal(
  organizationId: Types.ObjectId,
  ownerId: Types.ObjectId,
) {
  const pipeline = await PipelineModel.create({
    organizationId,
    name: "Pipeline",
    isDefault: true,
    stages: [{ key: "NEW", name: "New", order: 1, probability: 10 }],
  });
  const stageId = pipeline.stages[0]._id;

  return DealModel.create({
    organizationId,
    name: "A deal",
    pipelineId: pipeline._id,
    stageId,
    value: 1000,
    currency: "USD",
    ownerId,
    createdBy: ownerId,
  });
}

function serviceFor(organizationId: Types.ObjectId, userId: Types.ObjectId) {
  return new DealService(
    new DealRepository(organizationId, userId),
    new PipelineRepository(organizationId, userId),
    userId,
  );
}

beforeAll(async () => {
  await connectToDatabase();
});

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(async () => {
  await DealModel.deleteMany({});
  await PipelineModel.deleteMany({});
});

describe("DealService.delete", () => {
  it("soft deletes a deal in the caller's own organisation", async () => {
    const { org, user } = await seedOrganisation("Acme");
    const deal = await seedDeal(asObjectId(org._id), asObjectId(user._id));

    await serviceFor(asObjectId(org._id), asObjectId(user._id)).delete(
      deal._id,
    );

    const reread = await DealModel.findById(deal._id);
    expect(reread?.deletedAt).toBeInstanceOf(Date);
  });

  it("refuses a deal in another organisation and does not touch it", async () => {
    const acme = await seedOrganisation("Acme");
    const globex = await seedOrganisation("Globex");
    const acmeDeal = await seedDeal(
      asObjectId(acme.org._id),
      asObjectId(acme.user._id),
    );

    // Globex is the caller here, with a full session and every permission. The
    // refusal has to come from the scope finding nothing rather than from a
    // guard, or this test would still pass if the scope were removed.
    await expect(
      serviceFor(
        asObjectId(globex.org._id),
        asObjectId(globex.user._id),
      ).delete(acmeDeal._id),
    ).rejects.toThrow(DealError);

    const reread = await DealModel.findById(acmeDeal._id);
    expect(reread?.deletedAt).toBeNull();
  });

  it("refuses an id that matches no deal at all", async () => {
    const { org, user } = await seedOrganisation("Acme");

    await expect(
      serviceFor(asObjectId(org._id), asObjectId(user._id)).delete(
        new Types.ObjectId(),
      ),
    ).rejects.toThrow(DealError);
  });

  it("refuses a deal that is already soft deleted", async () => {
    // A second DELETE of the same deal is not a success either. Without this the
    // route would answer 204 twice for one delete, and a client retrying after a
    // timeout would have no way to tell a duplicate from a fresh one.
    const { org, user } = await seedOrganisation("Acme");
    const deal = await seedDeal(asObjectId(org._id), asObjectId(user._id));
    const service = serviceFor(asObjectId(org._id), asObjectId(user._id));

    await service.delete(deal._id);

    await expect(service.delete(deal._id)).rejects.toThrow(DealError);
  });

  it("reports RECORD_NOT_FOUND rather than a generic failure", async () => {
    const { org, user } = await seedOrganisation("Acme");

    const error = await serviceFor(asObjectId(org._id), asObjectId(user._id))
      .delete(new Types.ObjectId())
      .then(
        () => {
          throw new Error("expected the delete to be refused");
        },
        (caught: unknown) => caught,
      );

    // The route maps this code to 404. A refusal that arrived as some other code
    // would surface as a 500, and "500 on a cross-tenant delete" is a very
    // different thing to debug than "404".
    expect(error).toBeInstanceOf(DealError);
    expect((error as DealError).code).toBe("RECORD_NOT_FOUND");
  });
});
