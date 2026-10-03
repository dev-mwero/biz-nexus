import { Types } from "mongoose";
import { z } from "zod";
import {
  deleteTask,
  findTaskById,
  type UpdateTaskInput,
  updateTask,
} from "@/modules/tasks";
import { readJson, withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";
import { objectIdParam } from "../../../_lib/path-param";
import { fieldDetails } from "../../../_lib/zod-details";

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
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const GET = withApi(async (request) => {
  const guards = guardsFor(request);
  const { organization } = await guards.requirePermission("tasks.read");

  const id = objectIdParam(request);

  const task = await findTaskById(organization._id, id);
  if (!task) {
    throw new AppError("RECORD_NOT_FOUND", { message: "Task not found" });
  }

  return ok(task);
});

export const PATCH = withApi(async (request) => {
  const guards = guardsFor(request);
  const { organization, user } = await guards.requirePermission("tasks.update");

  const id = objectIdParam(request);

  const body = await readJson(request);
  const parsed = updateTaskSchema.safeParse(body);
  if (!parsed.success) {
    throw AppError.validation(fieldDetails(parsed.error));
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

  const task = await updateTask(organization._id, id, input);
  if (!task) {
    throw new AppError("RECORD_NOT_FOUND", { message: "Task not found" });
  }

  return ok(task);
});

export const DELETE = withApi(async (request) => {
  const guards = guardsFor(request);
  const { organization, user } = await guards.requirePermission("tasks.delete");

  const id = objectIdParam(request);

  const deleted = await deleteTask(organization._id, id, user._id);
  if (!deleted) {
    throw new AppError("RECORD_NOT_FOUND", { message: "Task not found" });
  }

  return ok({ success: true });
});
