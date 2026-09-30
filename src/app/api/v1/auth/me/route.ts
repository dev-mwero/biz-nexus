import { toPublicUser } from "@/modules/identity";
import { normalizePermissions } from "@/modules/rbac/permissions";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";

/**
 * GET /api/v1/auth/me
 *
 * The current user, the active organisation, the role, and the permissions that
 * role grants.
 *
 * `organisation` is nullable rather than a 403. "Signed in, no active
 * organisation" is a real state - a brand-new account, or one removed from every
 * organisation - and the client needs to render it as such and offer to create or
 * join one. Returning a permission list computed from a missing role is also
 * genuinely an empty list, not a failure, so the honest answer is `null` there
 * and `[]` for the permissions.
 */
export const GET = withApi(async (request: Request): Promise<Response> => {
  const guards = guardsFor(request);
  const session = await guards.getSession();
  if (!session)
    throw new AppError("UNAUTHENTICATED", { message: "Sign in to continue." });

  // `requireOrg` cannot be used unconditionally: it throws for a valid session
  // with no usable organisation, and this endpoint has to describe that state
  // rather than refuse to describe it.
  if (!session.activeOrganizationId) {
    const user = await guards.requireUser();
    return Response.json({
      data: {
        user: toPublicUser(user),
        organization: null,
        role: null,
        permissions: [],
      },
    });
  }

  // One guard call, not three. Each of `getSession`, `requireUser` and
  // `requireOrg` resolves the session from the cookie itself, so calling all
  // three for one request is three index lookups of the same row plus three
  // round trips. `requireOrg` returns the user as part of its context, so the
  // separate `requireUser` above is only needed on the branch that has no
  // organisation to ask about.
  const context = await guards.requireOrg();

  return Response.json({
    data: {
      user: toPublicUser(context.user),
      organization: {
        id: context.organization._id.toString(),
        name: context.organization.name,
        slug: context.organization.slug,
      },
      role: { id: context.role._id.toString(), name: context.role.name },
      // The role stores a plain string array, so it is normalised through the
      // permission vocabulary rather than cast. A role row that names something
      // unrecognised yields that entry dropped instead of a permission the client
      // would render but the guard would never enforce.
      permissions: normalizePermissions(context.role.permissions),
    },
  });
});
