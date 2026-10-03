import { z } from "zod";
import { CompanyService, ContactService } from "@/modules/crm";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { listQuery, serializeSort } from "@/shared/query/list-query";
import { ok } from "@/shared/responses/envelope";
import { pathParam } from "../../../../../_lib/path-param";

const { parse, meta } = listQuery({
  filters: z.object({}),
  sortable: ["lastName", "firstName", "createdAt", "updatedAt"],
  defaultSort: "lastName,firstName",
  searchable: false,
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
  const parsed = parse(new URL(request.url).searchParams);

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
    sort: serializeSort(parsed.sort),
    limit: parsed.pageSize,
  });

  return ok(contacts, meta(parsed, contacts.length));
});
