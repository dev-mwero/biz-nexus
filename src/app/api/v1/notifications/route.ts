import type { Types } from "mongoose";
import { BELL_PAGE_SIZE, listNotifications } from "@/modules/notifications";
import { readJson, withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";

/**
 * GET /api/v1/notifications
 *
 * Returns paginated notifications for the current user in the active organization.
 * Query params: limit, before (cursor)
 * Requires: notifications.read
 */
export const GET = withApi(async (request: Request): Promise<Response> => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("notifications.read");

  const url = new URL(request.url);
  const limit = Math.min(
    Math.max(
      parseInt(url.searchParams.get("limit") ?? String(BELL_PAGE_SIZE), 10),
      1,
    ),
    100,
  );
  const beforeParam = url.searchParams.get("before");
  const before = beforeParam ? new Date(beforeParam) : undefined;

  if (beforeParam && Number.isNaN(before!.getTime())) {
    throw new AppError("INVALID_CURSOR", { message: "Invalid before cursor." });
  }

  const notifications = await listNotifications({
    organizationId: context.organization._id,
    userId: context.user._id,
    limit,
    before,
  });

  return Response.json({ data: notifications });
});
