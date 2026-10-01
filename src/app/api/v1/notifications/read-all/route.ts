import { markAllRead } from "@/modules/notifications";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";

/**
 * POST /api/v1/notifications/read-all
 *
 * Marks all unread notifications as read for the current user.
 * Requires: notifications.update
 */
export const POST = withApi(async (request: Request): Promise<Response> => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("notifications.update");

  const modifiedCount = await markAllRead({
    organizationId: context.organization._id,
    userId: context.user._id,
  });

  return Response.json({ data: { modifiedCount } });
});
