import type { Types } from "mongoose";
import { connectToDatabase } from "@/db/connection";
import { ActivityModel } from "@/modules/activities";
import { DealModel, TaskModel } from "@/modules/crm";
import { PipelineModel } from "@/modules/pipelines";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { formatCurrency } from "@/shared/lib/format";

/**
 * GET /api/v1/dashboard
 *
 * Returns all MVP dashboard metrics in a single round-trip using MongoDB $facet aggregation.
 * Metrics include:
 * - Metric cards: deals won/lost this month, lead conversion rate, pipeline value, win rate
 * - Pipeline summary: deals by stage (count + total value)
 * - Overdue tasks count
 * - Recent activity (10 items)
 * Requires: dashboard.read
 */
export const GET = withApi(async (request: Request): Promise<Response> => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("dashboard.read");

  await connectToDatabase();

  const organizationId = context.organization._id;
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Get the default pipeline for this organization
  const defaultPipeline = await PipelineModel.findOne({
    organizationId,
    isDefault: true,
  }).lean();

  if (!defaultPipeline) {
    throw new AppError("RECORD_NOT_FOUND", {
      message: "No default pipeline configured.",
    });
  }

  const stageIds = defaultPipeline.stages.map((s) => s._id);
  const stageIdToName = new Map(
    defaultPipeline.stages.map((s) => [s._id.toString(), s.name]),
  );
  const wonStage = defaultPipeline.stages.find((s) => s.isWon);
  const lostStage = defaultPipeline.stages.find((s) => s.isLost);

  // Single $facet aggregation for all metrics
  const [aggregationResult] = await DealModel.aggregate([
    { $match: { organizationId } },
    {
      $facet: {
        // Pipeline summary: deals by stage (OPEN only)
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
            $project: {
              stageId: "$_id",
              count: 1,
              totalValue: 1,
              _id: 0,
            },
          },
        ],

        // Won deals this month
        wonThisMonth: [
          {
            $match: {
              status: "WON",
              closedAt: { $gte: startOfMonth },
              ...(wonStage ? { stageId: wonStage._id } : {}),
            },
          },
          { $count: "total" },
        ],

        // Lost deals this month
        lostThisMonth: [
          {
            $match: {
              status: "LOST",
              closedAt: { $gte: startOfMonth },
              ...(lostStage ? { stageId: lostStage._id } : {}),
            },
          },
          { $count: "total" },
        ],

        // Pipeline value (open deals)
        pipelineValue: [
          { $match: { status: "OPEN" } },
          { $group: { _id: null, totalValue: { $sum: "$value" } } },
        ],

        // Lead conversion rate (converted leads / total leads this month)
        leadConversion: [
          {
            $match: {
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

        // Win rate (won / (won + lost) for closed deals this month)
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

        // Overdue tasks count
        overdueTasks: [
          { $match: { organizationId } },
          {
            $match: {
              status: { $in: ["TODO", "IN_PROGRESS"] },
              dueAt: { $lt: now },
            },
          },
          { $count: "total" },
        ],

        // Recent activity (10 items)
        recentActivity: [
          { $match: { organizationId, occurredAt: { $gte: thirtyDaysAgo } } },
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
  ]);

  // Process pipeline summary
  const pipelineSummary = (
    (aggregationResult.pipelineSummary as Array<{
      stageId: Types.ObjectId;
      count: number;
      totalValue: number;
    }>) || []
  ).map((item) => ({
    stageId: item.stageId.toString(),
    stageName: stageIdToName.get(item.stageId.toString()) ?? "Unknown",
    count: item.count,
    totalValue: item.totalValue,
    formattedValue: formatCurrency(
      item.totalValue,
      context.organization.currency ?? "USD",
    ),
  }));

  // Process metric cards
  const wonThisMonth = aggregationResult.wonThisMonth?.[0]?.total ?? 0;
  const lostThisMonth = aggregationResult.lostThisMonth?.[0]?.total ?? 0;
  const pipelineValue = aggregationResult.pipelineValue?.[0]?.totalValue ?? 0;

  const leadConversion = aggregationResult.leadConversion?.[0];
  const conversionRate =
    leadConversion && leadConversion.total > 0
      ? (leadConversion.converted / leadConversion.total) * 100
      : 0;

  const winRateData = aggregationResult.winRate?.[0];
  const winRate =
    winRateData && winRateData.total > 0
      ? (winRateData.won / winRateData.total) * 100
      : 0;

  const overdueTasks = aggregationResult.overdueTasks?.[0]?.total ?? 0;

  const recentActivity =
    (aggregationResult.recentActivity as Array<{
      title: string;
      occurredAt: Date;
      type: string;
      metadata: Record<string, unknown>;
    }>) || [];

  return Response.json({
    data: {
      metricCards: {
        dealsWonThisMonth: wonThisMonth,
        dealsLostThisMonth: lostThisMonth,
        pipelineValue,
        formattedPipelineValue: formatCurrency(
          pipelineValue,
          context.organization.currency ?? "USD",
        ),
        leadConversionRate: Math.round(conversionRate * 10) / 10,
        winRate: Math.round(winRate * 10) / 10,
      },
      pipelineSummary,
      overdueTasks,
      recentActivity,
    },
  });
});
