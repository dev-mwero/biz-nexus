import type { Types } from "mongoose";
import {
  type Task,
  TaskModel,
  type TaskPriority,
  type TaskStatus,
} from "@/modules/tasks/task.model";

/**
 * Task repository.
 *
 * Thin wrapper around the model so the service does not call Mongoose directly.
 * All queries are org-scoped by design.
 */

export interface TaskRepositoryFilters {
  status?: TaskStatus | TaskStatus[];
  priority?: TaskPriority | TaskPriority[];
  assigneeId?: Types.ObjectId;
  relatedEntityType?: string;
  relatedEntityId?: Types.ObjectId;
  dueBefore?: Date;
  dueAfter?: Date;
  search?: string;
}

export interface TaskListOptions {
  skip: number;
  limit: number;
  sort: Record<string, 1 | -1>;
}

/**
 * Find a task by ID within an organization.
 */
export async function findById(
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

/**
 * List tasks with filters, pagination, and sorting.
 */
export async function list(
  organizationId: Types.ObjectId,
  filters: TaskRepositoryFilters,
  options: TaskListOptions,
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

/**
 * Get tasks by assignee.
 */
export async function findByAssignee(
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

/**
 * Get overdue tasks.
 */
export async function findOverdue(
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

/**
 * Create a new task.
 */
export async function create(input: {
  organizationId: Types.ObjectId;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: Date | null;
  assigneeId: Types.ObjectId | null;
  related: Array<{ entityType: string; entityId: Types.ObjectId }>;
  completedAt: Date | null;
  completedById: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  updatedBy: Types.ObjectId;
  metadata: Record<string, unknown>;
}): Promise<Task> {
  const [created] = await TaskModel.create([input]);
  return created;
}

/**
 * Update a task.
 */
export async function update(
  organizationId: Types.ObjectId,
  taskId: Types.ObjectId,
  update: Record<string, unknown>,
): Promise<Task | null> {
  return TaskModel.findOneAndUpdate(
    { _id: taskId, organizationId, deletedAt: null },
    { $set: update },
    { new: true },
  )
    .lean<Task>()
    .exec();
}

/**
 * Soft delete a task.
 */
export async function softDelete(
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

/**
 * Count tasks by status for board view.
 */
export async function countByStatus(
  organizationId: Types.ObjectId,
  filters: Omit<TaskRepositoryFilters, "status"> = {},
): Promise<Record<TaskStatus, number>> {
  const baseQuery: Record<string, unknown> = {
    organizationId,
    deletedAt: null,
  };

  if (filters.assigneeId) baseQuery.assigneeId = filters.assigneeId;
  if (filters.relatedEntityType && filters.relatedEntityId) {
    baseQuery.$and = [
      { "related.entityType": filters.relatedEntityType },
      { "related.entityId": filters.relatedEntityId },
    ];
  }

  const [todo, inProgress, done] = await Promise.all([
    TaskModel.countDocuments({ ...baseQuery, status: "TODO" }).exec(),
    TaskModel.countDocuments({ ...baseQuery, status: "IN_PROGRESS" }).exec(),
    TaskModel.countDocuments({ ...baseQuery, status: "DONE" }).exec(),
  ]);

  return { TODO: todo, IN_PROGRESS: inProgress, DONE: done };
}
