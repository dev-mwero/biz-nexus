"use client";

import { AlertTriangle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";

interface OverdueTask {
  _id: string;
  title: string;
  dueAt: string | null;
  status: string;
  priority: string;
  assigneeId?: string | null;
}

interface OverdueTasksProps {
  count: number;
  tasks: OverdueTask[];
  loading?: boolean;
}

const PRIORITY_LABELS: Record<string, string> = {
  URGENT: "Urgent priority",
  HIGH: "High priority",
  MEDIUM: "Medium priority",
  LOW: "Low priority",
};

export function OverdueTasks({
  count,
  tasks,
  loading = false,
}: OverdueTasksProps) {
  if (loading) {
    return (
      <Card variant="outlined" aria-hidden="true">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle
              className="size-4 text-attention"
              aria-hidden="true"
            />
            Overdue Tasks
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="space-y-3"
            role="status"
            aria-label="Loading overdue tasks"
          >
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 bg-surface-sunken dark:bg-surface-raised rounded-lg"
              >
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-24 ml-auto" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle
            className={cn(
              "size-4",
              count > 0 ? "text-attention" : "text-positive",
            )}
            aria-hidden="true"
          />
          Overdue Tasks
          {count > 0 && (
            <span
              className="ml-auto font-mono tabular-nums text-sm font-semibold text-attention"
              aria-label={`${count} overdue tasks`}
            >
              {count}
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {count === 0 ? (
          <div className="text-center py-8" role="status">
            <Clock
              className="size-12 mx-auto text-ink-300 dark:text-ink-600 mb-2"
              aria-hidden="true"
            />
            <p className="text-ink-500 dark:text-ink-400">No overdue tasks</p>
          </div>
        ) : (
          <ul className="space-y-2" role="list" aria-label="Overdue tasks">
            {tasks.slice(0, 5).map((task) => (
              <li
                key={task._id}
                className={cn(
                  "flex items-center gap-3 p-3 bg-surface-sunken dark:bg-surface-raised rounded-lg",
                  task.priority === "URGENT" && "border-l-2 border-critical",
                  task.priority === "HIGH" && "border-l-2 border-attention",
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-ink-900 dark:text-ink-50 truncate">
                    {task.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-ink-500 dark:text-ink-400">
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase",
                        task.priority === "URGENT" &&
                          "bg-critical-surface text-critical",
                        task.priority === "HIGH" &&
                          "bg-attention-surface text-attention",
                        task.priority === "MEDIUM" &&
                          "bg-info-surface text-info",
                        task.priority === "LOW" &&
                          "bg-neutral-surface text-ink-500",
                      )}
                      aria-label={
                        PRIORITY_LABELS[task.priority] ?? task.priority
                      }
                    >
                      {task.priority}
                    </span>
                    {task.dueAt && (
                      <time dateTime={task.dueAt} className="font-mono">
                        Due {formatRelativeTime(task.dueAt)}
                      </time>
                    )}
                  </div>
                </div>
              </li>
            ))}

            {tasks.length > 5 && (
              <li className="text-center pt-2">
                <a
                  href="/app/tasks?filter=overdue"
                  className="text-sm text-info hover:underline font-medium"
                >
                  View all {tasks.length} overdue tasks
                </a>
              </li>
            )}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
