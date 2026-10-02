import { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase, disconnectDatabase } from "@/db/connection";
import { DealModel } from "@/modules/deals/deal.model";
import { UserModel } from "@/modules/identity/user.model";
import { MembershipModel } from "@/modules/organizations/membership.model";
import { OrganizationModel } from "@/modules/organizations/organization.model";
import { RoleModel } from "@/modules/organizations/role.model";
import { PipelineModel } from "@/modules/pipelines/pipeline.model";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { PipelineService } from "@/modules/pipelines/pipeline.service";

describe("Pipelines integration: tenant isolation + service logic", () => {
  let org1: Types.ObjectId;
  let org2: Types.ObjectId;
  let user1: Types.ObjectId; // owner of org1
  let user2: Types.ObjectId; // owner of org2
  let user3: Types.ObjectId; // member of org1
  let roleOwner: Types.ObjectId;
  let roleMember: Types.ObjectId;

  beforeEach(async () => {
    await connectToDatabase();

    // Create two organizations
    const orgs = (await OrganizationModel.create([
      {
        name: "Org 1",
        slug: "org-1",
        createdBy: new Types.ObjectId(),
        updatedBy: new Types.ObjectId(),
      },
      {
        name: "Org 2",
        slug: "org-2",
        createdBy: new Types.ObjectId(),
        updatedBy: new Types.ObjectId(),
      },
    ])) as Array<{ _id: Types.ObjectId }>;
    org1 = orgs[0]._id;
    org2 = orgs[1]._id;

    // Create users. `users` is global, not tenant-owned, so it carries no
    // organizationId and no audit stamps.
    const users = await UserModel.create([
      {
        email: "user1@test.com",
        name: "User 1",
        passwordHash: "hash",
      },
      {
        email: "user2@test.com",
        name: "User 2",
        passwordHash: "hash",
      },
      {
        email: "user3@test.com",
        name: "User 3",
        passwordHash: "hash",
      },
    ]);
    user1 = users[0]._id;
    user2 = users[1]._id;
    user3 = users[2]._id;

    // Create roles for org1
    const roles = (await RoleModel.create([
      {
        organizationId: org1,
        key: "OWNER",
        name: "Owner",
        permissions: [
          "pipelines.read",
          "pipelines.create",
          "pipelines.update",
          "pipelines.delete",
        ],
        createdBy: user1,
        updatedBy: user1,
      },
      {
        organizationId: org1,
        key: "MEMBER",
        name: "Member",
        permissions: ["pipelines.read"],
        createdBy: user1,
        updatedBy: user1,
      },
    ])) as Array<{ _id: Types.ObjectId }>;
    roleOwner = roles[0]._id;
    roleMember = roles[1]._id;

    // Create memberships
    await MembershipModel.create([
      {
        organizationId: org1,
        userId: user1,
        roleId: roleOwner,
        status: "ACTIVE",
        joinedAt: new Date(),
      },
      {
        organizationId: org1,
        userId: user3,
        roleId: roleMember,
        status: "ACTIVE",
        joinedAt: new Date(),
      },
      {
        organizationId: org2,
        userId: user2,
        roleId: roleOwner,
        status: "ACTIVE",
        joinedAt: new Date(),
      },
    ]);
  });

  afterEach(async () => {
    await DealModel.deleteMany({});
    await PipelineModel.deleteMany({});
    await MembershipModel.deleteMany({});
    await RoleModel.deleteMany({});
    await UserModel.deleteMany({});
    await OrganizationModel.deleteMany({});
    await disconnectDatabase();
  });

  describe("Tenant isolation", () => {
    it("should not allow org1 user to see org2 pipelines", async () => {
      // Create pipelines in both orgs
      const pipelines = await PipelineModel.create([
        {
          organizationId: org1,
          name: "Org1 Pipeline",
          isDefault: true,
          order: 0,
          stages: [],
          createdBy: user1,
          updatedBy: user1,
        },
        {
          organizationId: org2,
          name: "Org2 Pipeline",
          isDefault: true,
          order: 0,
          stages: [],
          createdBy: user2,
          updatedBy: user2,
        },
      ]);
      const p1 = pipelines[0];
      const p2 = pipelines[1];

      const repo1 = new PipelineRepository(org1, user1);
      const service1 = new PipelineService(repo1, user1);

      const result = await service1.list();
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Org1 Pipeline");
      expect(result[0].organizationId.toString()).toBe(org1.toString());
    });

    it("should not allow org1 user to read org2 pipeline by ID", async () => {
      const p2 = await PipelineModel.create({
        organizationId: org2,
        name: "Org2 Pipeline",
        isDefault: true,
        order: 0,
        stages: [],
        createdBy: user2,
        updatedBy: user2,
      });

      const repo1 = new PipelineRepository(org1, user1);
      const service1 = new PipelineService(repo1, user1);

      const pipeline = await service1.getById(p2._id);
      expect(pipeline).toBeNull();
    });

    it("should not allow org1 user to update org2 pipeline", async () => {
      const p2 = await PipelineModel.create({
        organizationId: org2,
        name: "Org2 Pipeline",
        isDefault: true,
        order: 0,
        stages: [],
        createdBy: user2,
        updatedBy: user2,
      });

      const repo1 = new PipelineRepository(org1, user1);
      const service1 = new PipelineService(repo1, user1);

      const updated = await service1.update(p2._id, { name: "Hacked" });
      expect(updated).toBeNull();
    });

    it("should not allow org1 user to delete org2 pipeline", async () => {
      const p2 = await PipelineModel.create({
        organizationId: org2,
        name: "Org2 Pipeline",
        isDefault: true,
        order: 0,
        stages: [],
        createdBy: user2,
        updatedBy: user2,
      });

      const repo1 = new PipelineRepository(org1, user1);
      const service1 = new PipelineService(repo1, user1);

      const result = await service1.delete(p2._id);
      expect(result.deleted).toBe(false);
      expect(result.dealCount).toBe(0);
    });

    it("should not allow org1 user to reorder org2 pipeline stages", async () => {
      const p2 = await PipelineModel.create({
        organizationId: org2,
        name: "Org2 Pipeline",
        isDefault: true,
        order: 0,
        stages: [],
        createdBy: user2,
        updatedBy: user2,
      });

      const repo1 = new PipelineRepository(org1, user1);
      const service1 = new PipelineService(repo1, user1);

      await expect(
        service1.reorderStages(p2._id, [
          {
            key: "NEW",
            name: "New",
            order: 0,
            probability: 10,
            color: "blue",
            isWon: false,
            isLost: false,
          },
        ]),
      ).rejects.toThrow("Pipeline not found");
    });
  });

  describe("Service logic (tenant-scoped, no RBAC - RBAC is at API layer)", () => {
    let pipelineId: Types.ObjectId;

    beforeEach(async () => {
      const p = await PipelineModel.create({
        organizationId: org1,
        name: "Test Pipeline",
        isDefault: true,
        order: 0,
        stages: [],
        createdBy: user1,
        updatedBy: user1,
      });
      pipelineId = p._id;
    });

    it("should allow service to list pipelines in same org", async () => {
      const repo = new PipelineRepository(org1, user1);
      const service = new PipelineService(repo, user1);
      const pipelines = await service.list();
      expect(pipelines.length).toBeGreaterThanOrEqual(1);
    });

    it("should allow service to create pipeline in same org", async () => {
      const repo = new PipelineRepository(org1, user1);
      const service = new PipelineService(repo, user1);
      const pipeline = await service.create({ name: "New Pipeline" });
      expect(pipeline.name).toBe("New Pipeline");
      expect(pipeline.organizationId.toString()).toBe(org1.toString());
    });

    it("should allow service to update pipeline metadata in same org", async () => {
      const repo = new PipelineRepository(org1, user1);
      const service = new PipelineService(repo, user1);
      const updated = await service.update(pipelineId, {
        name: "Updated Name",
      });
      expect(updated?.name).toBe("Updated Name");
    });

    it("should allow service to reorder stages in same org", async () => {
      const repo = new PipelineRepository(org1, user1);
      const service = new PipelineService(repo, user1);
      const updated = await service.reorderStages(pipelineId, [
        {
          key: "NEW",
          name: "New",
          order: 0,
          probability: 10,
          color: "slate",
          isWon: false,
          isLost: false,
        },
        {
          key: "WON",
          name: "Won",
          order: 1,
          probability: 100,
          color: "green",
          isWon: true,
          isLost: false,
        },
        {
          key: "LOST",
          name: "Lost",
          order: 2,
          probability: 0,
          color: "red",
          isWon: false,
          isLost: true,
        },
      ]);
      expect(updated.stages).toHaveLength(3);
    });

    it("should allow service to delete unused pipeline in same org", async () => {
      const repo = new PipelineRepository(org1, user1);
      const service = new PipelineService(repo, user1);
      const result = await service.delete(pipelineId);
      expect(result.deleted).toBe(true);
    });

    it("should enforce only one default pipeline per organization", async () => {
      const repo = new PipelineRepository(org1, user1);
      const service = new PipelineService(repo, user1);

      // Create first default
      await service.create({ name: "First", isDefault: true });

      // Create second default - should unset first
      const second = await service.create({ name: "Second", isDefault: true });

      // Verify only second is default
      const all = await service.list();
      const defaults = all.filter((p) => p.isDefault);
      expect(defaults).toHaveLength(1);
      expect(defaults[0].name).toBe("Second");
    });

    it("should allow non-default pipelines alongside default", async () => {
      const repo = new PipelineRepository(org1, user1);
      const service = new PipelineService(repo, user1);

      // Clear existing pipeline from beforeEach
      await PipelineModel.deleteMany({ organizationId: org1 });

      await service.create({ name: "Default", isDefault: true });
      const nonDefault = await service.create({
        name: "Non-Default",
        isDefault: false,
      });

      expect(nonDefault.isDefault).toBe(false);

      const all = await service.list();
      expect(all).toHaveLength(2);
    });
  });

  describe("Deal stage integrity across a reorder", () => {
    let pipelineId: Types.ObjectId;
    let stageIdByKey: Record<string, Types.ObjectId>;

    beforeEach(async () => {
      const stages = [
        {
          _id: new Types.ObjectId(),
          key: "NEW",
          name: "New",
          order: 0,
          probability: 10,
          color: "slate",
          isWon: false,
          isLost: false,
        },
        {
          _id: new Types.ObjectId(),
          key: "QUALIFIED",
          name: "Qualified",
          order: 1,
          probability: 25,
          color: "blue",
          isWon: false,
          isLost: false,
        },
        {
          _id: new Types.ObjectId(),
          key: "PROPOSAL",
          name: "Proposal",
          order: 2,
          probability: 50,
          color: "amber",
          isWon: false,
          isLost: false,
        },
        {
          _id: new Types.ObjectId(),
          key: "WON",
          name: "Won",
          order: 3,
          probability: 100,
          color: "green",
          isWon: true,
          isLost: false,
        },
        {
          _id: new Types.ObjectId(),
          key: "LOST",
          name: "Lost",
          order: 4,
          probability: 0,
          color: "red",
          isWon: false,
          isLost: true,
        },
      ];

      const pipeline = await PipelineModel.create({
        organizationId: org1,
        name: "Deal Pipeline",
        isDefault: false,
        order: 0,
        stages,
        createdBy: user1,
        updatedBy: user1,
      });
      pipelineId = pipeline._id;
      stageIdByKey = Object.fromEntries(
        stages.map((stage) => [stage.key, stage._id]),
      );
    });

    it("should leave a deal's stage resolvable after the pipeline is reordered", async () => {
      const repo = new PipelineRepository(org1, user1);
      const service = new PipelineService(repo, user1);

      const deal = await DealModel.create({
        organizationId: org1,
        name: "Deal in Proposal",
        pipelineId,
        stageId: stageIdByKey.PROPOSAL,
        ownerId: user1,
        value: 10000,
        createdBy: user1,
        updatedBy: user1,
      });

      // Every key survives; only the positions change.
      await service.reorderStages(pipelineId, [
        {
          key: "WON",
          name: "Won",
          order: 0,
          probability: 100,
          color: "green",
          isWon: true,
          isLost: false,
        },
        {
          key: "LOST",
          name: "Lost",
          order: 1,
          probability: 0,
          color: "red",
          isWon: false,
          isLost: true,
        },
        {
          key: "PROPOSAL",
          name: "Proposal",
          order: 2,
          probability: 50,
          color: "amber",
          isWon: false,
          isLost: false,
        },
        {
          key: "QUALIFIED",
          name: "Qualified",
          order: 3,
          probability: 25,
          color: "blue",
          isWon: false,
          isLost: false,
        },
        {
          key: "NEW",
          name: "New",
          order: 4,
          probability: 10,
          color: "slate",
          isWon: false,
          isLost: false,
        },
      ]);

      // The same lookup `DealService.create` and `moveDeal` use to decide
      // whether a stage belongs to a pipeline. It returned null after any
      // reorder before stages kept their identity, which left the deal
      // invisible to every screen that groups by stage and unresolvable
      // through the only API that would have let it be moved somewhere safe.
      const stage = await repo.getStage(pipelineId, deal.stageId);
      expect(stage).not.toBeNull();
      expect(stage?.key).toBe("PROPOSAL");
      expect(stage?.order).toBe(2);
    });

    it("should orphan the deals on a stage whose key is dropped from the payload", async () => {
      // Known consequence, pinned deliberately rather than left to be
      // rediscovered. Dropping a key is a genuine delete — a stage the caller
      // has decided not to have — and nothing reassigns the deals that were on
      // it, so they keep pointing at an id the pipeline no longer contains and
      // disappear from every stage-grouped read. This is a decision, not an
      // oversight: whether to refuse the removal, or to move those deals to a
      // stage the caller names, is a product call that has not been made. Note
      // that `PipelineRepository.hasDeals` answers at pipeline level, so it
      // cannot distinguish "this pipeline has deals" from "this stage has deals"
      // and would not be the right guard here as written.
      const repo = new PipelineRepository(org1, user1);
      const service = new PipelineService(repo, user1);

      const deal = await DealModel.create({
        organizationId: org1,
        name: "Deal in Proposal",
        pipelineId,
        stageId: stageIdByKey.PROPOSAL,
        ownerId: user1,
        value: 10000,
        createdBy: user1,
        updatedBy: user1,
      });

      // PROPOSAL is gone from the payload; everything else stays.
      await service.reorderStages(pipelineId, [
        {
          key: "NEW",
          name: "New",
          order: 0,
          probability: 10,
          color: "slate",
          isWon: false,
          isLost: false,
        },
        {
          key: "QUALIFIED",
          name: "Qualified",
          order: 1,
          probability: 25,
          color: "blue",
          isWon: false,
          isLost: false,
        },
        {
          key: "WON",
          name: "Won",
          order: 2,
          probability: 100,
          color: "green",
          isWon: true,
          isLost: false,
        },
        {
          key: "LOST",
          name: "Lost",
          order: 3,
          probability: 0,
          color: "red",
          isWon: false,
          isLost: true,
        },
      ]);

      // The other stages kept their ids, so only the deals on the removed
      // stage are the ones left dangling.
      expect(await repo.getStage(pipelineId, stageIdByKey.NEW)).not.toBeNull();
      expect(await repo.getStage(pipelineId, stageIdByKey.LOST)).not.toBeNull();
      expect(await repo.getStage(pipelineId, deal.stageId)).toBeNull();

      // The deal document itself is untouched — it is a dangling foreign key,
      // not a cascade.
      const stillThere = await DealModel.findById(deal._id).lean();
      expect(stillThere?.stageId.toString()).toBe(
        stageIdByKey.PROPOSAL.toString(),
      );
    });
  });

  describe("Stage validation", () => {
    it("should reject pipeline with duplicate stage keys at model level", async () => {
      const pipeline = new PipelineModel({
        organizationId: org1,
        name: "Test",
        isDefault: false,
        order: 0,
        stages: [
          {
            _id: new Types.ObjectId(),
            key: "NEW",
            name: "New",
            order: 0,
            probability: 10,
            color: "blue",
            isWon: false,
            isLost: false,
          },
          {
            _id: new Types.ObjectId(),
            key: "NEW",
            name: "New Again",
            order: 1,
            probability: 20,
            color: "blue",
            isWon: false,
            isLost: false,
          },
        ],
        createdBy: user1,
        updatedBy: user1,
      });

      await expect(pipeline.validate()).rejects.toThrow(
        "Stage keys must be unique",
      );
    });

    it("should reject pipeline with duplicate stage orders at model level", async () => {
      const pipeline = new PipelineModel({
        organizationId: org1,
        name: "Test",
        isDefault: false,
        order: 0,
        stages: [
          {
            _id: new Types.ObjectId(),
            key: "NEW",
            name: "New",
            order: 0,
            probability: 10,
            color: "blue",
            isWon: false,
            isLost: false,
          },
          {
            _id: new Types.ObjectId(),
            key: "QUALIFIED",
            name: "Qualified",
            order: 0,
            probability: 25,
            color: "blue",
            isWon: false,
            isLost: false,
          },
        ],
        createdBy: user1,
        updatedBy: user1,
      });

      await expect(pipeline.validate()).rejects.toThrow(
        "Stage orders must be unique",
      );
    });

    it("should reject pipeline with multiple won stages at model level", async () => {
      const pipeline = new PipelineModel({
        organizationId: org1,
        name: "Test",
        isDefault: false,
        order: 0,
        stages: [
          {
            _id: new Types.ObjectId(),
            key: "WON1",
            name: "Won 1",
            order: 0,
            probability: 100,
            color: "green",
            isWon: true,
            isLost: false,
          },
          {
            _id: new Types.ObjectId(),
            key: "WON2",
            name: "Won 2",
            order: 1,
            probability: 100,
            color: "emerald",
            isWon: true,
            isLost: false,
          },
        ],
        createdBy: user1,
        updatedBy: user1,
      });

      await expect(pipeline.validate()).rejects.toThrow(
        "at most one won stage and one lost stage",
      );
    });

    it("should reject pipeline with multiple lost stages at model level", async () => {
      const pipeline = new PipelineModel({
        organizationId: org1,
        name: "Test",
        isDefault: false,
        order: 0,
        stages: [
          {
            _id: new Types.ObjectId(),
            key: "LOST1",
            name: "Lost 1",
            order: 0,
            probability: 0,
            color: "red",
            isWon: false,
            isLost: true,
          },
          {
            _id: new Types.ObjectId(),
            key: "LOST2",
            name: "Lost 2",
            order: 1,
            probability: 0,
            color: "rose",
            isWon: false,
            isLost: true,
          },
        ],
        createdBy: user1,
        updatedBy: user1,
      });

      await expect(pipeline.validate()).rejects.toThrow(
        "at most one won stage and one lost stage",
      );
    });
  });
});
