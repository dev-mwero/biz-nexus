import { DealRepository } from "@/modules/deals/deal.repository";
import { DealService } from "@/modules/deals/deal.service";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { ok } from "@/shared/responses/envelope";

/**
 * GET /api/v1/deals/summary
 * Get deal summary statistics for all pipelines in the organization.
 */
export const GET = withApi(async (request, context) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("deals.read");

  const dealRepo = new DealRepository(ctx.organization._id, ctx.user._id);
  const pipelineRepo = new PipelineRepository(
    ctx.organization._id,
    ctx.user._id,
  );
  const pipelineService = (await import("@/modules/pipelines/pipeline.service"))
    .PipelineService;
  const dealService = new DealService(dealRepo, pipelineRepo, ctx.user._id);
  const pipelineSvc = new pipelineService(pipelineRepo, ctx.user._id);

  const pipelines = await pipelineSvc.list();

  const summaries = await Promise.all(
    pipelines.map(async (pipeline) => {
      const summary = await dealService.getPipelineSummary(pipeline._id);
      return {
        pipelineId: pipeline._id.toString(),
        pipelineName: pipeline.name,
        summary,
      };
    }),
  );

  // Also get overall open deals for forecast
  const openDeals = await dealService.list(
    { status: "OPEN" },
    { sort: { expectedCloseDate: 1 } },
  );

  return ok({
    byPipeline: summaries,
    openDealsCount: openDeals.length,
    totalOpenValue: openDeals.reduce((sum, d) => sum + d.value, 0),
  });
});
