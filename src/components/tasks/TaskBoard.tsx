"use client";

import {
  Calendar,
  Check,
  Edit,
  Flag,
  GripVertical,
  Loader2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Trash2,
  User,
} from "lucide-react";
import { Types } from "mongoose";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ScrollArea,
  Skeleton,
} from "@/components/ui";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "@/modules/tasks/task.model";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";
import { TaskForm } from "./TaskForm";

export interface TaskItem {
  _id: string;
  organizationId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  assigneeId: string | null;
  related: Array<{ entityType: string; entityId: string }>;
  completedAt: string | null;
  completedById: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface TaskBoardProps {
  organizationId: string;
  initialFilters?: {
    assigneeId?: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  };
  onTaskClick?: (task: TaskItem) => void;
  onTaskComplete?: (taskId: string) => void;
}

const STATUS_CONFIG: Record<
  TaskStatus,
  {
    label: string;
    color: string;
    icon: React.ComponentType<{ className?: string }>;
  }
> = {
  TODO: { label: "To Do", color: "bg-gray-100 text-gray-800", icon: Loader2 },
  IN_PROGRESS: {
    label: "In Progress",
    color: "bg-blue-100 text-blue-800",
    icon: Loader2,
  },
  DONE: { label: "Done", color: "bg-green-100 text-green-800", icon: Check },
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  LOW: "bg-gray-100 text-gray-800",
  MEDIUM: "bg-yellow-100 text-yellow-800",
  HIGH: "bg-orange-100 text-orange-800",
  URGENT: "bg-red-100 text-red-800",
};

function TaskCardBoard({
  task,
  onClick,
  onUpdateStatus,
  onEdit,
  onDelete,
}: {
  task: TaskItem;
  onClick?: (task: TaskItem) => void;
  onUpdateStatus: (taskId: string, status: TaskStatus) => void;
  onEdit?: (task: TaskItem) => void;
  onDelete?: (id: string) => void;
}) {
  const isOverdue =
    task.dueAt && new Date(task.dueAt) < new Date() && task.status !== "DONE";

  return (
    <Card
      className={cn(
        "transition-all hover:shadow-md cursor-pointer",
        onClick && "hover:bg-muted/50",
      )}
      onClick={() => onClick?.(task)}
    >
      <CardContent className="p-3">
        <h4 className="font-medium text-foreground mb-2 truncate">
          {task.title}
        </h4>
        {task.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
            {task.description}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-1.5 text-xs mb-2">
          <Badge variant="secondary" className={PRIORITY_COLORS[task.priority]}>
            {task.priority}
          </Badge>
          {task.dueAt && (
            <span
              className={cn(
                "flex items-center gap-1",
                isOverdue ? "text-red-600" : "text-muted-foreground",
              )}
            >
              <Calendar className="w-3 h-3" />
              {isOverdue ? "Overdue" : formatRelativeTime(new Date(task.dueAt))}
            </span>
          )}
          {task.assigneeId && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <User className="w-3 h-3" />
              {task.assigneeId.slice(-6)}
            </span>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1 rounded hover:bg-muted transition-colors w-full flex justify-end">
              <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {onEdit && (
              <DropdownMenuItem onClick={() => onEdit(task)}>
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => onUpdateStatus(task._id, "TODO")}
              disabled={task.status === "TODO"}
            >
              <Loader2 className="w-4 h-4 mr-2" />
              Mark as To Do
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onUpdateStatus(task._id, "IN_PROGRESS")}
              disabled={task.status === "IN_PROGRESS"}
            >
              <Loader2 className="w-4 h-4 mr-2" />
              Mark as In Progress
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => onUpdateStatus(task._id, "DONE")}
              disabled={task.status === "DONE"}
            >
              <Check className="w-4 h-4 mr-2" />
              Complete
            </DropdownMenuItem>
            {onDelete && (
              <DropdownMenuItem
                onClick={() => onDelete(task._id)}
                className="text-red-600"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </CardContent>
    </Card>
  );
}

function ColumnSkeleton() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Loading...</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function TaskBoard({
  organizationId,
  initialFilters = {},
  onTaskClick,
  onTaskComplete,
}: TaskBoardProps) {
  const [tasksByStatus, setTasksByStatus] = useState<
    Record<TaskStatus, TaskItem[]>
  >({
    TODO: [],
    IN_PROGRESS: [],
    DONE: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<TaskItem | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("pageSize", "100");
      if (initialFilters.assigneeId)
        params.set("assigneeId", initialFilters.assigneeId);
      if (initialFilters.relatedEntityType)
        params.set("relatedEntityType", initialFilters.relatedEntityType);
      if (initialFilters.relatedEntityId)
        params.set("relatedEntityId", initialFilters.relatedEntityId);

      const response = await fetch(`/api/v1/tasks?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch tasks");

      const data = await response.json();
      const tasks: TaskItem[] = data.data || [];

      const grouped: Record<TaskStatus, TaskItem[]> = {
        TODO: [],
        IN_PROGRESS: [],
        DONE: [],
      };

      tasks.forEach((task) => {
        if (grouped[task.status]) {
          grouped[task.status].push(task);
        }
      });

      setTasksByStatus(grouped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [initialFilters]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleUpdateStatus = async (taskId: string, newStatus: TaskStatus) => {
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!response.ok) throw new Error("Failed to update task");
      fetchTasks();
      if (newStatus === "DONE") onTaskComplete?.(taskId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update task");
    }
  };

  const handleDelete = async (taskId: string) => {
    if (!confirm("Delete this task?")) return;
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete task");
      fetchTasks();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete task");
    }
  };

  const handleEdit = (task: TaskItem) => {
    setEditingTask(task);
    setFormOpen(true);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-3 gap-4">
        {TASK_STATUSES.map((status) => (
          <ColumnSkeleton key={status} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        title="Failed to load tasks"
        description={error}
        action={{ label: "Retry", onClick: fetchTasks }}
      />
    );
  }

  const totalTasks = Object.values(tasksByStatus).flat().length;
  if (totalTasks === 0) {
    return (
      <EmptyState
        title="No tasks yet"
        description="Create your first task to get started."
        icon={Check}
        action={{ label: "Create task", onClick: () => setFormOpen(true) }}
      />
    );
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {TASK_STATUSES.map((status) => {
        const config = STATUS_CONFIG[status];
        const tasks = tasksByStatus[status];
        const Icon = config.icon;

        return (
          <div key={status} className="flex-shrink-0 w-80">
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className={cn(
                        "w-8 h-8 rounded-full flex items-center justify-center",
                        config.color,
                      )}
                    >
                      <Icon className="w-4 h-4" />
                    </div>
                    <CardTitle className="text-sm font-medium">
                      {config.label}
                    </CardTitle>
                    <Badge variant="secondary">{tasks.length}</Badge>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setFormOpen(true)}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="max-h-[calc(100vh-300px)]">
                  <div className="p-3 space-y-3">
                    {tasks.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Icon className="w-8 h-8 mx-auto mb-2 opacity-30" />
                        <p className="text-sm">No tasks</p>
                      </div>
                    ) : (
                      tasks.map((task) => (
                        <TaskCardBoard
                          key={task._id}
                          task={task}
                          onClick={onTaskClick}
                          onUpdateStatus={handleUpdateStatus}
                          onEdit={handleEdit}
                          onDelete={handleDelete}
                        />
                      ))
                    )}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </div>
        );
      })}
    </div>
  );
}
