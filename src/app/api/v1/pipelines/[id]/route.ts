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
  return parts[parts.length - 1];
}

/**
 * GET /api/v1/pipelines/:id
 * Get a pipeline by ID with stages.
 */
export const GET = withApi(async (request, context) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("pipelines.read");

  const pipelineId = extractPipelineId(request);
  if (!pipelineId) {
    return new Response(
      JSON.stringify({
        error: { code: "BAD_REQUEST", message: "Pipeline ID is required." },
      }),
      { status: 400 },
    );
  }

  const repo = new PipelineRepository(ctx.organization._id, ctx.user._id);
  const service = new PipelineService(repo, ctx.user._id);

  const pipeline = await service.getById(pipelineId);
  if (!pipeline) {
    return new Response(
      JSON.stringify({
        error: { code: "RECORD_NOT_FOUND", message: "Pipeline not found." },
      }),
      { status: 404 },
    );
  }

  return ok(pipeline);
});

/**
 * PATCH /api/v1/pipelines/:id
 * Update a pipeline (metadata or stages reorder).
 */
export const PATCH = withApi(async (request, context) => {
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
    name?: string;
    description?: string | null;
    order?: number;
    isDefault?: boolean;
    stages?: Omit<PipelineStage, "_id">[];
  }>(request);

  const repo = new PipelineRepository(ctx.organization._id, ctx.user._id);
  const service = new PipelineService(repo, ctx.user._id);

  // Check if stages are being reordered
  if (body.stages !== undefined) {
    const pipeline = await service.reorderStages(pipelineId, body.stages);
    return ok(pipeline);
  }

  // Otherwise update metadata
  const pipeline = await service.update(pipelineId, {
    name: body.name?.trim(),
    description: body.description?.trim() ?? null,
    order: body.order,
    isDefault: body.isDefault,
  });

  if (!pipeline) {
    return new Response(
      JSON.stringify({
        error: { code: "RECORD_NOT_FOUND", message: "Pipeline not found." },
      }),
      { status: 404 },
    );
  }

  return ok(pipeline);
});

/**
 * DELETE /api/v1/pipelines/:id
 * Delete a pipeline (only if no deals reference it).
 */
export const DELETE = withApi(async (request, context) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("pipelines.delete");

  const pipelineId = extractPipelineId(request);
  if (!pipelineId) {
    return new Response(
      JSON.stringify({
        error: { code: "BAD_REQUEST", message: "Pipeline ID is required." },
      }),
      { status: 400 },
    );
  }

  const repo = new PipelineRepository(ctx.organization._id, ctx.user._id);
  const service = new PipelineService(repo, ctx.user._id);

  const result = await service.delete(pipelineId);
  if (!result.deleted) {
    return new Response(
      JSON.stringify({
        error: {
          code: "CONFLICT",
          message: `Cannot delete pipeline: ${result.dealCount} deal(s) reference it. Archive instead.`,
        },
      }),
      { status: 409 },
    );
  }

  return ok({ deleted: true });
});
