import { timelineForEntity } from "@/modules/activities/activity.service";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { ok, pageMeta } from "@/shared/responses/envelope";

function extractDealId(request: Request): string {
  const path = new URL(request.url).pathname;
  const parts = path.split("/");
  // .../deals/:id/timeline -> parts[parts.length - 2] is the id
  return parts[parts.length - 2];
}

/**
 * GET /api/v1/deals/:id/timeline
 * Get the activity timeline for a deal.
 * Query params: page, pageSize, before (ISO date)
 */
export const GET = withApi(async (request, context) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("deals.read");

  const dealId = extractDealId(request);
  if (!dealId) {
    return new Response(
      JSON.stringify({
        error: { code: "BAD_REQUEST", message: "Deal ID is required." },
      }),
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "25", 10)),
  );
  const before = url.searchParams.get("before");

  const activities = await timelineForEntity({
    organizationId: ctx.organization._id,
    entityId: dealId,
    limit: pageSize + 1, // Fetch one extra to check if there's a next page
    before: before ? new Date(before) : undefined,
  });

  const hasMore = activities.length > pageSize;
  const data = hasMore ? activities.slice(0, pageSize) : activities;

  return ok(
    data,
    pageMeta({
      page,
      pageSize,
      total: data.length + (hasMore ? 1 : 0), // Approximate for pagination UI
      totalPages: hasMore ? page + 1 : page,
    }),
  );
});
