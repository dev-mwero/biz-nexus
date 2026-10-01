import type { PipelineStage, Types } from "mongoose";

interface DashboardAggregationInput {
  organizationId: Types.ObjectId;
  now: Date;
  startOfMonth: Date;
  thirtyDaysAgo: Date;
  stageIds: Types.ObjectId[];
  wonStageId?: Types.ObjectId;
  lostStageId?: Types.ObjectId;
  leadCollection: string;
  taskCollection: string;
  activityCollection: string;
}

/**
 * Build the single-round-trip dashboard aggregation.
 *
 * `$facet` only sees its input collection, so union the other tenant-owned
 * sources before applying the independent metric facets. Filtering each union
 * branch by organization keeps the tenant boundary explicit in the pipeline.
 */
export function buildDashboardAggregationPipeline({
  organizationId,
  now,
  startOfMonth,
  thirtyDaysAgo,
  stageIds,
  wonStageId,
  lostStageId,
  leadCollection,
  taskCollection,
  activityCollection,
}: DashboardAggregationInput) {
  return [
    { $match: { organizationId, deletedAt: null } },
    { $addFields: { _source: "deal" } },
    {
      $unionWith: {
        coll: leadCollection,
        pipeline: [
          { $match: { organizationId, deletedAt: null } },
          { $addFields: { _source: "lead" } },
        ],
      },
    },
    {
      $unionWith: {
        coll: taskCollection,
        pipeline: [
          { $match: { organizationId, deletedAt: null } },
          { $addFields: { _source: "task" } },
        ],
      },
    },
    {
      $unionWith: {
        coll: activityCollection,
        pipeline: [
          { $match: { organizationId, deletedAt: null } },
          { $addFields: { _source: "activity" } },
        ],
      },
    },
    {
      $facet: {
        pipelineSummary: [
          {
            $match: {
              _source: "deal",
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
          {
            $project: {
              stageId: "$_id",
              count: 1,
              totalValue: 1,
              _id: 0,
            },
          },
        ],
        wonThisMonth: [
          {
            $match: {
              _source: "deal",
              status: "WON",
              closedAt: { $gte: startOfMonth },
              ...(wonStageId ? { stageId: wonStageId } : {}),
            },
          },
          { $count: "total" },
        ],
        lostThisMonth: [
          {
            $match: {
              _source: "deal",
              status: "LOST",
              closedAt: { $gte: startOfMonth },
              ...(lostStageId ? { stageId: lostStageId } : {}),
            },
          },
          { $count: "total" },
        ],
        pipelineValue: [
          { $match: { _source: "deal", status: "OPEN" } },
          { $group: { _id: null, totalValue: { $sum: "$value" } } },
        ],
        leadConversion: [
          {
            $match: {
              _source: "lead",
              createdAt: { $gte: startOfMonth },
            },
          },
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
              _source: "deal",
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
          {
            $match: {
              _source: "task",
              status: { $in: ["TODO", "IN_PROGRESS"] },
              dueAt: { $lt: now },
            },
          },
          { $count: "total" },
        ],
        recentActivity: [
          {
            $match: {
              _source: "activity",
              occurredAt: { $gte: thirtyDaysAgo },
            },
          },
          { $sort: { occurredAt: -1 } },
          { $limit: 10 },
          {
            $project: {
              title: 1,
              occurredAt: 1,
              type: 1,
              metadata: 1,
            },
          },
        ],
      },
    },
  ] as PipelineStage[];
}
