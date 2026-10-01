import { DealRepository } from "@/modules/deals/deal.repository";
import { DealService } from "@/modules/deals/deal.service";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { readJson, withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { ok } from "@/shared/responses/envelope";

function extractDealId(request: Request): string {
  const path = new URL(request.url).pathname;
  const parts = path.split("/");
  // .../deals/:id/lose -> parts[parts.length - 2] is the id
  return parts[parts.length - 2];
}

/**
 * POST /api/v1/deals/:id/lose
 * Mark a deal as lost.
 * Body: { reason?: string }
 * Moves it to the pipeline's lost stage, sets status to LOST, probability to 0.
 */
export const POST = withApi(async (request, _context) => {
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
    reason?: string;
  }>(request);

  const repo = new DealRepository(ctx.organization._id, ctx.user._id);
  const pipelineRepo = new PipelineRepository(
    ctx.organization._id,
    ctx.user._id,
  );
  const service = new DealService(repo, pipelineRepo, ctx.user._id);

  try {
    const deal = await service.loseDeal(dealId, body.reason);

    return ok(deal);
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      return new Response(
        JSON.stringify({
          error: { code: "RECORD_NOT_FOUND", message: "Deal not found." },
        }),
        { status: 404 },
      );
    }
    if (error instanceof Error && error.message.includes("already lost")) {
      return new Response(
        JSON.stringify({ error: { code: "CONFLICT", message: error.message } }),
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message.includes("won deal")) {
      return new Response(
        JSON.stringify({ error: { code: "CONFLICT", message: error.message } }),
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message.includes("no 'Lost' stage")) {
      return new Response(
        JSON.stringify({
          error: { code: "VALIDATION_FAILED", message: error.message },
        }),
        { status: 422 },
      );
    }
    throw error;
  }
});
