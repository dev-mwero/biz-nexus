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

/**
 * Run the aggregation the dashboard endpoint actually runs.
 *
 * Every assertion in this file goes through here rather than through a
 * hand-written `$facet`. A hand-written facet keeps passing while the shipped
 * pipeline regresses, because it is a second implementation of the same
 * question that nothing compares to the first — which is how a pipeline could
 * contradict itself for months while the suite reported green.
 */
async function aggregateDashboard(now: Date, startOfMonth: Date) {
  const [result] = await DealModel.aggregate(
    buildDashboardAggregationPipeline({
      organizationId: orgId,
      pipelineId,
      now,
      startOfMonth,
      thirtyDaysAgo: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
      stageIds,
      leadCollection: LeadModel.collection.name,
      taskCollection: TaskModel.collection.name,
      activityCollection: ActivityModel.collection.name,
    }),
  );

  return result;
}

/** A deal in a second pipeline of the same organisation. */
async function createSecondaryPipeline() {
  const pipeline = await PipelineModel.create({
    organizationId: orgId,
    name: "Renewals Pipeline",
    isDefault: false,
    stages: [
      {
        _id: new mongoose.Types.ObjectId(),
        key: "INTRO",
        name: "Intro",
        order: 0,
      },
      {
        _id: new mongoose.Types.ObjectId(),
        key: "RENEWED",
        name: "Renewed",
        order: 1,
        isWon: true,
      },
    ],
    createdBy: userId,
    updatedBy: userId,
  });

  return pipeline;
}

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
    const result = await aggregateDashboard(now, startOfMonth);

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

    const result = await aggregateDashboard(now, startOfMonth);

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

    const result = await aggregateDashboard(now, startOfMonth);

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

    // Through the shipped builder, where this fixture belongs: the version of this
    // test that ran a hand-written `$facet` asserted the same two numbers
    // without touching the code the endpoint calls, so it stayed green through a
    // regression in every facet around it.
    const result = await aggregateDashboard(now, startOfMonth);

    expect(result.winRate[0]?.total).toBe(3);
    expect(result.winRate[0]?.won).toBe(2);
    // Win rate = 2/3 = 66.7%
  });
});

describe("Dashboard metric consistency", () => {
  // The fixtures below are the ones the shipped suite was missing. Every deal
  // in "Dashboard Round-trip" sits in the default pipeline, in the stage its
  // `status` implies — which is exactly the shape where the pipeline cannot
  // contradict itself, so a suite built from it can stay green while the screen
  // does. These put the deals where a real tenant puts them: statuses and stage
  // ids that disagree, a second pipeline, and a stage id left behind by a
  // reorder.

  it("counts won and lost from status alone, so the two cards add up to the win rate denominator", async () => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const midMonth = new Date(startOfMonth.getTime() + 86400000);

    // A deal marked WON but left in a mid-pipeline stage, and one marked LOST
    // sitting in Proposal. `status` is written independently of the stage: an
    // import sets one, a bulk edit sets the other, and a stage reorder rewrites
    // the stage ids of every deal in the pipeline while leaving `status` alone.
    await DealModel.create([
      {
        organizationId: orgId,
        name: "Won but still qualified",
        value: 10000,
        status: "WON",
        stageId: stageIds[1],
        pipelineId,
        ownerId: userId,
        closedAt: midMonth,
        createdBy: userId,
        updatedBy: userId,
      },
      {
        organizationId: orgId,
        name: "Lost while in proposal",
        value: 5000,
        status: "LOST",
        stageId: stageIds[2],
        pipelineId,
        ownerId: userId,
        closedAt: midMonth,
        createdBy: userId,
        updatedBy: userId,
      },
      {
        organizationId: orgId,
        name: "Won in the won stage",
        value: 20000,
        status: "WON",
        stageId: stageIds[4],
        pipelineId,
        ownerId: userId,
        closedAt: midMonth,
        createdBy: userId,
        updatedBy: userId,
      },
      {
        organizationId: orgId,
        name: "Lost in the lost stage",
        value: 5000,
        status: "LOST",
        stageId: stageIds[5],
        pipelineId,
        ownerId: userId,
        closedAt: midMonth,
        createdBy: userId,
        updatedBy: userId,
      },
      // Closed last month, so the month boundary is still doing work: without
      // this, `wonThisMonth` and `winRate` could both be counting everything
      // ever closed and the invariant would still hold.
      {
        organizationId: orgId,
        name: "Won last month",
        value: 90000,
        status: "WON",
        stageId: stageIds[4],
        pipelineId,
        ownerId: userId,
        closedAt: new Date(startOfMonth.getTime() - 86400000),
        createdBy: userId,
        updatedBy: userId,
      },
    ]);

    const result = await aggregateDashboard(now, startOfMonth);

    const won = result.wonThisMonth[0]?.total;
    const lost = result.lostThisMonth[0]?.total;
    const denominator = result.winRate[0]?.total;

    // Absolute values first, so the invariant below cannot pass vacuously on
    // two zeroes. These two counts used to read 1 and 1 here, because the won
    // and lost facets were pinned to the won and lost stages, while the
    // denominator behind the then-unrendered percentage was 4.
    expect(won).toBe(2);
    expect(lost).toBe(2);
    expect(denominator).toBe(4);
    expect(result.winRate[0]?.won).toBe(2);
    expect(won + lost).toBe(denominator);
  });

  it("scopes the value card and the stage table to the same deals, so the card total equals the table footer", async () => {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const renewals = await createSecondaryPipeline();
    const renewalsStageId = renewals.stages[0]._id;

    await DealModel.create([
      {
        organizationId: orgId,
        name: "Qualified",
        value: 10000,
        status: "OPEN",
        stageId: stageIds[1],
        pipelineId,
        ownerId: userId,
        createdBy: userId,
        updatedBy: userId,
      },
      {
        organizationId: orgId,
        name: "Qualified again",
        value: 20000,
        status: "OPEN",
        stageId: stageIds[1],
        pipelineId,
        ownerId: userId,
        createdBy: userId,
        updatedBy: userId,
      },
      // Open, in the default pipeline, pointing at a stage id the default
      // pipeline no longer has. A reorder regenerates every stage `_id`
      // deliberately, so this is the normal state of every deal in a pipeline
      // after one — and it used to reach the "Pipeline Value" card, where it
      // raised a total the table below it could not account for.
      {
        organizationId: orgId,
        name: "Open in a stage that no longer exists",
        value: 5000,
        status: "OPEN",
        stageId: new mongoose.Types.ObjectId(),
        pipelineId,
        ownerId: userId,
        createdBy: userId,
        updatedBy: userId,
      },
      // Open in a second pipeline. The default pipeline's stages cannot name
      // this deal's stage, so any total that included it was a number no table
      // on the screen could produce.
      {
        organizationId: orgId,
        name: "Open in the renewals pipeline",
        value: 40000,
        status: "OPEN",
        stageId: renewalsStageId,
        pipelineId: renewals._id,
        ownerId: userId,
        createdBy: userId,
        updatedBy: userId,
      },
    ]);

    const result = await aggregateDashboard(now, startOfMonth);

    const tableTotal = result.pipelineSummary.reduce(
      (sum: number, stage: { totalValue: number }) => sum + stage.totalValue,
      0,
    );

    // One stage, the two deals that belong to it. The dangling stage id and the
    // other pipeline's deal are absent from the table.
    expect(result.pipelineSummary).toHaveLength(1);
    expect(result.pipelineSummary[0]?.totalValue).toBe(30000);
    expect(result.pipelineValue[0]?.totalValue).toBe(30000);
    // This is the claim on the card: "Pipeline Value" above, "Total" below.
    expect(result.pipelineValue[0]?.totalValue).toBe(tableTotal);
  });
});
