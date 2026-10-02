"use client";

import {
  Calendar,
  Check,
  Edit,
  Filter,
  Loader2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  User,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from "@/components/ui";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "@/modules/tasks/task.constants";
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

interface TaskListProps {
  organizationId: string;
  initialFilters?: {
    status?: TaskStatus;
    assigneeId?: string;
    relatedEntityType?: string;
    relatedEntityId?: string;
  };
  onTaskClick?: (task: TaskItem) => void;
  onTaskComplete?: (taskId: string) => void;
}

/** Placeholder rows shown while the list loads. */
const LIST_SKELETON_ROWS = [
  "row-1",
  "row-2",
  "row-3",
  "row-4",
  "row-5",
] as const;

const STATUS_COLORS: Record<TaskStatus, string> = {
  TODO: "bg-gray-100 text-gray-800",
  IN_PROGRESS: "bg-blue-100 text-blue-800",
  DONE: "bg-green-100 text-green-800",
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  LOW: "bg-gray-100 text-gray-800",
  MEDIUM: "bg-yellow-100 text-yellow-800",
  HIGH: "bg-orange-100 text-orange-800",
  URGENT: "bg-red-100 text-red-800",
};

const STATUS_ICONS: Record<
  TaskStatus,
  React.ComponentType<{ className?: string }>
> = {
  TODO: Check,
  IN_PROGRESS: Loader2,
  DONE: Check,
};

function TaskCard({
  task,
  onClick,
  onComplete,
  onReopen,
  onEdit,
  onDelete,
}: {
  task: TaskItem;
  onClick?: (task: TaskItem) => void;
  onComplete?: (id: string) => void;
  onReopen?: (id: string) => void;
  onEdit?: (task: TaskItem) => void;
  onDelete?: (id: string) => void;
}) {
  const isOverdue =
    task.dueAt && new Date(task.dueAt) < new Date() && task.status !== "DONE";
  const StatusIcon = STATUS_ICONS[task.status] || Check;

  return (
    <Card
      className={cn(
        "transition-all hover:shadow-md cursor-pointer",
        onClick && "hover:bg-muted/50",
      )}
      onClick={() => onClick?.(task)}
    >
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              "flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center",
              STATUS_COLORS[task.status],
            )}
          >
            <StatusIcon className="w-4 h-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-medium text-foreground truncate">
                {task.title}
              </h4>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`Actions for ${task.title}`}
                      className="p-1 rounded hover:bg-muted transition-colors"
                    >
                      <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                    </button>
                  }
                />
                <DropdownMenuContent align="end">
                  {onEdit && (
                    <DropdownMenuItem onClick={() => onEdit(task)}>
                      <Edit className="w-4 h-4 mr-2" />
                      Edit
                    </DropdownMenuItem>
                  )}
                  {task.status !== "DONE" && onComplete && (
                    <DropdownMenuItem onClick={() => onComplete(task._id)}>
                      <Check className="w-4 h-4 mr-2" />
                      Complete
                    </DropdownMenuItem>
                  )}
                  {task.status === "DONE" && onReopen && (
                    <DropdownMenuItem onClick={() => onReopen(task._id)}>
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Reopen
                    </DropdownMenuItem>
                  )}
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
            </div>
            {task.description && (
              <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
                {task.description}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <Badge tone="neutral" className={STATUS_COLORS[task.status]}>
                {task.status.replace("_", " ")}
              </Badge>
              <Badge tone="neutral" className={PRIORITY_COLORS[task.priority]}>
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
                  {isOverdue
                    ? "Overdue"
                    : formatRelativeTime(new Date(task.dueAt))}
                </span>
              )}
              {task.assigneeId && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <User className="w-3 h-3" />
                  {task.assigneeId.slice(-6)}
                </span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TaskSkeleton() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <Skeleton className="w-8 h-8 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2 mt-2" />
            <Skeleton className="h-3 w-1/3 mt-1" />
            <div className="mt-2 flex gap-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-24" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function TaskList({
  organizationId,
  initialFilters = {},
  onTaskClick,
  onTaskComplete,
}: TaskListProps) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    status: initialFilters.status || "",
    assigneeId: initialFilters.assigneeId || "",
    relatedEntityType: initialFilters.relatedEntityType || "",
    relatedEntityId: initialFilters.relatedEntityId || "",
    search: "",
    page: 1,
  });
  const [total, setTotal] = useState(0);
  const [showFilters, setShowFilters] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("page", String(filters.page));
      params.set("pageSize", "20");
      if (filters.status) params.set("status", filters.status);
      if (filters.assigneeId) params.set("assigneeId", filters.assigneeId);
      if (filters.relatedEntityType)
        params.set("relatedEntityType", filters.relatedEntityType);
      if (filters.relatedEntityId)
        params.set("relatedEntityId", filters.relatedEntityId);
      if (filters.search) params.set("q", filters.search);

      const response = await fetch(`/api/v1/tasks?${params.toString()}`);
      if (!response.ok) throw new Error("Failed to fetch tasks");

      const data = await response.json();
      setTasks(data.data || []);
      setTotal(data.meta?.total || 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleComplete = async (taskId: string) => {
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      });
      if (!response.ok) throw new Error("Failed to complete task");
      fetchTasks();
      onTaskComplete?.(taskId);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to complete task");
    }
  };

  const handleReopen = async (taskId: string) => {
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "TODO" }),
      });
      if (!response.ok) throw new Error("Failed to reopen task");
      fetchTasks();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to reopen task");
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

  if (loading) {
    return (
      <div className="space-y-3">
        {LIST_SKELETON_ROWS.map((row) => (
          <TaskSkeleton key={row} />
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

  if (tasks.length === 0) {
    return (
      <EmptyState
        title="No tasks found"
        description={
          filters.search || filters.status
            ? "Try adjusting your filters."
            : "Create your first task to get started."
        }
        icon={Check}
        action={{
          label: "Create task",
          onClick: () => setFilters((f) => ({ ...f, showForm: true })),
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={filters.search}
            onChange={(e) =>
              setFilters((f) => ({ ...f, search: e.target.value, page: 1 }))
            }
            className="pl-9"
          />
        </div>
        <Select
          value={filters.status}
          // A cleared select reports `null`; the filter records that as "no
          // status filter", matching the "All statuses" row.
          onValueChange={(v) =>
            setFilters((f) => ({ ...f, status: v ?? "", page: 1 }))
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All statuses</SelectItem>
            {TASK_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s.replace("_", " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="secondary"
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="w-4 h-4 mr-2" />
          Filters
        </Button>
        <Dialog>
          <DialogTrigger
            render={
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                New task
              </Button>
            }
          />
          <DialogContent className="max-w-2xl">
            <TaskForm organizationId={organizationId} onSuccess={fetchTasks} />
          </DialogContent>
        </Dialog>
      </div>

      {showFilters && (
        <Card className="mb-4">
          <CardContent className="p-4">
            <div className="flex flex-wrap gap-4">
              <div className="flex-1 min-w-[200px]">
                <Input
                  placeholder="Assignee ID"
                  value={filters.assigneeId}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      assigneeId: e.target.value,
                      page: 1,
                    }))
                  }
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <Input
                  placeholder="Related entity type"
                  value={filters.relatedEntityType}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      relatedEntityType: e.target.value,
                      page: 1,
                    }))
                  }
                />
              </div>
              <div className="flex-1 min-w-[200px]">
                <Input
                  placeholder="Related entity ID"
                  value={filters.relatedEntityId}
                  onChange={(e) =>
                    setFilters((f) => ({
                      ...f,
                      relatedEntityId: e.target.value,
                      page: 1,
                    }))
                  }
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {tasks.map((task) => (
          <TaskCard
            key={task._id}
            task={task}
            onClick={onTaskClick}
            onComplete={handleComplete}
            onReopen={handleReopen}
            onEdit={(task) => {}}
            onDelete={handleDelete}
          />
        ))}
      </div>

      {total > tasks.length && (
        <div className="flex justify-center mt-4">
          <Button
            variant="secondary"
            onClick={() => setFilters((f) => ({ ...f, page: f.page + 1 }))}
          >
            Load more ({tasks.length}/{total})
          </Button>
        </div>
      )}
    </div>
  );
}
