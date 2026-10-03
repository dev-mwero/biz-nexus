import { z } from "zod";
import { inviteMember, SYSTEM_ROLE_KEYS } from "@/modules/organizations";
import { parseBody } from "@/shared/api/parse-body";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { ok } from "@/shared/responses/envelope";

/**
 * POST /api/v1/organizations/current/members/invitations
 *
 * Invite somebody to the caller's active organisation.
 *
 * `roleKey` rather than `roleId`: there is no roles endpoint, so a client has no
 * way to learn a role id, and a system role key is the complete reference — four
 * of them, provisioned per organisation. OWNER is in the list because it is a
 * real role that exists here, and the refusal is the service's: granting a
 * second owner is an ownership transfer, which has its own permission and its own
 * confirmation. Refusing it at the schema instead would hide that from anyone
 * reading the API reference.
 *
 * A `strictObject`, like every other request body here. The default `z.object`
 * drops keys it does not recognise, so `{"email": ..., "roleId": "..."}` would
 * come back a 201 with the default role and a client would reasonably conclude
 * its role was applied.
 */
const inviteMemberBody = z.strictObject({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .max(254)
    .email("Enter a valid email address."),
  roleKey: z.enum(SYSTEM_ROLE_KEYS).optional(),
});

/**
 * `token` is in the response and nowhere else.
 *
 * The raw token exists for exactly one consumer: the invitation email, which is
 * not built yet — docs/DISCOVERY.md leaves the transactional mailer undecided. So
 * the value comes back here for the caller to deliver or hand over, and it is
 * the last chance to read it. The stored copy is a SHA-256 digest, so a
 * resend is the only way to get this value again, and a resend invalidates the
 * previous link.
 *
 * When a mailer exists this should stop being a response field and become the
 * mail's business. Until then, a caller with `invitations.create` can read every
 * token it creates — which is the same set of people who can read the
 * invitation list, so it grants nothing they did not already have. That stops
 * being true the moment the permission model changes, and it is worth
 * revisiting then rather than assuming.
 */
export const POST = withApi(
  async (request: Request) => {
    const guards = guardsFor(request);
    const ctx = await guards.requirePermission("invitations.create");

    const body = await parseBody(request, inviteMemberBody);

    const { token, invitation, replaced } = await inviteMember({
      organizationId: ctx.organization._id,
      email: body.email,
      roleKey: body.roleKey,
      invitedBy: ctx.user._id,
    });

    return ok({ invitation, token, replaced });
  },
  { status: 201 },
);
