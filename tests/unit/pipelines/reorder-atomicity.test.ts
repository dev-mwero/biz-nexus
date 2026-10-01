import { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase, disconnectDatabase } from "@/db/connection";
import { PipelineModel } from "@/modules/pipelines/pipeline.model";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { PipelineService } from "@/modules/pipelines/pipeline.service";

describe("Pipeline reorderStages atomicity", () => {
  let organizationId: Types.ObjectId;
  let actorId: Types.ObjectId;
  let pipelineId: Types.ObjectId;

  beforeEach(async () => {
    await connectToDatabase();
    organizationId = new Types.ObjectId();
    actorId = new Types.ObjectId();

    // Create a test pipeline with initial stages
    const pipeline = await PipelineModel.create({
      organizationId,
      name: "Test Pipeline",
      description: "Test",
      isDefault: false,
      order: 0,
      stages: [
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
          key: "WON",
          name: "Won",
          order: 2,
          probability: 100,
          color: "green",
          isWon: true,
          isLost: false,
        },
        {
          _id: new Types.ObjectId(),
          key: "LOST",
          name: "Lost",
          order: 3,
          probability: 0,
          color: "red",
          isWon: false,
          isLost: true,
        },
      ],
      createdBy: actorId,
      updatedBy: actorId,
    });
    pipelineId = pipeline._id;
  });

  afterEach(async () => {
    await PipelineModel.deleteMany({ organizationId });
    await disconnectDatabase();
  });

  it("should atomically replace all stages in a single update", async () => {
    const repo = new PipelineRepository(organizationId, actorId);
    const service = new PipelineService(repo, actorId);

    const newStages = [
      {
        key: "LEAD",
        name: "Lead",
        order: 0,
        probability: 5,
        color: "slate",
        isWon: false,
        isLost: false,
      },
      {
        key: "CONTACTED",
        name: "Contacted",
        order: 1,
        probability: 15,
        color: "blue",
        isWon: false,
        isLost: false,
      },
      {
        key: "MEETING",
        name: "Meeting",
        order: 2,
        probability: 40,
        color: "amber",
        isWon: false,
        isLost: false,
      },
      {
        key: "PROPOSAL",
        name: "Proposal",
        order: 3,
        probability: 60,
        color: "orange",
        isWon: false,
        isLost: false,
      },
      {
        key: "NEGOTIATION",
        name: "Negotiation",
        order: 4,
        probability: 80,
        color: "violet",
        isWon: false,
        isLost: false,
      },
      {
        key: "WON",
        name: "Won",
        order: 5,
        probability: 100,
        color: "green",
        isWon: true,
        isLost: false,
      },
      {
        key: "LOST",
        name: "Lost",
        order: 6,
        probability: 0,
        color: "red",
        isWon: false,
        isLost: true,
      },
    ];

    const updated = await service.reorderStages(pipelineId, newStages);

    expect(updated.stages).toHaveLength(7);
    expect(updated.stages.map((s) => s.key)).toEqual([
      "LEAD",
      "CONTACTED",
      "MEETING",
      "PROPOSAL",
      "NEGOTIATION",
      "WON",
      "LOST",
    ]);
    expect(updated.stages.map((s) => s.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("should reject reorder with duplicate stage keys", async () => {
    const repo = new PipelineRepository(organizationId, actorId);
    const service = new PipelineService(repo, actorId);

    const newStages = [
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
        key: "NEW",
        name: "New Again",
        order: 1,
        probability: 20,
        color: "blue",
        isWon: false,
        isLost: false,
      },
    ];

    await expect(service.reorderStages(pipelineId, newStages)).rejects.toThrow(
      "Stage keys must be unique within a pipeline",
    );
  });

  it("should reject reorder with duplicate stage orders", async () => {
    const repo = new PipelineRepository(organizationId, actorId);
    const service = new PipelineService(repo, actorId);

    const newStages = [
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
        order: 0,
        probability: 25,
        color: "blue",
        isWon: false,
        isLost: false,
      },
    ];

    await expect(service.reorderStages(pipelineId, newStages)).rejects.toThrow(
      "Stage orders must be unique within a pipeline",
    );
  });

  it("should reject reorder with more than one won stage", async () => {
    const repo = new PipelineRepository(organizationId, actorId);
    const service = new PipelineService(repo, actorId);

    const newStages = [
      {
        key: "WON1",
        name: "Won 1",
        order: 0,
        probability: 100,
        color: "green",
        isWon: true,
        isLost: false,
      },
      {
        key: "WON2",
        name: "Won 2",
        order: 1,
        probability: 100,
        color: "emerald",
        isWon: true,
        isLost: false,
      },
    ];

    await expect(service.reorderStages(pipelineId, newStages)).rejects.toThrow(
      "A pipeline may have at most one won stage and one lost stage",
    );
  });

  it("should reject reorder with more than one lost stage", async () => {
    const repo = new PipelineRepository(organizationId, actorId);
    const service = new PipelineService(repo, actorId);

    const newStages = [
      {
        key: "LOST1",
        name: "Lost 1",
        order: 0,
        probability: 0,
        color: "red",
        isWon: false,
        isLost: true,
      },
      {
        key: "LOST2",
        name: "Lost 2",
        order: 1,
        probability: 0,
        color: "rose",
        isWon: false,
        isLost: true,
      },
    ];

    await expect(service.reorderStages(pipelineId, newStages)).rejects.toThrow(
      "A pipeline may have at most one won stage and one lost stage",
    );
  });

  it("should generate new _ids for all stages on reorder", async () => {
    const repo = new PipelineRepository(organizationId, actorId);
    const service = new PipelineService(repo, actorId);

    // Get original stage IDs
    const original = await repo.findByIdWithStages(pipelineId);
    const originalIds = original!.stages.map((s) => s._id.toString());

    const newStages = [
      {
        key: "LEAD",
        name: "Lead",
        order: 0,
        probability: 5,
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
    ];

    const updated = await service.reorderStages(pipelineId, newStages);
    const newIds = updated.stages.map((s) => s._id.toString());

    // All stage IDs should be new (no overlap with original)
    expect(newIds.every((id) => !originalIds.includes(id))).toBe(true);
  });

  it("should persist the reordered stages to the database", async () => {
    const repo = new PipelineRepository(organizationId, actorId);
    const service = new PipelineService(repo, actorId);

    const newStages = [
      {
        key: "LEAD",
        name: "Lead",
        order: 0,
        probability: 5,
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
    ];

    await service.reorderStages(pipelineId, newStages);

    // Fetch fresh from database
    const fresh = await PipelineModel.findById(pipelineId).lean();
    expect(fresh!.stages).toHaveLength(3);
    expect(fresh!.stages.map((s) => s.key)).toEqual(["LEAD", "WON", "LOST"]);
    expect(fresh!.stages.map((s) => s.order)).toEqual([0, 1, 2]);
  });

  it("should handle concurrent reorder attempts correctly", async () => {
    const repo1 = new PipelineRepository(organizationId, actorId);
    const service1 = new PipelineService(repo1, actorId);

    const repo2 = new PipelineRepository(organizationId, actorId);
    const service2 = new PipelineService(repo2, actorId);

    const stagesA = [
      {
        key: "A1",
        name: "A1",
        order: 0,
        probability: 10,
        color: "blue",
        isWon: false,
        isLost: false,
      },
      {
        key: "A2",
        name: "A2",
        order: 1,
        probability: 50,
        color: "amber",
        isWon: false,
        isLost: false,
      },
      {
        key: "AWON",
        name: "Won",
        order: 2,
        probability: 100,
        color: "green",
        isWon: true,
        isLost: false,
      },
      {
        key: "ALOST",
        name: "Lost",
        order: 3,
        probability: 0,
        color: "red",
        isWon: false,
        isLost: true,
      },
    ];

    const stagesB = [
      {
        key: "B1",
        name: "B1",
        order: 0,
        probability: 20,
        color: "blue",
        isWon: false,
        isLost: false,
      },
      {
        key: "BWON",
        name: "Won",
        order: 1,
        probability: 100,
        color: "green",
        isWon: true,
        isLost: false,
      },
      {
        key: "BLOST",
        name: "Lost",
        order: 2,
        probability: 0,
        color: "red",
        isWon: false,
        isLost: true,
      },
    ];

    // Both should succeed (last write wins)
    const [result1, result2] = await Promise.all([
      service1.reorderStages(pipelineId, stagesA),
      service2.reorderStages(pipelineId, stagesB),
    ]);

    // Both operations completed
    expect(result1).toBeDefined();
    expect(result2).toBeDefined();

    // Final state should be one of the two (last write wins)
    const fresh = await PipelineModel.findById(pipelineId).lean();
    const finalKeys = fresh!.stages.map((s) => s.key).sort();
    const possibleA = stagesA.map((s) => s.key).sort();
    const possibleB = stagesB.map((s) => s.key).sort();
    expect([possibleA, possibleB]).toContainEqual(finalKeys);
  });
});
