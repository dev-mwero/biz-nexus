import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "./task.constants";

export {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "./task.constants";

/**
 * A task assigned to a member of the organization.
 *
 * Per docs/DATABASE.md §7 — the tasks collection carries a multikey index on
 * `related` so a task linked to a contact, company, or deal appears on all of
 * their timelines without a join.
 */

/** A record this task relates to. More than one, legitimately. */
export interface TaskRelated {
  entityType: string;
  entityId: Types.ObjectId;
}

export interface Task extends AuditFields, SoftDeleteFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  /** When the task is due. Null = no due date. */
  dueAt: Date | null;
  /** Who is responsible. Null = unassigned. */
  assigneeId: Types.ObjectId | null;
  /** What this task is about. Zero or more. */
  related: TaskRelated[];
  /** Completion timestamp. Null until done. */
  completedAt: Date | null;
  /** Who completed it. Null until done. */
  completedById: Types.ObjectId | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const relatedSchema = new Schema<TaskRelated>(
  {
    entityType: { type: String, required: true },
    entityId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
  },
  { _id: false },
);

const taskSchema = new Schema<Task>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Organization",
    },
    title: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 255,
      trim: true,
    },
    description: { type: String, default: null },
    status: {
      type: String,
      required: true,
      enum: TASK_STATUSES,
      default: "TODO",
    },
    priority: {
      type: String,
      required: true,
      enum: TASK_PRIORITIES,
      default: "MEDIUM",
    },
    dueAt: { type: Date, default: null },
    assigneeId: {
      type: Schema.Types.ObjectId,
      default: null,
      ref: "User",
    },
    related: { type: [relatedSchema], default: () => [] },
    completedAt: { type: Date, default: null },
    completedById: {
      type: Schema.Types.ObjectId,
      default: null,
      ref: "User",
    },
    metadata: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  {
    timestamps: true,
    collection: "tasks",
  },
);

taskSchema.plugin(auditFields());
taskSchema.plugin(softDelete({ scopeField: "organizationId" }));

// Indexes per docs/DATABASE.md §7
taskSchema.index({ organizationId: 1, status: 1, dueAt: 1 });
taskSchema.index({ organizationId: 1, assigneeId: 1, status: 1 });
// MongoDB permits one text index per collection. The task list, the task
// service and global search all issue `$text` queries scoped to the tenant,
// so the text fields ride along with `organizationId` to keep that scope
// index-backed rather than a collection scan followed by a filter.
taskSchema.index({ organizationId: 1, title: "text", description: "text" });
// Multikey index on related for the "tasks about X" query
taskSchema.index({
  organizationId: 1,
  "related.entityType": 1,
  "related.entityId": 1,
});
taskSchema.index({ organizationId: 1, createdAt: -1 });

export const TaskModel: Model<Task> =
  (mongoose.models.Task as Model<Task>) ??
  mongoose.model<Task>("Task", taskSchema);

export const taskSchemaDefinition = taskSchema;
