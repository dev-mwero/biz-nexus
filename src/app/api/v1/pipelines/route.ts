import type { Types } from "mongoose";
import type { PipelineStage } from "@/modules/pipelines/pipeline.model";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { PipelineService } from "@/modules/pipelines/pipeline.service";
import { readJson, withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { ok } from "@/shared/responses/envelope";

/**
 * GET /api/v1/pipelines
 * List all pipelines for the active organization.
 */
export const GET = withApi(async (request, context) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("pipelines.read");

  const repo = new PipelineRepository(ctx.organization._id, ctx.user._id);
  const service = new PipelineService(repo, ctx.user._id);

  const pipelines = await service.list();

  return ok(pipelines);
});

/**
 * POST /api/v1/pipelines
 * Create a new pipeline.
 */
export const POST = withApi(async (request, context) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("pipelines.create");

  const body = await readJson<{
    name: string;
    description?: string | null;
    isDefault?: boolean;
    stages?: Omit<PipelineStage, "_id">[];
  }>(request);

  if (!body.name?.trim()) {
    return new Response(
      JSON.stringify({
        error: { code: "VALIDATION_FAILED", message: "Name is required." },
      }),
      { status: 422 },
    );
  }

  const repo = new PipelineRepository(ctx.organization._id, ctx.user._id);
  const service = new PipelineService(repo, ctx.user._id);

  const pipeline = await service.create({
    name: body.name.trim(),
    description: body.description?.trim() ?? null,
    isDefault: body.isDefault ?? false,
    stages: body.stages,
  });

  return ok(pipeline, { status: 201 });
});
