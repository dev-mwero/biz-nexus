import { unreadCount } from "@/modules/notifications";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";

/**
 * GET /api/v1/notifications/unread-count
 *
 * Returns the unread notification count for the current user in the active organization.
 * Requires: notifications.read
 */
export const GET = withApi(async (request: Request): Promise<Response> => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("notifications.read");

  const count = await unreadCount({
    organizationId: context.organization._id,
    userId: context.user._id,
  });

  return Response.json({ data: { count } });
});
