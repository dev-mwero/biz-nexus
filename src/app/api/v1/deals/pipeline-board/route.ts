import type { Types } from "mongoose";
import { DealRepository } from "@/modules/deals/deal.repository";
import { DealService } from "@/modules/deals/deal.service";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { PipelineService } from "@/modules/pipelines/pipeline.service";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { ok } from "@/shared/responses/envelope";

/**
 * GET /api/v1/deals/pipeline-board?pipelineId=...
 * Get the full Kanban board data for a pipeline: stages + deals grouped by stage.
 * For virtualized columns, the frontend can also call GET /api/v1/deals?pipelineId=...&stageId=...
 */
export const GET = withApi(async (request, context) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("deals.read");

  const url = new URL(request.url);
  const pipelineId = url.searchParams.get("pipelineId");

  if (!pipelineId) {
    return new Response(
      JSON.stringify({
        error: {
          code: "VALIDATION_FAILED",
          message: "Pipeline ID is required.",
        },
      }),
      { status: 422 },
    );
  }

  const dealRepo = new DealRepository(ctx.organization._id, ctx.user._id);
  const pipelineRepo = new PipelineRepository(
    ctx.organization._id,
    ctx.user._id,
  );
  const dealService = new DealService(dealRepo, pipelineRepo, ctx.user._id);
  const pipelineService = new PipelineService(pipelineRepo, ctx.user._id);

  const [pipeline, deals] = await Promise.all([
    pipelineService.getById(pipelineId),
    dealService.getKanbanDeals(pipelineId),
  ]);

  if (!pipeline) {
    return new Response(
      JSON.stringify({
        error: { code: "RECORD_NOT_FOUND", message: "Pipeline not found." },
      }),
      { status: 404 },
    );
  }

  // Group deals by stageId
  const dealsByStage = new Map<string, typeof deals>();
  for (const deal of deals) {
    const stageKey = deal.stageId.toString();
    if (!dealsByStage.has(stageKey)) {
      dealsByStage.set(stageKey, []);
    }
    dealsByStage.get(stageKey)!.push(deal);
  }

  // Build column data
  const columns = pipeline.stages.map((stage) => ({
    stage: {
      id: stage._id.toString(),
      key: stage.key,
      name: stage.name,
      order: stage.order,
      probability: stage.probability,
      color: stage.color,
      isWon: stage.isWon,
      isLost: stage.isLost,
    },
    deals: dealsByStage.get(stage._id.toString()) ?? [],
  }));

  return ok({
    pipeline: {
      id: pipeline._id.toString(),
      name: pipeline.name,
      description: pipeline.description,
      isDefault: pipeline.isDefault,
      order: pipeline.order,
    },
    columns,
  });
});
