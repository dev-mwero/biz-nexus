import { z } from "zod";
import {
  createOrganization,
  listOrganizationsForUser,
} from "@/modules/organizations";
import { parseBody } from "@/shared/api/parse-body";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";

/**
 * The bootstrap surface for organisations.
 *
 * `GET` lists the organisations the caller can act in, `POST` creates one. Both
 * are deliberately outside `requireOrg`: the whole point of onboarding is that a
 * brand-new account has no active organisation yet, and an endpoint that
 * required one would be unusable by exactly the people who need it.
 *
 * `requireUser` is the gate instead. "Signed in but belonging to nothing" is the
 * state this endpoint exists to resolve, not a reason to refuse the request.
 */

const createOrganizationBody = z.object({
  /**
   * The only field the client may choose. Timezone, currency and the rest are
   * settings the organisation can change later; accepting them here would let a
   * caller set a workspace's locale before they have seen it, for no benefit.
   */
  name: z.string().trim().min(1).max(120),
});

export const GET = withApi(async (request: Request): Promise<Response> => {
  const guards = guardsFor(request);
  const user = await guards.requireUser();
  const organizations = await listOrganizationsForUser(user._id);

  return Response.json(ok(organizations));
});

export const POST = withApi(async (request: Request): Promise<Response> => {
  const guards = guardsFor(request);
  const session = await guards.getSession();
  if (!session) {
    throw new AppError("UNAUTHENTICATED", { message: "Sign in to continue." });
  }

  // Looked up separately rather than via `requireOrg`, for the reason above: the
  // caller is very often the owner of no organisation yet.
  const user = await guards.requireUser();

  const body = await parseBody(request, createOrganizationBody);

  // The session id is passed so the new organisation becomes the active one in
  // the same transaction that creates it. Without it the founder would hold a
  // session pointing at nothing and would have to make a second call to be able
  // to use the organisation they just made.
  const { organization } = await createOrganization({
    name: body.name,
    ownerId: user._id,
    sessionId: session._id,
  });

  return Response.json(
    ok({
      organization: {
        id: organization._id.toString(),
        name: organization.name,
        slug: organization.slug,
      },
    }),
    {
      status: 201,
      // RFC 9110 §10.2.2: a 201 names the resource it created, so the client
      // does not have to assume where the organisation lives.
      headers: { Location: `/api/v1/organizations/${organization._id}` },
    },
  );
});
