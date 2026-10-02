import type { Types } from "mongoose";

/**
 * Events the tasks module emits.
 *
 * Declared here so subscribers (activity timeline, notifications) compile against
 * the same shape the module emits.
 */
declare module "@/shared/events/registry" {
  interface DomainEventMap {
    "task.assigned": {
      organizationId: Types.ObjectId;
      taskId: Types.ObjectId;
      taskTitle: string;
      assigneeId: Types.ObjectId;
      assignedBy: Types.ObjectId;
    };
    "task.unassigned": {
      organizationId: Types.ObjectId;
      taskId: Types.ObjectId;
      taskTitle: string;
      previousAssigneeId: Types.ObjectId;
      unassignedBy: Types.ObjectId;
    };
    "task.completed": {
      organizationId: Types.ObjectId;
      taskId: Types.ObjectId;
      taskTitle: string;
      completedBy: Types.ObjectId;
      assigneeId: Types.ObjectId | null;
      related: Array<{ entityType: string; entityId: Types.ObjectId }>;
    };
    "task.reopened": {
      organizationId: Types.ObjectId;
      taskId: Types.ObjectId;
      taskTitle: string;
      reopenedBy: Types.ObjectId;
    };
    "task.due_soon": {
      organizationId: Types.ObjectId;
      taskId: Types.ObjectId;
      taskTitle: string;
      assigneeId: Types.ObjectId;
      dueAt: Date;
    };
    "task.overdue": {
      organizationId: Types.ObjectId;
      taskId: Types.ObjectId;
      taskTitle: string;
      assigneeId: Types.ObjectId;
      dueAt: Date;
    };
  }
}

export type TaskRelated = {
  entityType: string;
  entityId: Types.ObjectId;
};
