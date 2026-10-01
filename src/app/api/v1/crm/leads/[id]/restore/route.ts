import { LeadRepository, LeadService } from "@/modules/crm";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";
import { pathParam } from "../../../../../_lib/path-param";

/**
 * POST /api/v1/leads/:id/restore
 * Restore a soft-deleted lead.
 * Permission: leads.update
 */
export const POST = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("leads.update");

  // `fromEnd` is 2 because the last segment is the literal "restore". Reading
  // the last segment instead yields the string "restore" as the id, so every
  // restore 500s on a cast or matches nothing at all.
  const id = pathParam(request, 2);

  const service = new LeadService(context.organization._id, context.user._id);

  // The repository rather than the service: `restoreById` reaches rows the
  // tenant scope hides, which is the whole point of a restore, and the service
  // deliberately does not expose it. `restoreById` is scoped to the same
  // organization, so a foreign id matches nothing and is a 404 rather than a
  // write.
  const repo = new LeadRepository(context.organization._id, context.user._id);
  const restored = await repo.restoreById(id);
  if (restored.matchedCount === 0) {
    throw new AppError("RECORD_NOT_FOUND", { message: "Lead not found." });
  }

  const lead = await service.getById(id);
  return ok(lead);
});
