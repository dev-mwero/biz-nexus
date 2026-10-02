"use client";

import {
  ArrowLeft,
  Check,
  CheckCircle,
  Edit,
  Flag,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ActivityComposer, ActivityTimeline } from "@/components/activities";
import { TaskForm } from "@/components/tasks/TaskForm";
import {
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FieldLabel,
  Separator,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "@/modules/tasks/task.constants";
import { useSession } from "@/shared/auth/session-client";
import { cn } from "@/shared/lib/cn";
import { formatDate, formatRelativeTime } from "@/shared/lib/format";

interface TaskDetail {
  _id: string;
  organizationId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  assigneeId: string | null;
  assigneeName?: string | null;
  related: Array<{ entityType: string; entityId: string }>;
  completedAt: string | null;
  completedById: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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
  DONE: {
    label: "Done",
    color: "bg-green-100 text-green-800",
    icon: CheckCircle,
  },
};

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  LOW: "bg-gray-100 text-gray-800",
  MEDIUM: "bg-yellow-100 text-yellow-800",
  HIGH: "bg-orange-100 text-orange-800",
  URGENT: "bg-red-100 text-red-800",
};

function getInitials(name?: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export default function TaskDetailPage() {
  const params = useParams();
  const taskId = params.id as string;
  const { data: session } = useSession();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const organizationId = session?.activeOrganizationId ?? "";

  const fetchTask = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}`);
      if (!response.ok) throw new Error("Failed to fetch task");
      const data = await response.json();
      setTask(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load task");
    } finally {
      setLoading(false);
    }
  }, [taskId]);

  useEffect(() => {
    fetchTask();
  }, [fetchTask]);

  const handleUpdateStatus = async (newStatus: TaskStatus) => {
    if (!task) return;
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!response.ok) throw new Error("Failed to update task");
      fetchTask();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to update task");
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this task?")) return;
    try {
      const response = await fetch(`/api/v1/tasks/${taskId}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete task");
      // Navigate back to tasks list
      window.location.href = "/tasks";
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete task");
    }
  };

  const handleTaskUpdated = () => {
    setEditing(false);
    fetchTask();
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <Card>
          <CardContent className="p-6">
            <div className="animate-pulse space-y-4">
              <div className="h-6 w-1/4 bg-muted rounded" />
              <div className="h-4 w-1/2 bg-muted rounded" />
              <div className="grid grid-cols-4 gap-4">
                {["skeleton-1", "skeleton-2", "skeleton-3", "skeleton-4"].map(
                  (key) => (
                    <div key={key} className="h-20 bg-muted rounded" />
                  ),
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold">Task not found</h2>
        <p className="text-muted-foreground mt-2">
          {error || "The task you're looking for doesn't exist."}
        </p>
        <ButtonLink href="/tasks" className="mt-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to tasks
        </ButtonLink>
      </div>
    );
  }

  const isOverdue =
    task.dueAt && new Date(task.dueAt) < new Date() && task.status !== "DONE";
  const config = STATUS_CONFIG[task.status];

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <ButtonLink href="/tasks" variant="ghost" size="icon">
            <ArrowLeft className="w-4 h-4" />
          </ButtonLink>
          <div>
            <h1 className="text-2xl font-bold">{task.title}</h1>
            <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
              <Badge tone="neutral" className={cn(config.color, "gap-1")}>
                <config.icon className="w-3 h-3" />
                {config.label}
              </Badge>
              <Badge tone="neutral" className={PRIORITY_COLORS[task.priority]}>
                <Flag className="w-3 h-3 mr-1" />
                {task.priority}
              </Badge>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button variant="secondary" size="icon">
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {task.status !== "DONE" && (
                <DropdownMenuItem onClick={() => handleUpdateStatus("DONE")}>
                  <Check className="w-4 h-4 mr-2" />
                  Mark Complete
                </DropdownMenuItem>
              )}
              {task.status === "DONE" && (
                <DropdownMenuItem onClick={() => handleUpdateStatus("TODO")}>
                  <RotateCcw className="w-4 h-4 mr-2" />
                  Reopen
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => setEditing(true)}>
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <Separator />
              <DropdownMenuItem onClick={handleDelete} destructive>
                <Trash2 className="w-4 h-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Task Details & Timeline Tabs */}
      <Tabs defaultValue="details" className="space-y-4">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <div className="grid gap-6 md:grid-cols-3">
            {/* Main Content */}
            <div className="md:col-span-2 space-y-6">
              {/* Description */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Description</CardTitle>
                </CardHeader>
                <CardContent>
                  {task.description ? (
                    <p className="whitespace-pre-wrap text-muted-foreground">
                      {task.description}
                    </p>
                  ) : (
                    <p className="text-muted-foreground italic">
                      No description
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Activity Timeline */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">Activity</CardTitle>
                    <ActivityComposer
                      entity={{ entityType: "task", entityId: task._id }}
                      allowedTypes={["NOTE", "CALL", "MEETING"]}
                      defaultType="NOTE"
                      onCreated={fetchTask}
                    />
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <ActivityTimeline
                    entity={{ entityType: "task", entityId: task._id }}
                    organizationId={organizationId}
                    initialPageSize={20}
                    showComposer={false}
                    mode="timeline"
                  />
                </CardContent>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="space-y-4">
              {/* Status & Priority */}
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div>
                    <FieldLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Status
                    </FieldLabel>
                    <div className="mt-1 space-y-2">
                      {TASK_STATUSES.map((status) => {
                        const StatusIcon = STATUS_CONFIG[status].icon;
                        return (
                          <button
                            key={status}
                            type="button"
                            onClick={() => handleUpdateStatus(status)}
                            disabled={task.status === status}
                            className={cn(
                              "w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors",
                              task.status === status
                                ? "bg-primary text-primary-foreground"
                                : "hover:bg-muted",
                            )}
                          >
                            <StatusIcon
                              className={cn(
                                "w-4 h-4",
                                task.status === status
                                  ? "text-primary-foreground"
                                  : "text-muted-foreground",
                              )}
                            />
                            <span className="font-medium">
                              {STATUS_CONFIG[status].label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div>
                    <FieldLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Priority
                    </FieldLabel>
                    <div className="mt-1 space-y-1">
                      {TASK_PRIORITIES.map((priority) => (
                        <button
                          key={priority}
                          type="button"
                          disabled={task.priority === priority}
                          className={cn(
                            "w-full flex items-center gap-2 p-2 rounded-lg text-left transition-colors",
                            task.priority === priority
                              ? "bg-primary text-primary-foreground"
                              : "hover:bg-muted",
                          )}
                        >
                          <Flag
                            className={cn(
                              "w-4 h-4",
                              task.priority === priority
                                ? "text-primary-foreground"
                                : "text-muted-foreground",
                            )}
                          />
                          <span className="font-medium">{priority}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Dates & Assignee */}
              <Card>
                <CardContent className="p-4 space-y-4">
                  <div>
                    <FieldLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Due Date
                    </FieldLabel>
                    <p
                      className={cn(
                        "mt-1 font-medium",
                        isOverdue ? "text-red-600" : "",
                      )}
                    >
                      {task.dueAt
                        ? formatDate(new Date(task.dueAt))
                        : "No due date"}
                    </p>
                    {isOverdue && (
                      <p className="mt-1 text-sm text-red-600">Overdue</p>
                    )}
                  </div>
                  <div>
                    <FieldLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Assignee
                    </FieldLabel>
                    <div className="mt-1 flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback>
                          {getInitials(task.assigneeName)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="font-medium">
                        {task.assigneeName || task.assigneeId || "Unassigned"}
                      </span>
                    </div>
                  </div>
                  <div>
                    <FieldLabel className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      Completed
                    </FieldLabel>
                    <p className="mt-1 font-medium">
                      {task.completedAt
                        ? formatRelativeTime(new Date(task.completedAt))
                        : "Not completed"}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Related Entities */}
              {task.related.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">Related</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <ul className="divide-y">
                      {task.related.map((rel) => (
                        <li
                          key={`${rel.entityType}:${rel.entityId}`}
                          className="px-4 py-2 flex items-center gap-2 text-sm"
                        >
                          <span className="text-muted-foreground capitalize">
                            {rel.entityType}
                          </span>
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded">
                            {rel.entityId.slice(-8)}
                          </code>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Full Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ActivityTimeline
                entity={{ entityType: "task", entityId: task._id }}
                organizationId={organizationId}
                initialPageSize={50}
                showComposer={false}
                mode="timeline"
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Edit Form Dialog */}
      {editing && (
        <TaskForm
          organizationId={organizationId}
          task={{
            _id: task._id,
            title: task.title,
            description: task.description,
            status: task.status,
            priority: task.priority,
            dueAt: task.dueAt,
            assigneeId: task.assigneeId,
            related: task.related,
          }}
          onSuccess={handleTaskUpdated}
          onClose={() => setEditing(false)}
          open={true}
        />
      )}
    </div>
  );
}
