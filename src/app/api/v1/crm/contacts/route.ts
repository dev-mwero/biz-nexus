import { Types } from "mongoose";
import { z } from "zod";
import {
  ContactError,
  ContactService,
  type CreateContactInput,
} from "@/modules/crm";
import { queryBoolean } from "@/shared/api/search-params";
import { readJson, withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { listQuery, serializeSort } from "@/shared/query/list-query";
import { ok } from "@/shared/responses/envelope";

const CONTACT_STATUSES = ["LEAD", "PROSPECT", "CUSTOMER", "INACTIVE"] as const;

const emailSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.string().email(),
  isPrimary: z.boolean().default(false),
});

const phoneSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.string().max(50),
  isPrimary: z.boolean().default(false),
});

const createContactSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  salutation: z.string().max(20).optional().nullable(),
  jobTitle: z.string().max(100).optional().nullable(),
  companyId: z.string().optional().nullable(),
  ownerId: z.string().min(1),
  emails: z.array(emailSchema).default([]),
  phones: z.array(phoneSchema).default([]),
  status: z.enum(CONTACT_STATUSES).default("LEAD"),
  tags: z.array(z.string()).default([]),
  notes: z.string().max(2000).optional().nullable(),
  customFields: z.record(z.string(), z.unknown()).default({}),
});

const contactFiltersSchema = z.object({
  status: z.enum(CONTACT_STATUSES).optional(),
  companyId: z
    .union([z.string().regex(/^[0-9a-fA-F]{24}$/), z.literal("null")])
    .optional(),
  ownerId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  tag: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).default([]),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
  // `queryBoolean`, not `z.coerce.boolean()`: coercion reads "false" as
  // true, so this filter answered the opposite of the question.
  hasEmail: queryBoolean().optional(),
});

const { parse, meta } = listQuery({
  filters: contactFiltersSchema,
  sortable: ["lastName", "firstName", "createdAt", "updatedAt", "status"],
  defaultSort: "lastName,firstName",
  searchable: true,
});

/**
 * GET /api/v1/crm/contacts
 * List contacts with filters, sorting, and pagination.
 * Permission: contacts.read
 */
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("contacts.read");

  const parsed = parse(new URL(request.url).searchParams);

  const service = new ContactService(
    context.organization._id,
    context.user._id,
  );

  const filters = {
    status: parsed.filters.status,
    companyId:
      parsed.filters.companyId === "null"
        ? null
        : parsed.filters.companyId
          ? new Types.ObjectId(parsed.filters.companyId)
          : undefined,
    ownerId: parsed.filters.ownerId
      ? new Types.ObjectId(parsed.filters.ownerId)
      : undefined,
    tagIds: parsed.filters.tag.map((id: string) => new Types.ObjectId(id)),
    q: parsed.q,
    createdFrom: parsed.filters.createdFrom
      ? new Date(parsed.filters.createdFrom)
      : undefined,
    createdTo: parsed.filters.createdTo
      ? new Date(parsed.filters.createdTo)
      : undefined,
    hasEmail: parsed.filters.hasEmail,
  };

  const result = await service.list(filters, {
    sort: serializeSort(parsed.sort),
    page: parsed.page,
    pageSize: parsed.pageSize,
  });

  return ok(result.items, meta(parsed, result.total));
});

/**
 * POST /api/v1/crm/contacts
 * Create a new contact.
 * Permission: contacts.create
 */
export const POST = withApi(
  async (request: Request) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("contacts.create");

    const body = await readJson(request);
    const input = createContactSchema.parse(body);

    const service = new ContactService(
      context.organization._id,
      context.user._id,
    );

    try {
      const createInput: CreateContactInput = {
        organizationId: context.organization._id,
        actorId: context.user._id,
        firstName: input.firstName,
        lastName: input.lastName,
        // Create records absence as "not supplied" rather than as an empty
        // value, so an explicit null in the body becomes undefined here.
        salutation: input.salutation ?? undefined,
        jobTitle: input.jobTitle ?? undefined,
        companyId: input.companyId
          ? new Types.ObjectId(input.companyId)
          : undefined,
        ownerId: new Types.ObjectId(input.ownerId),
        emails: input.emails,
        phones: input.phones,
        status: input.status,
        tags: input.tags.map((id) => new Types.ObjectId(id)),
        notes: input.notes ?? undefined,
        customFields: input.customFields,
      };

      const contact = await service.create(createInput);

      return ok(contact);
    } catch (error) {
      // The only conflict the service raises is a second contact claiming an
      // address that is already some contact's primary one, so the response
      // names the address rather than a generic resource clash.
      if (error instanceof ContactError && error.code === "CONFLICT") {
        throw new AppError("EMAIL_ALREADY_REGISTERED", {
          message: error.message,
        });
      }
      if (error instanceof ContactError && error.code === "VALIDATION_FAILED") {
        throw new AppError("VALIDATION_FAILED", { message: error.message });
      }
      throw error;
    }
  },
  { status: 201 },
);
