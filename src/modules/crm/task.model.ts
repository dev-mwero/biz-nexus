import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";

/**
 * A task in the CRM.
 *
 * Per docs/DATABASE.md §7.
 */
export const TASK_STATUSES = [
  "TODO",
  "IN_PROGRESS",
  "DONE",
  "CANCELED",
] as const;

export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;

export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface TaskRelated {
  entityType: string;
  entityId: Types.ObjectId;
}

export interface TaskReminder {
  remindAt: Date;
  sentAt?: Date | null;
}

export interface Task extends AuditFields, SoftDeleteFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  title: string;
  description?: string | null;
  assigneeId?: Types.ObjectId | null;
  createdBy: Types.ObjectId;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt?: Date | null;
  completedAt?: Date | null;
  related: TaskRelated[];
  reminders: TaskReminder[];
  estimatedMinutes?: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const relatedSchema = new Schema<TaskRelated>(
  {
    entityType: { type: String, required: true, trim: true },
    entityId: { type: Schema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const reminderSchema = new Schema<TaskReminder>(
  {
    remindAt: { type: Date, required: true },
    sentAt: { type: Date, default: null },
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
      maxlength: 200,
      trim: true,
    },
    description: { type: String, maxlength: 2000, trim: true, default: null },
    assigneeId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
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
    completedAt: { type: Date, default: null },
    related: { type: [relatedSchema], default: () => [] },
    reminders: { type: [reminderSchema], default: () => [] },
    estimatedMinutes: { type: Number, min: 1, default: null },
  },
  { timestamps: true, collection: "tasks" },
);

taskSchema.plugin(auditFields());
taskSchema.plugin(softDelete({ scopeField: "organizationId" }));

taskSchema.index({ organizationId: 1, title: "text", description: "text" });
taskSchema.index({ organizationId: 1, status: 1, dueAt: 1 });
taskSchema.index({ organizationId: 1, "related.entityId": 1 });
taskSchema.index({ organizationId: 1, createdBy: 1, createdAt: -1 });

export const TaskModel: Model<Task> =
  (mongoose.models.Task as Model<Task>) ??
  mongoose.model<Task>("Task", taskSchema);

export const taskSchemaDefinition = taskSchema;
