import type { Types } from "mongoose";
import { DealRepository } from "@/modules/deals/deal.repository";
import { DealService } from "@/modules/deals/deal.service";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { readJson, withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { ok } from "@/shared/responses/envelope";

function extractDealId(request: Request): string {
  const path = new URL(request.url).pathname;
  const parts = path.split("/");
  // .../deals/:id/move -> parts[parts.length - 2] is the id
  return parts[parts.length - 2];
}

/**
 * POST /api/v1/deals/:id/move
 * Move a deal to a new stage.
 * Body: { stageId: string, sortOrder: number, reason?: string }
 */
export const POST = withApi(async (request, context) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("deals.move");

  const dealId = extractDealId(request);
  if (!dealId) {
    return new Response(
      JSON.stringify({
        error: { code: "BAD_REQUEST", message: "Deal ID is required." },
      }),
      { status: 400 },
    );
  }

  const body = await readJson<{
    stageId: string;
    sortOrder: number;
    reason?: string;
  }>(request);

  if (!body.stageId) {
    return new Response(
      JSON.stringify({
        error: {
          code: "VALIDATION_FAILED",
          message: "Target stage is required.",
        },
      }),
      { status: 422 },
    );
  }

  if (
    typeof body.sortOrder !== "number" ||
    body.sortOrder < 0 ||
    !Number.isInteger(body.sortOrder)
  ) {
    return new Response(
      JSON.stringify({
        error: {
          code: "VALIDATION_FAILED",
          message: "Sort order must be a non-negative integer.",
        },
      }),
      { status: 422 },
    );
  }

  const repo = new DealRepository(ctx.organization._id, ctx.user._id);
  const pipelineRepo = new PipelineRepository(
    ctx.organization._id,
    ctx.user._id,
  );
  const service = new DealService(repo, pipelineRepo, ctx.user._id);

  try {
    const result = await service.moveDeal(dealId, {
      stageId: body.stageId,
      sortOrder: body.sortOrder,
      reason: body.reason,
    });

    return ok({ deal: result.deal, activity: result.activity });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("not belong to this deal's pipeline")
    ) {
      return new Response(
        JSON.stringify({
          error: { code: "VALIDATION_FAILED", message: error.message },
        }),
        { status: 422 },
      );
    }
    if (error instanceof Error && error.message.includes("not found")) {
      return new Response(
        JSON.stringify({
          error: { code: "RECORD_NOT_FOUND", message: "Deal not found." },
        }),
        { status: 404 },
      );
    }
    throw error;
  }
});
