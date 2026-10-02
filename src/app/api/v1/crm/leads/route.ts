import { Types } from "mongoose";
import { z } from "zod";
import { LeadError, LeadService } from "@/modules/crm";
import { queryFromSearchParams } from "@/shared/api/search-params";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok, pageMeta } from "@/shared/responses/envelope";

const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "UNQUALIFIED",
  "CONVERTED",
  "LOST",
] as const;

const contactSnapshotSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  // Required, and required *here* rather than left to the database. The schema
  // marks it `required: true`, so an optional field in this Zod object passes
  // validation and then fails on insert as an unhandled `ValidationError` — a
  // 500 for a request that is simply missing something the client can be told
  // about. The snapshot is the lead's only record of the person it came from,
  // and conversion needs an address to make a contact from.
  email: z.string().email(),
  phone: z.string().max(50).optional().nullable(),
  companyName: z.string().max(160).optional().nullable(),
});

const createLeadSchema = z.object({
  title: z.string().min(1).max(200),
  contactId: z.string().optional().nullable(),
  contactSnapshot: contactSnapshotSchema,
  companyId: z.string().optional().nullable(),
  source: z.string().min(1).max(100),
  status: z.enum(LEAD_STATUSES).default("NEW"),
  score: z.number().int().min(0).max(100).default(0),
  ownerId: z.string().min(1),
  tags: z.array(z.string()).default([]),
  notes: z.string().max(2000).optional().nullable(),
  customFields: z.record(z.string(), z.unknown()).default({}),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sort: z.string().default("-createdAt"),
  status: z.enum(LEAD_STATUSES).optional(),
  source: z.string().optional(),
  ownerId: z.string().optional(),
  scoreMin: z.coerce.number().int().min(0).max(100).optional(),
  scoreMax: z.coerce.number().int().min(0).max(100).optional(),
  q: z.string().max(200).optional(),
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
});

/**
 * GET /api/v1/crm/leads
 * List leads with filters, sorting, and pagination.
 * Permission: leads.read
 */
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("leads.read");

  const { searchParams } = new URL(request.url);
  const query = listQuerySchema.parse(queryFromSearchParams(searchParams, []));

  const service = new LeadService(context.organization._id, context.user._id);

  const filters = {
    status: query.status,
    source: query.source,
    ownerId: query.ownerId ? new Types.ObjectId(query.ownerId) : undefined,
    scoreMin: query.scoreMin,
    scoreMax: query.scoreMax,
    q: query.q,
    createdFrom: query.createdFrom ? new Date(query.createdFrom) : undefined,
    createdTo: query.createdTo ? new Date(query.createdTo) : undefined,
  };

  const result = await service.list(filters, {
    sort: query.sort,
    page: query.page,
    pageSize: query.pageSize,
  });

  return ok(
    result.items,
    pageMeta({
      page: query.page,
      pageSize: query.pageSize,
      total: result.total,
    }),
  );
});

/**
 * POST /api/v1/crm/leads
 * Create a new lead.
 * Permission: leads.create
 */
export const POST = withApi(
  async (request: Request) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("leads.create");

    const body = await request.json();
    const input = createLeadSchema.parse(body);

    const service = new LeadService(context.organization._id, context.user._id);

    try {
      const lead = await service.create({
        organizationId: context.organization._id,
        actorId: context.user._id,
        title: input.title,
        contactId: input.contactId
          ? new Types.ObjectId(input.contactId)
          : undefined,
        contactSnapshot: input.contactSnapshot,
        companyId: input.companyId
          ? new Types.ObjectId(input.companyId)
          : undefined,
        source: input.source,
        status: input.status,
        score: input.score,
        ownerId: new Types.ObjectId(input.ownerId),
        tags: input.tags.map((id) => new Types.ObjectId(id)),
        // Create treats an absent optional field as "not supplied"; an explicit
        // null in the body is the same absence.
        notes: input.notes ?? undefined,
        customFields: input.customFields,
      });

      return ok(lead);
    } catch (error) {
      if (error instanceof LeadError && error.code === "VALIDATION_FAILED") {
        throw new AppError("VALIDATION_FAILED", { message: error.message });
      }
      throw error;
    }
  },
  { status: 201 },
);
