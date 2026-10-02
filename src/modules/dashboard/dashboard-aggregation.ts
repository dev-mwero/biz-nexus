import type { PipelineStage, Types } from "mongoose";

interface DashboardAggregationInput {
  organizationId: Types.ObjectId;
  /** The organisation's default pipeline. See the `$match` below for why. */
  pipelineId: Types.ObjectId;
  now: Date;
  startOfMonth: Date;
  thirtyDaysAgo: Date;
  stageIds: Types.ObjectId[];
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
 *
 * The deal facets are built to be mutually consistent, because the screen shows
 * them at the same time and a reader who adds two cards up expects the total to
 * match the third. The two invariants, stated here because they are what a
 * future edit to this function must not break:
 *
 * - `wonThisMonth.total + lostThisMonth.total === winRate.total`. All three
 *   filter on `status` alone, because `status` is what "won" means and `stageId`
 *   is presentation. Constraining the counts by the pipeline's won stage made
 *   the two visible cards sum to less than the denominator behind the
 *   percentage, for any tenant whose won deals were not all sitting in the won
 *   stage.
 * - `pipelineValue.totalValue === sum(pipelineSummary[].totalValue)`. The two
 *   facets take the same predicate, so the "Pipeline Value" card and the
 *   summary table's "Total" row are one sum rather than two different
 *   questions — the card used to count every open deal in the organisation
 *   while the table below it listed only this pipeline's.
 */
export function buildDashboardAggregationPipeline({
  organizationId,
  pipelineId,
  now,
  startOfMonth,
  thirtyDaysAgo,
  stageIds,
  leadCollection,
  taskCollection,
  activityCollection,
}: DashboardAggregationInput) {
  return [
    // `pipelineId` belongs here, on the one filter every deal facet inherits,
    // rather than repeated in each facet: repetition is what let the facets
    // drift apart in the first place. The endpoint already refuses to serve a
    // dashboard for an organisation with no default pipeline, so the subject of
    // this screen is that pipeline, and every stage id it filters on comes from
    // it. A deal in a second pipeline has a stage the summary table cannot
    // name, so counting it inflates the total the card and the table disagree
    // about.
    //
    // This `$match` only ever sees `deals`, because it runs before the
    // `$unionWith` stages below append the other collections — leads, tasks and
    // activities have no pipeline and must not be asked for one.
    { $match: { organizationId, pipelineId, deletedAt: null } },
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
            },
          },
          { $count: "total" },
        ],
        // Same predicate as `pipelineSummary`, deliberately, so the card and the
        // table footer are the same sum instead of the card being the wider
        // question "how much open pipeline does this tenant have".
        pipelineValue: [
          {
            $match: {
              _source: "deal",
              status: "OPEN",
              stageId: { $in: stageIds },
            },
          },
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
