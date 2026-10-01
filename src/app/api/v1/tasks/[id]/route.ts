import { Types } from "mongoose";
import { z } from "zod";
import {
  deleteTask,
  findTaskById,
  type UpdateTaskInput,
  updateTask,
} from "@/modules/tasks";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { fail, ok } from "@/shared/responses/envelope";

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

export const GET = withApi(async (request, { requestId }) => {
  const guards = guardsFor(request);
  const { organization } = await guards.requirePermission("tasks.read");

  const id = request.nextUrl.pathname.split("/").pop();
  if (!id || !Types.ObjectId.isValid(id)) {
    return fail(
      { code: "VALIDATION_FAILED", message: "Invalid task ID" },
      requestId,
    );
  }

  const task = await findTaskById(organization._id, new Types.ObjectId(id));
  if (!task) {
    return fail(
      { code: "RECORD_NOT_FOUND", message: "Task not found" },
      requestId,
    );
  }

  return ok(task);
});

export const PATCH = withApi(async (request, { requestId }) => {
  const guards = guardsFor(request);
  const { organization, user } = await guards.requirePermission("tasks.update");

  const id = request.nextUrl.pathname.split("/").pop();
  if (!id || !Types.ObjectId.isValid(id)) {
    return fail(
      { code: "VALIDATION_FAILED", message: "Invalid task ID" },
      requestId,
    );
  }

  const body = await request.json();
  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) {
    return fail(
      {
        code: "VALIDATION_FAILED",
        message: "Invalid request body",
        details: parsed.error.flatten().fieldErrors,
      },
      requestId,
    );
  }

  const data = parsed.data;
  const input: UpdateTaskInput = {
    ...(data.title !== undefined ? { title: data.title } : {}),
    ...(data.description !== undefined
      ? { description: data.description }
      : {}),
    ...(data.status !== undefined ? { status: data.status } : {}),
    ...(data.priority !== undefined ? { priority: data.priority } : {}),
    ...(data.dueAt !== undefined
      ? { dueAt: data.dueAt ? new Date(data.dueAt) : null }
      : {}),
    ...(data.assigneeId !== undefined
      ? {
          assigneeId: data.assigneeId
            ? new Types.ObjectId(data.assigneeId)
            : null,
        }
      : {}),
    ...(data.related !== undefined
      ? {
          related: data.related.map((r) => ({
            entityType: r.entityType,
            entityId: new Types.ObjectId(r.entityId),
          })),
        }
      : {}),
    updatedBy: user._id,
    metadata: data.metadata ?? {},
  };

  const task = await updateTask(
    organization._id,
    new Types.ObjectId(id),
    input,
  );
  if (!task) {
    return fail(
      { code: "RECORD_NOT_FOUND", message: "Task not found" },
      requestId,
    );
  }

  return ok(task);
});

export const DELETE = withApi(async (request, { requestId }) => {
  const guards = guardsFor(request);
  const { organization, user } = await guards.requirePermission("tasks.delete");

  const id = request.nextUrl.pathname.split("/").pop();
  if (!id || !Types.ObjectId.isValid(id)) {
    return fail(
      { code: "VALIDATION_FAILED", message: "Invalid task ID" },
      requestId,
    );
  }

  const deleted = await deleteTask(
    organization._id,
    new Types.ObjectId(id),
    user._id,
  );
  if (!deleted) {
    return fail(
      { code: "RECORD_NOT_FOUND", message: "Task not found" },
      requestId,
    );
  }

  return ok({ success: true });
});
