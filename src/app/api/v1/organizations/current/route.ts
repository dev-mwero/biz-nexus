import { z } from "zod";
import { type Organization, updateOrganization } from "@/modules/organizations";
import { parseBody } from "@/shared/api/parse-body";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { requestMeta } from "@/shared/auth/session-http";
import { ok } from "@/shared/responses/envelope";

/**
 * The caller's active organisation.
 *
 * `current` is a fixed segment, not a parameter, and that is the whole
 * isolation story for this pair: there is no id to send, so there is no id to
 * aim at another tenant. The organisation is read from the session, and a
 * caller who is not an active member of one is refused by `requireOrg` before
 * either handler runs.
 */

/**
 * The organisation as the settings screen needs it.
 *
 * Not the document. `createdBy`, `updatedBy`, `deletedAt` and `settings` are
 * storage and audit details that no screen renders, and `_id`/`__v` are
 * mongoose internals. Every field here is one a client reads.
 */
function serializeOrganization(organization: Organization) {
  return {
    id: organization._id.toString(),
    name: organization.name,
    slug: organization.slug,
    logoUrl: organization.logoUrl,
    timezone: organization.timezone,
    currency: organization.currency,
    dateFormat: organization.dateFormat,
    weekStartsOn: organization.weekStartsOn,
    isActive: organization.isActive,
    createdAt: organization.createdAt,
    updatedAt: organization.updatedAt,
  };
}

/**
 * GET /api/v1/organizations/current
 *
 * Permission: `organization.read`
 */
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("organization.read");

  return ok(serializeOrganization(ctx.organization));
});

/**
 * The fields the settings screen can change.
 *
 * A `strictObject`, so an unknown key is a 422 rather than silently dropped.
 * At least one field is required: a `PATCH` with no changes is a request that
 * cannot mean anything, and answering it with the current organisation would
 * make "did my edit apply?" indistinguishable from "did I send anything?".
 */
const updateOrganizationBody = z
  .strictObject({
    name: z.string().trim().min(1).max(120).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    currency: z.string().trim().length(3).toUpperCase().optional(),
    dateFormat: z.string().trim().min(1).max(32).optional(),
    weekStartsOn: z.number().int().min(0).max(6).optional(),
  })
  .refine((body) => Object.values(body).some((value) => value !== undefined), {
    message: "Provide at least one field to change.",
  });

/**
 * PATCH /api/v1/organizations/current
 *
 * Permission: `organization.update`
 *
 * The audit row is written by `updateOrganization`, not here, so there is no
 * path where a change lands without one. `requestMeta` is passed through rather
 * than read in the service, because the service has no `Request` and the origin
 * of a settings change is an attribute of the request that made it.
 */
export const PATCH = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("organization.update");

  const body = await parseBody(request, updateOrganizationBody);
  const meta = requestMeta(request);

  const { organization } = await updateOrganization(
    ctx.organization._id,
    body,
    { id: ctx.user._id, name: ctx.user.name },
    meta,
  );

  return ok(serializeOrganization(organization));
});
