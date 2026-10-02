import mongoose, { type Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { ActivityModel } from "@/modules/activities";
import { DealModel, LeadModel, TaskModel } from "@/modules/crm";
import { buildDashboardAggregationPipeline } from "@/modules/dashboard/dashboard-aggregation";
import { PipelineModel } from "@/modules/pipelines";

let orgId: Types.ObjectId;
let userId: Types.ObjectId;
let pipelineId: Types.ObjectId;
let stageIds: Types.ObjectId[];

beforeEach(async () => {
  await connectToDatabase();

  const mongoose = await import("mongoose");
  orgId = new mongoose.Types.ObjectId();
  userId = new mongoose.Types.ObjectId();

  // Create default pipeline with stages.
  //
  // `key` and `order` are both required by the stage schema, and the schema
  // rejects a pipeline whose stages share a key or an order. `order` also
  // drives the position assertions below, so it is not incidental.
  const stages = [
    { _id: new mongoose.Types.ObjectId(), key: "LEAD", name: "Lead", order: 0 },
    {
      _id: new mongoose.Types.ObjectId(),
      key: "QUALIFIED",
      name: "Qualified",
      order: 1,
    },
    {
      _id: new mongoose.Types.ObjectId(),
      key: "PROPOSAL",
      name: "Proposal",
      order: 2,
    },
    {
      _id: new mongoose.Types.ObjectId(),
      key: "NEGOTIATION",
      name: "Negotiation",
      order: 3,
    },
    {
      _id: new mongoose.Types.ObjectId(),
      key: "WON",
      name: "Won",
      order: 4,
      isWon: true,
    },
    {
      _id: new mongoose.Types.ObjectId(),
      key: "LOST",
      name: "Lost",
      order: 5,
      isLost: true,
    },
  ];
  stageIds = stages.map((s) => s._id);

  const pipeline = await PipelineModel.create({
    organizationId: orgId,
    name: "Default Pipeline",
    isDefault: true,
    stages,
    createdBy: userId,
    updatedBy: userId,
  });
  pipelineId = pipeline._id;
});

afterEach(async () => {
  await mongoose.connection.dropDatabase();
  vi.clearAllMocks();
});

describe("Dashboard Round-trip", () => {
  it("should aggregate dashboard metrics in single $facet query", async () => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    // Create test data
    await DealModel.create([
      // Won this month
      {
        organizationId: orgId,
        name: "Deal 1",
        value: 10000,
        status: "WON",
        stageId: stageIds[4],
        pipelineId,
        ownerId: userId,
        closedAt: new Date(startOfMonth.getTime() + 86400000),
        createdBy: userId,
        updatedBy: userId,
      },
      {
        organizationId: orgId,
        name: "Deal 2",
        value: 20000,
        status: "WON",
        stageId: stageIds[4],
        pipelineId,
        ownerId: userId,
        closedAt: new Date(startOfMonth.getTime() + 172800000),
        createdBy: userId,
        updatedBy: userId,
      },
      // Lost this month
      {
        organizationId: orgId,
        name: "Deal 3",
        value: 5000,
        status: "LOST",
        stageId: stageIds[5],
        pipelineId,
        ownerId: userId,
        closedAt: new Date(startOfMonth.getTime() + 259200000),
        createdBy: userId,
        updatedBy: userId,
      },
      // Open deals in pipeline
      {
        organizationId: orgId,
        name: "Deal 4",
        value: 15000,
        status: "OPEN",
        stageId: stageIds[1],
        pipelineId,
        ownerId: userId,
        createdBy: userId,
        updatedBy: userId,
      },
      {
        organizationId: orgId,
        name: "Deal 5",
        value: 25000,
        status: "OPEN",
        stageId: stageIds[2],
        pipelineId,
        ownerId: userId,
        createdBy: userId,
        updatedBy: userId,
      },
      {
        organizationId: orgId,
        name: "Deal 6",
        value: 30000,
        status: "OPEN",
        stageId: stageIds[1],
        pipelineId,
        ownerId: userId,
        createdBy: userId,
        updatedBy: userId,
      },
    ]);

    await TaskModel.create([
      {
        organizationId: orgId,
        title: "Overdue Task 1",
        status: "TODO",
        dueAt: new Date(now.getTime() - 86400000),
        priority: "HIGH",
        assigneeId: userId,
        createdBy: userId,
        updatedBy: userId,
      },
      {
        organizationId: orgId,
        title: "Overdue Task 2",
        status: "IN_PROGRESS",
        dueAt: new Date(now.getTime() - 172800000),
        priority: "URGENT",
        assigneeId: userId,
        createdBy: userId,
        updatedBy: userId,
      },
      {
        organizationId: orgId,
        title: "Future Task",
        status: "TODO",
        dueAt: new Date(now.getTime() + 86400000),
        priority: "MEDIUM",
        assigneeId: userId,
        createdBy: userId,
        updatedBy: userId,
      },
    ]);

    await ActivityModel.create([
      {
        organizationId: orgId,
        title: "Activity 1",
        type: "NOTE",
        occurredAt: new Date(now.getTime() - 3600000),
        metadata: {},
        ownerId: userId,
      },
      {
        organizationId: orgId,
        title: "Activity 2",
        type: "CALL",
        occurredAt: new Date(now.getTime() - 7200000),
        metadata: {},
        ownerId: userId,
      },
      {
        organizationId: orgId,
        title: "Activity 3",
        type: "MEETING",
        occurredAt: new Date(now.getTime() - 10800000),
        metadata: {},
        ownerId: userId,
      },
    ]);

    // Exercise the same aggregation builder used by the dashboard endpoint.
    const [result] = await DealModel.aggregate(
      buildDashboardAggregationPipeline({
        organizationId: orgId,
        now,
        startOfMonth,
        thirtyDaysAgo: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        stageIds,
        wonStageId: stageIds[4],
        lostStageId: stageIds[5],
        leadCollection: LeadModel.collection.name,
        taskCollection: TaskModel.collection.name,
        activityCollection: ActivityModel.collection.name,
      }),
    );

    // Verify results
    expect(result.pipelineSummary).toHaveLength(2); // Two stages with open deals
    expect(result.wonThisMonth[0]?.total).toBe(2);
    expect(result.lostThisMonth[0]?.total).toBe(1);
    expect(result.pipelineValue[0]?.totalValue).toBe(70000); // 15000 + 25000 + 30000
    expect(result.overdueTasks[0]?.total).toBe(2);
    expect(result.recentActivity).toHaveLength(3);
  });

  it("should return zero metrics when no data exists", async () => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [result] = await DealModel.aggregate(
      buildDashboardAggregationPipeline({
        organizationId: orgId,
        now,
        startOfMonth,
        thirtyDaysAgo: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        stageIds,
        wonStageId: stageIds[4],
        lostStageId: stageIds[5],
        leadCollection: LeadModel.collection.name,
        taskCollection: TaskModel.collection.name,
        activityCollection: ActivityModel.collection.name,
      }),
    );

    expect(result.pipelineSummary).toHaveLength(0);
    expect(result.wonThisMonth[0]?.total).toBeUndefined();
    expect(result.lostThisMonth[0]?.total).toBeUndefined();
    expect(result.pipelineValue[0]?.totalValue).toBeUndefined();
    expect(result.overdueTasks[0]?.total).toBeUndefined();
    expect(result.recentActivity).toHaveLength(0);
  });

  it("should correctly calculate lead conversion rate", async () => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    await LeadModel.create([
      {
        organizationId: orgId,
        title: "Converted lead",
        contactSnapshot: {
          firstName: "Alex",
          lastName: "Example",
          email: "alex@example.com",
        },
        source: "Website",
        status: "CONVERTED",
        ownerId: userId,
      },
      {
        organizationId: orgId,
        title: "New lead",
        contactSnapshot: {
          firstName: "Sam",
          lastName: "Example",
          email: "sam@example.com",
        },
        source: "Referral",
        status: "NEW",
        ownerId: userId,
      },
    ]);

    const [result] = await DealModel.aggregate(
      buildDashboardAggregationPipeline({
        organizationId: orgId,
        now,
        startOfMonth,
        thirtyDaysAgo: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        stageIds,
        leadCollection: LeadModel.collection.name,
        taskCollection: TaskModel.collection.name,
        activityCollection: ActivityModel.collection.name,
      }),
    );

    expect(result.leadConversion[0]?.total).toBe(2);
    expect(result.leadConversion[0]?.converted).toBe(1);
  });

  it("should correctly calculate win rate", async () => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    await DealModel.create([
      {
        organizationId: orgId,
        name: "Won 1",
        value: 10000,
        status: "WON",
        stageId: stageIds[4],
        pipelineId,
        ownerId: userId,
        closedAt: new Date(startOfMonth.getTime() + 86400000),
        createdBy: userId,
        updatedBy: userId,
      },
      {
        organizationId: orgId,
        name: "Won 2",
        value: 10000,
        status: "WON",
        stageId: stageIds[4],
        pipelineId,
        ownerId: userId,
        closedAt: new Date(startOfMonth.getTime() + 172800000),
        createdBy: userId,
        updatedBy: userId,
      },
      {
        organizationId: orgId,
        name: "Lost 1",
        value: 5000,
        status: "LOST",
        stageId: stageIds[5],
        pipelineId,
        ownerId: userId,
        closedAt: new Date(startOfMonth.getTime() + 259200000),
        createdBy: userId,
        updatedBy: userId,
      },
    ]);

    const [result] = await DealModel.aggregate([
      { $match: { organizationId: orgId } },
      {
        $facet: {
          winRate: [
            {
              $match: {
                status: { $in: ["WON", "LOST"] },
                closedAt: { $gte: startOfMonth },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: 1 },
                won: { $sum: { $cond: [{ $eq: ["$status", "WON"] }, 1, 0] } },
              },
            },
          ],
        },
      },
    ]);

    expect(result.winRate[0]?.total).toBe(3);
    expect(result.winRate[0]?.won).toBe(2);
    // Win rate = 2/3 = 66.7%
  });
});
