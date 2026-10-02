import type { Types } from "mongoose";
import {
  TASK_STATUSES,
  type Task,
  TaskModel,
  type TaskRelated,
  type TaskStatus,
} from "@/modules/tasks/task.model";
import { events } from "@/shared/events/bus";
import { redact } from "@/shared/lib/redact";

/**
 * Task service.
 *
 * All writes go through this module so status transitions, assignments,
 * and completions are consistent and emit the right events.
 */

export interface CreateTaskInput {
  organizationId: Types.ObjectId;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  dueAt?: Date | null;
  assigneeId?: Types.ObjectId | null;
  related?: TaskRelated[];
  createdBy: Types.ObjectId;
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: "LOW" | "MEDIUM" | "HIGH" | "URGENT";
  dueAt?: Date | null;
  assigneeId?: Types.ObjectId | null;
  related?: TaskRelated[];
  updatedBy: Types.ObjectId;
  metadata?: Record<string, unknown>;
}

export interface TaskListFilters {
  status?: TaskStatus | TaskStatus[];
  priority?:
    | "LOW"
    | "MEDIUM"
    | "HIGH"
    | "URGENT"
    | ("LOW" | "MEDIUM" | "HIGH" | "URGENT")[];
  assigneeId?: Types.ObjectId;
  relatedEntityType?: string;
  relatedEntityId?: Types.ObjectId;
  dueBefore?: Date;
  dueAfter?: Date;
  search?: string;
}

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  TODO: ["IN_PROGRESS", "DONE"],
  IN_PROGRESS: ["TODO", "DONE"],
  DONE: ["TODO", "IN_PROGRESS"],
};

/** Emit a task event. */
async function emitTaskEvent(
  eventName: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await events.emit(eventName as never, payload as never);
}

export async function createTask(input: CreateTaskInput): Promise<Task> {
  const {
    organizationId,
    title,
    description = null,
    status = "TODO",
    priority = "MEDIUM",
    dueAt = null,
    assigneeId = null,
    related = [],
    createdBy,
    metadata = {},
  } = input;

  if (!TASK_STATUSES.includes(status)) {
    throw new Error(`Invalid status: ${status}`);
  }

  const [created] = await TaskModel.create([
    {
      organizationId,
      title: title.trim(),
      description,
      status,
      priority,
      dueAt,
      assigneeId,
      related,
      completedAt: status === "DONE" ? new Date() : null,
      completedById: status === "DONE" ? createdBy : null,
      createdBy,
      updatedBy: createdBy,
      metadata: redact(metadata) as Record<string, unknown>,
    },
  ]);

  // Emit event for assignment if assigned
  if (assigneeId) {
    await emitTaskEvent("task.assigned", {
      organizationId,
      taskId: created._id,
      taskTitle: created.title,
      assigneeId,
      assignedBy: createdBy,
    });
  }

  return created;
}

export async function findTaskById(
  organizationId: Types.ObjectId,
  taskId: Types.ObjectId,
): Promise<Task | null> {
  return TaskModel.findOne({
    _id: taskId,
    organizationId,
    deletedAt: null,
  })
    .lean<Task>()
    .exec();
}

export async function updateTask(
  organizationId: Types.ObjectId,
  taskId: Types.ObjectId,
  input: UpdateTaskInput,
): Promise<Task | null> {
  const task = await TaskModel.findOne({
    _id: taskId,
    organizationId,
    deletedAt: null,
  });

  if (!task) return null;

  const {
    title,
    description,
    status,
    priority,
    dueAt,
    assigneeId,
    related,
    updatedBy,
    metadata = {},
  } = input;

  const wasAssigned = task.assigneeId !== null;
  const wasDone = task.status === "DONE";

  // Validate status transition
  if (status && status !== task.status) {
    const allowed = VALID_TRANSITIONS[task.status];
    if (!allowed.includes(status)) {
      throw new Error(
        `Invalid status transition from ${task.status} to ${status}`,
      );
    }
  }

  const now = new Date();
  const newStatus = status ?? task.status;

  // Prepare update
  const update: Record<string, unknown> = {
    updatedBy,
    updatedAt: now,
    metadata: redact({ ...task.metadata, ...metadata }) as Record<
      string,
      unknown
    >,
  };

  if (title !== undefined) update.title = title.trim();
  if (description !== undefined) update.description = description;
  if (status !== undefined) update.status = newStatus;
  if (priority !== undefined) update.priority = priority;
  if (dueAt !== undefined) update.dueAt = dueAt;
  if (assigneeId !== undefined) update.assigneeId = assigneeId;
  if (related !== undefined) update.related = related;

  // Handle completion
  if (newStatus === "DONE" && !wasDone) {
    update.completedAt = now;
    update.completedById = updatedBy;
  } else if (newStatus !== "DONE" && wasDone) {
    update.completedAt = null;
    update.completedById = null;
  }

  const updated = await TaskModel.findOneAndUpdate(
    { _id: taskId, organizationId, deletedAt: null },
    { $set: update },
    { new: true },
  )
    .lean<Task>()
    .exec();

  if (!updated) return null;

  // Emit events
  if (assigneeId !== undefined && assigneeId !== task.assigneeId) {
    if (assigneeId) {
      await emitTaskEvent("task.assigned", {
        organizationId,
        taskId: updated._id,
        taskTitle: updated.title,
        assigneeId,
        assignedBy: updatedBy,
      });
    } else if (wasAssigned) {
      await emitTaskEvent("task.unassigned", {
        organizationId,
        taskId: updated._id,
        taskTitle: updated.title,
        previousAssigneeId: task.assigneeId,
        unassignedBy: updatedBy,
      });
    }
  }

  if (newStatus === "DONE" && !wasDone) {
    await emitTaskEvent("task.completed", {
      organizationId,
      taskId: updated._id,
      taskTitle: updated.title,
      completedBy: updatedBy,
      assigneeId: updated.assigneeId,
      related: updated.related,
    });
  } else if (newStatus !== "DONE" && wasDone) {
    await emitTaskEvent("task.reopened", {
      organizationId,
      taskId: updated._id,
      taskTitle: updated.title,
      reopenedBy: updatedBy,
    });
  }

  return updated;
}

export async function deleteTask(
  organizationId: Types.ObjectId,
  taskId: Types.ObjectId,
  deletedBy: Types.ObjectId,
): Promise<boolean> {
  const result = await TaskModel.updateOne(
    { _id: taskId, organizationId, deletedAt: null },
    { $set: { deletedAt: new Date(), updatedBy: deletedBy } },
  );
  return result.modifiedCount === 1;
}

export async function listTasks(
  organizationId: Types.ObjectId,
  filters: TaskListFilters,
  options: { skip: number; limit: number; sort: Record<string, 1 | -1> },
): Promise<{ tasks: Task[]; total: number }> {
  const query: Record<string, unknown> = {
    organizationId,
    deletedAt: null,
  };

  if (filters.status) {
    const statuses = Array.isArray(filters.status)
      ? filters.status
      : [filters.status];
    query.status = { $in: statuses };
  }

  if (filters.priority) {
    const priorities = Array.isArray(filters.priority)
      ? filters.priority
      : [filters.priority];
    query.priority = { $in: priorities };
  }

  if (filters.assigneeId) {
    query.assigneeId = filters.assigneeId;
  }

  if (filters.relatedEntityType && filters.relatedEntityId) {
    query.$and = [
      { "related.entityType": filters.relatedEntityType },
      { "related.entityId": filters.relatedEntityId },
    ];
  }

  if (filters.dueBefore || filters.dueAfter) {
    query.dueAt = {};
    if (filters.dueBefore)
      (query.dueAt as Record<string, Date>).$lte = filters.dueBefore;
    if (filters.dueAfter)
      (query.dueAt as Record<string, Date>).$gte = filters.dueAfter;
  }

  if (filters.search) {
    query.$text = { $search: filters.search };
  }

  const [tasks, total] = await Promise.all([
    TaskModel.find(query)
      .sort(options.sort)
      .skip(options.skip)
      .limit(options.limit)
      .lean<Task[]>()
      .exec(),
    TaskModel.countDocuments(query).exec(),
  ]);

  return { tasks, total };
}

export async function getTasksByAssignee(
  organizationId: Types.ObjectId,
  assigneeId: Types.ObjectId,
  status?: TaskStatus,
): Promise<Task[]> {
  const query: Record<string, unknown> = {
    organizationId,
    assigneeId,
    deletedAt: null,
  };
  if (status) query.status = status;

  return TaskModel.find(query)
    .sort({ dueAt: 1, createdAt: -1 })
    .lean<Task[]>()
    .exec();
}

export async function getOverdueTasks(
  organizationId: Types.ObjectId,
  assigneeId?: Types.ObjectId,
): Promise<Task[]> {
  const query: Record<string, unknown> = {
    organizationId,
    status: { $in: ["TODO", "IN_PROGRESS"] },
    dueAt: { $lt: new Date(), $ne: null },
    deletedAt: null,
  };
  if (assigneeId) query.assigneeId = assigneeId;

  return TaskModel.find(query).sort({ dueAt: 1 }).lean<Task[]>().exec();
}

export async function completeTask(
  organizationId: Types.ObjectId,
  taskId: Types.ObjectId,
  completedBy: Types.ObjectId,
): Promise<Task | null> {
  return updateTask(organizationId, taskId, {
    status: "DONE",
    updatedBy: completedBy,
  });
}

export async function reopenTask(
  organizationId: Types.ObjectId,
  taskId: Types.ObjectId,
  reopenedBy: Types.ObjectId,
): Promise<Task | null> {
  return updateTask(organizationId, taskId, {
    status: "TODO",
    updatedBy: reopenedBy,
  });
}
