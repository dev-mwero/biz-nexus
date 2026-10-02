import type { Types } from "mongoose";
import { connectToDatabase } from "@/db/connection";
import { ActivityModel } from "@/modules/activities";
import { DealModel, LeadModel, TaskModel } from "@/modules/crm";
import { buildDashboardAggregationPipeline } from "@/modules/dashboard/dashboard-aggregation";
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

  // UTC month boundary, not the server's local one.
  //
  // A server's local zone is never the right answer for a tenant's calendar
  // month: it is the answer for whoever deployed the box, so a deal closed at
  // 23:30 UTC on the 1st silently moves between months when the process moves
  // to another region, and every "this month" count changes with the
  // infrastructure. `formatDate` documents the same hazard for display dates.
  //
  // UTC is a fixed choice, not the correct one. Per-organisation months need a
  // timezone per tenant and a tz library to resolve them, which is out of scope
  // here — treat this as a floor that makes the answer the same on every
  // deployment, not as timezone support.
  const startOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Get the default pipeline for this organization.
  //
  // `deletedAt: null` because `PipelineRepository.findDefault()` adds it, and two
  // code paths answering "what is this organisation's default pipeline" must
  // not disagree. Without it the dashboard reports on a deleted pipeline while
  // every other screen reports that there is none.
  const defaultPipeline = await PipelineModel.findOne({
    organizationId,
    isDefault: true,
    deletedAt: null,
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

  // No won/lost stage lookup here any more. `status` decides won and lost, so
  // the counts and the win rate behind them cannot drift apart; a deal sitting
  // in a non-terminal stage but marked WON is still a won deal.
  const [aggregationResult] = await DealModel.aggregate(
    buildDashboardAggregationPipeline({
      organizationId,
      pipelineId: defaultPipeline._id,
      now,
      startOfMonth,
      thirtyDaysAgo,
      stageIds,
      leadCollection: LeadModel.collection.name,
      taskCollection: TaskModel.collection.name,
      activityCollection: ActivityModel.collection.name,
    }),
  );

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
