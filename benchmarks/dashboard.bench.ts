import { MongoMemoryServer } from "mongodb-memory-server";
import type { Types } from "mongoose";
import { afterAll, beforeAll, describe, test } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { ActivityModel } from "@/modules/activities";
import { DealModel, TaskModel } from "@/modules/crm";
import { PipelineModel } from "@/modules/pipelines";

let mongoServer: MongoMemoryServer;
let orgId: Types.ObjectId;
let userId: Types.ObjectId;
let pipelineId: Types.ObjectId;
let stageIds: Types.ObjectId[];

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  await connectToDatabase();

  const mongoose = await import("mongoose");
  orgId = new mongoose.Types.ObjectId();
  userId = new mongoose.Types.ObjectId();

  // Create default pipeline with stages (matching dashboard route)
  const stages = [
    {
      _id: new mongoose.Types.ObjectId(),
      key: "LEAD",
      name: "Lead",
      order: 0,
      probability: 10,
      color: "blue",
      isDefault: true,
    },
    {
      _id: new mongoose.Types.ObjectId(),
      key: "QUALIFIED",
      name: "Qualified",
      order: 1,
      probability: 25,
      color: "cyan",
    },
    {
      _id: new mongoose.Types.ObjectId(),
      key: "PROPOSAL",
      name: "Proposal",
      order: 2,
      probability: 50,
      color: "amber",
    },
    {
      _id: new mongoose.Types.ObjectId(),
      key: "NEGOTIATION",
      name: "Negotiation",
      order: 3,
      probability: 75,
      color: "orange",
    },
    {
      _id: new mongoose.Types.ObjectId(),
      key: "WON",
      name: "Won",
      order: 4,
      probability: 100,
      color: "green",
      isWon: true,
    },
    {
      _id: new mongoose.Types.ObjectId(),
      key: "LOST",
      name: "Lost",
      order: 5,
      probability: 0,
      color: "red",
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

  // Seed test data (smaller volume for faster benchmarks)
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Create ~200 deals
  const deals = [];
  for (let i = 0; i < 200; i++) {
    const status = i < 40 ? "WON" : i < 60 ? "LOST" : "OPEN";
    const stageIdx =
      status === "WON"
        ? 4
        : status === "LOST"
          ? 5
          : Math.floor(Math.random() * 4);
    deals.push({
      organizationId: orgId,
      name: `Deal ${i}`,
      value: Math.floor(Math.random() * 50000) + 1000,
      status,
      stageId: stageIds[stageIdx],
      pipelineId,
      ownerId: userId,
      currency: "USD",
      probability:
        status === "WON"
          ? 100
          : status === "LOST"
            ? 0
            : Math.floor(Math.random() * 100),
      closedAt:
        status !== "OPEN"
          ? new Date(startOfMonth.getTime() + Math.random() * 2592000000)
          : null,
      expectedCloseDate: null,
      lostReason: null,
      description: null,
      sortOrder: i,
      tags: [],
      customFields: {},
      createdBy: userId,
      updatedBy: userId,
    });
  }
  await DealModel.insertMany(deals);

  // Create ~100 tasks
  const tasks = [];
  for (let i = 0; i < 100; i++) {
    const isOverdue = i < 20;
    tasks.push({
      organizationId: orgId,
      title: `Task ${i}`,
      status: isOverdue ? (i % 2 === 0 ? "TODO" : "IN_PROGRESS") : "DONE",
      dueAt: isOverdue
        ? new Date(now.getTime() - Math.random() * 86400000 * 30)
        : new Date(now.getTime() + Math.random() * 86400000 * 30),
      priority: ["LOW", "MEDIUM", "HIGH", "URGENT"][
        Math.floor(Math.random() * 4)
      ],
      assigneeId: userId,
      createdBy: userId,
      updatedBy: userId,
      description: null,
      completedAt: null,
      related: [],
      reminders: [],
      estimatedMinutes: null,
    });
  }
  await TaskModel.insertMany(tasks);

  // Create ~50 activities
  const activities = [];
  for (let i = 0; i < 50; i++) {
    activities.push({
      organizationId: orgId,
      title: `Activity ${i}`,
      type: ["NOTE", "CALL", "MEETING", "EMAIL", "TASK"][
        Math.floor(Math.random() * 5)
      ],
      occurredAt: new Date(
        now.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000,
      ),
      metadata: {},
      body: null,
      direction: null,
      durationSeconds: null,
      actorId: userId,
      ownerId: userId,
      subjects: [],
      createdBy: userId,
    });
  }
  await ActivityModel.insertMany(activities);
});

afterAll(async () => {
  await mongoServer.stop();
});

describe("Dashboard Aggregation Benchmark", () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  /**
   * Consume an aggregation result inside the measured function.
   *
   * Tinybench hands the same result to the engine repeatedly, and V8 will
   * eliminate a query whose output is never observed. Every benchmark below
   * therefore pushes the result through a plain sum of its lengths, which is
   * cheap next to a round trip but still makes the work observable.
   */
  function consume(value: unknown): number {
    if (Array.isArray(value)) {
      return value.length + (value[0] ? JSON.stringify(value[0]).length : 0);
    }
    return value === undefined ? 0 : 1;
  }

  test("dashboard $facet aggregation - full pipeline", async ({ bench }) => {
    // This is the exact aggregation from the dashboard route
    await bench("full $facet pipeline", async () => {
      const [result] = await DealModel.aggregate([
        { $match: { organizationId: orgId } },
        {
          $facet: {
            pipelineSummary: [
              { $match: { status: "OPEN", stageId: { $in: stageIds } } },
              {
                $group: {
                  _id: "$stageId",
                  count: { $sum: 1 },
                  totalValue: { $sum: "$value" },
                },
              },
              {
                $project: { stageId: "$_id", count: 1, totalValue: 1, _id: 0 },
              },
            ],
            wonThisMonth: [
              {
                $match: {
                  status: "WON",
                  closedAt: { $gte: startOfMonth },
                  stageId: stageIds[4],
                },
              },
              { $count: "total" },
            ],
            lostThisMonth: [
              {
                $match: {
                  status: "LOST",
                  closedAt: { $gte: startOfMonth },
                  stageId: stageIds[5],
                },
              },
              { $count: "total" },
            ],
            pipelineValue: [
              { $match: { status: "OPEN" } },
              { $group: { _id: null, totalValue: { $sum: "$value" } } },
            ],
            leadConversion: [
              // Using DealModel as proxy since leads are in same collection pattern
              { $match: { createdAt: { $gte: startOfMonth } } },
              {
                $group: {
                  _id: null,
                  total: { $sum: 1 },
                  converted: {
                    $sum: { $cond: [{ $eq: ["$status", "CONVERTED"] }, 1, 0] },
                  },
                },
              },
            ],
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
            overdueTasks: [
              { $match: { organizationId: orgId } },
              {
                $match: {
                  status: { $in: ["TODO", "IN_PROGRESS"] },
                  dueAt: { $lt: now },
                },
              },
              { $count: "total" },
            ],
            recentActivity: [
              {
                $match: {
                  organizationId: orgId,
                  occurredAt: {
                    $gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
                  },
                },
              },
              { $sort: { occurredAt: -1 } },
              { $limit: 10 },
              { $project: { title: 1, occurredAt: 1, type: 1, metadata: 1 } },
            ],
          },
        },
      ]);

      // Verify structure to ensure benchmark is valid
      if (!result.pipelineSummary || !result.wonThisMonth) {
        throw new Error("Invalid aggregation result");
      }
      return consume(result);
    }).run();
  });

  test("dashboard pipeline summary only", async ({ bench }) => {
    await bench("pipeline summary", async () => {
      const [result] = await DealModel.aggregate([
        {
          $match: {
            organizationId: orgId,
            status: "OPEN",
            stageId: { $in: stageIds },
          },
        },
        {
          $group: {
            _id: "$stageId",
            count: { $sum: 1 },
            totalValue: { $sum: "$value" },
          },
        },
        { $project: { stageId: "$_id", count: 1, totalValue: 1, _id: 0 } },
      ]);
      return consume(result);
    }).run();
  });

  test("dashboard metric cards only", async ({ bench }) => {
    await bench("metric cards $facet", async () => {
      const [result] = await DealModel.aggregate([
        { $match: { organizationId: orgId } },
        {
          $facet: {
            wonThisMonth: [
              {
                $match: {
                  status: "WON",
                  closedAt: { $gte: startOfMonth },
                  stageId: stageIds[4],
                },
              },
              { $count: "total" },
            ],
            lostThisMonth: [
              {
                $match: {
                  status: "LOST",
                  closedAt: { $gte: startOfMonth },
                  stageId: stageIds[5],
                },
              },
              { $count: "total" },
            ],
            pipelineValue: [
              { $match: { status: "OPEN" } },
              { $group: { _id: null, totalValue: { $sum: "$value" } } },
            ],
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
      return consume(result);
    }).run();
  });

  test("dashboard overdue tasks count", async ({ bench }) => {
    await bench("overdue tasks count", async () => {
      const [result] = await TaskModel.aggregate([
        { $match: { organizationId: orgId } },
        {
          $match: {
            status: { $in: ["TODO", "IN_PROGRESS"] },
            dueAt: { $lt: now },
          },
        },
        { $count: "total" },
      ]);
      return consume(result);
    }).run();
  });

  test("dashboard recent activity (10 items)", async ({ bench }) => {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    await bench("recent activity limit 10", async () => {
      const result = await ActivityModel.find({
        organizationId: orgId,
        occurredAt: { $gte: thirtyDaysAgo },
      })
        .sort({ occurredAt: -1 })
        .limit(10)
        .select("title occurredAt type metadata")
        .lean();
      return consume(result);
    }).run();
  });
});
