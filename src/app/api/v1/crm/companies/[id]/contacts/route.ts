import { z } from "zod";
import { CompanyService, ContactService } from "@/modules/crm";
import { queryFromSearchParams } from "@/shared/api/search-params";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok, pageMeta } from "@/shared/responses/envelope";
import { pathParam } from "../../../../../_lib/path-param";

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sort: z.string().default("lastName,firstName"),
});

/**
 * GET /api/v1/crm/companies/:id/contacts
 * List contacts belonging to a company.
 * Permission: contacts.read (or companies.read)
 */
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("contacts.read");

  const id = pathParam(request, 2);
  const { searchParams } = new URL(request.url);
  const query = listQuerySchema.parse(queryFromSearchParams(searchParams, []));

  // Verify company exists
  const companyService = new CompanyService(
    context.organization._id,
    context.user._id,
  );
  const company = await companyService.getById(id);
  if (!company) {
    throw new AppError("RECORD_NOT_FOUND", { message: "Company not found." });
  }

  const contactService = new ContactService(
    context.organization._id,
    context.user._id,
  );
  const contacts = await contactService.getByCompany(id, {
    sort: query.sort,
    limit: query.pageSize,
  });

  return ok(
    contacts,
    pageMeta({
      page: query.page,
      pageSize: query.pageSize,
      total: contacts.length,
    }),
  );
});
