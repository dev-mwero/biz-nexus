import { Types } from "mongoose";
import { z } from "zod";
import { isPermission } from "@/modules/rbac/permissions";
import {
  type CreateTaskInput,
  createTask,
  deleteTask,
  findTaskById,
  listTasks,
  type TaskListFilters,
  type UpdateTaskInput,
  updateTask,
} from "@/modules/tasks";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { listQuery } from "@/shared/query/list-query";
import { fail, ok } from "@/shared/responses/envelope";

const createTaskSchema = z.object({
  title: z.string().min(1).max(255),
  description: z.string().max(10000).nullable().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "DONE"]).default("TODO"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  dueAt: z
    .union([z.iso.datetime({ offset: true }), z.iso.date()])
    .nullable()
    .optional(),
  assigneeId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .nullable()
    .optional(),
  related: z
    .array(
      z.object({
        entityType: z.string().min(1),
        entityId: z.string().regex(/^[0-9a-fA-F]{24}$/),
      }),
    )
    .default([]),
  metadata: z.record(z.unknown()).optional(),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  description: z.string().max(10000).nullable().optional(),
  status: z.enum(["TODO", "IN_PROGRESS", "DONE"]).optional(),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).optional(),
  dueAt: z
    .union([z.iso.datetime({ offset: true }), z.iso.date()])
    .nullable()
    .optional(),
  assigneeId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .nullable()
    .optional(),
  related: z
    .array(
      z.object({
        entityType: z.string().min(1),
        entityId: z.string().regex(/^[0-9a-fA-F]{24}$/),
      }),
    )
    .optional(),
  metadata: z.record(z.unknown()).optional(),
});

const taskFiltersSchema = z.object({
  status: z
    .union([
      z.enum(["TODO", "IN_PROGRESS", "DONE"]),
      z.array(z.enum(["TODO", "IN_PROGRESS", "DONE"])),
    ])
    .optional(),
  priority: z
    .union([
      z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]),
      z.array(z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"])),
    ])
    .optional(),
  assigneeId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  relatedEntityType: z.string().optional(),
  relatedEntityId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  dueBefore: z
    .union([z.iso.datetime({ offset: true }), z.iso.date()])
    .optional(),
  dueAfter: z
    .union([z.iso.datetime({ offset: true }), z.iso.date()])
    .optional(),
  search: z.string().optional(),
});

const { parse, meta } = listQuery<z.infer<typeof taskFiltersSchema>>({
  filters: taskFiltersSchema,
  sortable: ["createdAt", "updatedAt", "dueAt", "priority", "status", "title"],
  defaultSort: "-createdAt",
  searchable: true,
  orderedPairs: [["dueAfter", "dueBefore"]],
});

export const GET = withApi(async (request) => {
  const guards = guardsFor(request);
  const { organization, membership } =
    await guards.requirePermission("tasks.read");

  const query = parse(request.nextUrl.searchParams);
  const filters: TaskListFilters = {
    ...query.filters,
    ...(query.filters.assigneeId
      ? { assigneeId: new Types.ObjectId(query.filters.assigneeId) }
      : {}),
    ...(query.filters.relatedEntityId
      ? { relatedEntityId: new Types.ObjectId(query.filters.relatedEntityId) }
      : {}),
    ...(query.filters.dueBefore ? { dueBefore: query.filters.dueBefore } : {}),
    ...(query.filters.dueAfter ? { dueAfter: query.filters.dueAfter } : {}),
  };

  const { tasks, total } = await listTasks(organization._id, filters, {
    skip: query.skip,
    limit: query.limit,
    sort: query.sort,
  });

  return ok(tasks, meta(query, total));
});

export const POST = withApi(
  async (request) => {
    const guards = guardsFor(request);
    const { organization, user } =
      await guards.requirePermission("tasks.create");

    const body = await request.json();
    const parsed = createTaskSchema.safeParse(body);
    if (!parsed.success) {
      return fail({
        code: "VALIDATION_FAILED",
        message: "Invalid request body",
        details: parsed.error.flatten().fieldErrors,
      });
    }

    const data = parsed.data;
    const input: CreateTaskInput = {
      organizationId: organization._id,
      title: data.title,
      description: data.description ?? null,
      status: data.status,
      priority: data.priority,
      dueAt: data.dueAt ? new Date(data.dueAt) : null,
      assigneeId: data.assigneeId ? new Types.ObjectId(data.assigneeId) : null,
      related: data.related.map((r) => ({
        entityType: r.entityType,
        entityId: new Types.ObjectId(r.entityId),
      })),
      createdBy: user._id,
      metadata: data.metadata ?? {},
    };

    const task = await createTask(input);
    return ok(task, undefined, { status: 201 });
  },
  { status: 201 },
);
