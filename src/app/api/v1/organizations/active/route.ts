import { z } from "zod";
import { setActiveOrganization } from "@/modules/organizations";
import { parseBody } from "@/shared/api/parse-body";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";

/**
 * POST /api/v1/organizations/active
 *
 * Switch which organisation the caller's session points at.
 *
 * The organisation id is the one place a client names a tenant, and it is named
 * only as a request to change the pointer — `setActiveOrganization` verifies an
 * ACTIVE membership before writing, and the DAL re-verifies it on every request
 * afterwards. A request body cannot grant access to an organisation the caller
 * is not in; all it can do is fail with a 404 that does not distinguish "no such
 * organisation" from "not yours".
 */
const switchOrganizationBody = z.object({
  organizationId: z.string().min(1),
});

export const POST = withApi(async (request: Request): Promise<Response> => {
  const guards = guardsFor(request);
  const session = await guards.getSession();
  if (!session) {
    throw new AppError("UNAUTHENTICATED", { message: "Sign in to continue." });
  }

  const body = await parseBody(request, switchOrganizationBody);

  // Writes the session row, not the cookie. The token is an opaque handle stored
  // hashed, so the active organisation is read from the database on every
  // request and this change is visible immediately with no re-issue.
  const updated = await setActiveOrganization(session._id, body.organizationId);

  return Response.json(
    ok({
      activeOrganizationId: updated.activeOrganizationId?.toString() ?? null,
    }),
  );
});
