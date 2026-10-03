import { Types } from "mongoose";
import { z } from "zod";
import {
  organizationFeed,
  type RecordActivityInput,
  recordActivity,
  timelineForEntity,
} from "@/modules/activities";
import {
  CompanyRepository,
  ContactRepository,
  LeadRepository,
} from "@/modules/crm";
import { DealRepository } from "@/modules/deals/deal.repository";
import { findById as findTaskById } from "@/modules/tasks";
import { readJson, withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { listQuery } from "@/shared/query/list-query";
import { ok } from "@/shared/responses/envelope";
import { fieldDetails } from "../../_lib/zod-details";

/**
 * The record types an activity may be attached to.
 *
 * Lowercase because that is what the event subscribers write (`deal`, `task`)
 * and what the composer sends. Accepting any string meant an unknown type was
 * stored and then never matched by a per-record timeline.
 */
const SUBJECT_ENTITY_TYPES = [
  "contact",
  "company",
  "lead",
  "deal",
  "task",
] as const;

const activityFiltersSchema = z.object({
  entityType: z.string().optional(),
  entityId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  type: z
    .enum([
      "NOTE",
      "TASK",
      "CALL",
      "MEETING",
      "SYSTEM_EVENT",
      "STAGE_CHANGE",
      "EMAIL",
      "SMS",
      "WHATSAPP",
    ])
    .optional(),
  actorId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  ownerId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  before: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
});

// The generic is inferred from `filters`, so it must not be written out: the
// parameter is the schema's raw *shape*, and `z.infer` is the parsed *output*.
// Naming the output there is what makes the shape constraint fail to hold.
const { parse, meta } = listQuery({
  filters: activityFiltersSchema,
  sortable: ["occurredAt"],
  defaultSort: "-occurredAt",
  searchable: false,
});

const createActivitySchema = z.object({
  entityType: z.enum(SUBJECT_ENTITY_TYPES),
  entityId: z.string().regex(/^[0-9a-fA-F]{24}$/),
  type: z.enum(["NOTE", "CALL", "MEETING"]),
  title: z.string().min(1).max(255),
  body: z.string().max(10000).nullable().optional(),
  direction: z.enum(["INBOUND", "OUTBOUND"]).nullable().optional(),
  durationSeconds: z.number().int().min(0).nullable().optional(),
  occurredAt: z
    .union([z.iso.datetime({ offset: true }), z.iso.date()])
    .optional(),
});

/**
 * Whether `entityId` names a record of `entityType` that this organisation owns.
 *
 * Activities carry free-form `subjects` so one row can sit on several records,
 * and the id was written straight through without a lookup. That let a caller
 * attach an activity to an id from another tenant — the row is only ever read
 * back by id, so it surfaces as a timeline on somebody else's record. Every
 * lookup below goes through a tenant-scoped repository, so a foreign or
 * soft-deleted id returns false.
 */
async function subjectExists(
  organizationId: Types.ObjectId,
  actorId: Types.ObjectId,
  entityType: (typeof SUBJECT_ENTITY_TYPES)[number],
  entityId: Types.ObjectId,
): Promise<boolean> {
  switch (entityType) {
    case "contact":
      return new ContactRepository(organizationId, actorId).exists({
        _id: entityId,
      });
    case "company":
      return new CompanyRepository(organizationId, actorId).exists({
        _id: entityId,
      });
    case "lead":
      return new LeadRepository(organizationId, actorId).exists({
        _id: entityId,
      });
    case "deal":
      return new DealRepository(organizationId, actorId).exists({
        _id: entityId,
      });
    case "task":
      return (await findTaskById(organizationId, entityId)) !== null;
  }
}

export const GET = withApi(async (request) => {
  const guards = guardsFor(request);
  const { organization } = await guards.requirePermission("activities.read");

  const query = parse(new URL(request.url).searchParams);
  const filters = query.filters;

  const before = filters.before ? new Date(filters.before) : undefined;
  const entityId = filters.entityId
    ? new Types.ObjectId(filters.entityId)
    : undefined;

  const activities =
    filters.entityType && entityId
      ? await timelineForEntity({
          organizationId: organization._id,
          entityId,
          limit: query.limit,
          before,
        })
      : await organizationFeed({
          organizationId: organization._id,
          limit: query.limit,
          before,
        });

  // Apply additional filters in-memory for the entity timeline
  // (In production, these would be pushed to the query level)
  let filtered = activities;
  if (filters.type) {
    const type = filters.type;
    filtered = filtered.filter((a) => a.type === type);
  }

  const actorId = filters.actorId
    ? new Types.ObjectId(filters.actorId)
    : undefined;
  if (actorId) {
    filtered = filtered.filter((a) => a.actorId?.equals(actorId));
  }

  const ownerId = filters.ownerId
    ? new Types.ObjectId(filters.ownerId)
    : undefined;
  if (ownerId) {
    filtered = filtered.filter((a) => a.ownerId.equals(ownerId));
  }

  // For paginated response, we return the filtered results
  // Total count would require a separate query; for now we return the page
  return ok(filtered, meta(query, filtered.length));
});

export const POST = withApi(
  async (request) => {
    const guards = guardsFor(request);
    const { organization, user } =
      await guards.requirePermission("activities.create");

    const body = await readJson(request);
    const parsed = createActivitySchema.safeParse(body);
    if (!parsed.success) {
      throw AppError.validation(fieldDetails(parsed.error));
    }

    const data = parsed.data;

    const subjectId = new Types.ObjectId(data.entityId);
    const subjectFound = await subjectExists(
      organization._id,
      user._id,
      data.entityType,
      subjectId,
    );
    if (!subjectFound) {
      throw AppError.validation([
        {
          path: "entityId",
          message:
            "No matching record of that type in this organisation, or you cannot read it.",
        },
      ]);
    }

    const input: RecordActivityInput = {
      organizationId: organization._id,
      type: data.type,
      title: data.title,
      body: data.body ?? null,
      direction: data.direction ?? null,
      durationSeconds: data.durationSeconds ?? null,
      occurredAt: data.occurredAt ? new Date(data.occurredAt) : new Date(),
      actorId: user._id,
      ownerId: user._id,
      subjects: [
        {
          entityType: data.entityType,
          entityId: subjectId,
        },
      ],
      metadata: {},
    };

    const activity = await recordActivity(input);
    return ok(activity);
  },
  { status: 201 },
);
