import type { Types } from "mongoose";
import type { PipelineStage } from "@/modules/pipelines/pipeline.model";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { PipelineService } from "@/modules/pipelines/pipeline.service";
import { readJson, withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { ok } from "@/shared/responses/envelope";

function extractPipelineId(request: Request): string {
  const path = new URL(request.url).pathname;
  const parts = path.split("/");
  // /api/v1/pipelines/[id]/reorder -> parts[parts.length - 2]
  return parts[parts.length - 2];
}

/**
 * POST /api/v1/pipelines/:id/reorder
 * Reorder/replace stages atomically.
 */
export const POST = withApi(async (request, context) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("pipelines.update");

  const pipelineId = extractPipelineId(request);
  if (!pipelineId) {
    return new Response(
      JSON.stringify({
        error: { code: "BAD_REQUEST", message: "Pipeline ID is required." },
      }),
      { status: 400 },
    );
  }

  const body = await readJson<{
    stages: Omit<PipelineStage, "_id">[];
  }>(request);

  if (!body.stages || !Array.isArray(body.stages)) {
    return new Response(
      JSON.stringify({
        error: {
          code: "VALIDATION_FAILED",
          message: "Stages array is required.",
        },
      }),
      { status: 422 },
    );
  }

  const repo = new PipelineRepository(ctx.organization._id, ctx.user._id);
  const service = new PipelineService(repo, ctx.user._id);

  const pipeline = await service.reorderStages(pipelineId, body.stages);

  return ok(pipeline);
});
