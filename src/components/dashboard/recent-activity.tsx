"use client";

import {
  Calendar,
  GitBranch,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  Send,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";

interface ActivityItem {
  _id: string;
  title: string;
  type: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

interface RecentActivityProps {
  activities: ActivityItem[];
  loading?: boolean;
}

const ACTIVITY_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  NOTE: MessageSquare,
  CALL: Phone,
  MEETING: Calendar,
  STAGE_CHANGE: GitBranch,
  EMAIL: Mail,
  SMS: Send,
  WHATSAPP: MessageCircle,
  SYSTEM_EVENT: MessageSquare,
  TASK: MessageSquare,
};

const ACTIVITY_LABELS: Record<string, string> = {
  NOTE: "Note",
  CALL: "Call",
  MEETING: "Meeting",
  STAGE_CHANGE: "Stage change",
  EMAIL: "Email",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
  SYSTEM_EVENT: "System event",
  TASK: "Task",
};

export function RecentActivity({
  activities,
  loading = false,
}: RecentActivityProps) {
  if (loading) {
    return (
      <Card variant="outlined" aria-hidden="true">
        <CardHeader>
          <CardTitle>Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="space-y-3"
            role="status"
            aria-label="Loading recent activity"
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="h-8 w-8 rounded-lg flex-shrink-0" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
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
        <CardTitle>Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
          <div
            className="text-center py-8 text-ink-500 dark:text-ink-400"
            role="status"
          >
            No recent activity
          </div>
        ) : (
          <ul className="space-y-3" role="list" aria-label="Recent activity">
            {activities.map((activity) => {
              const Icon = ACTIVITY_ICONS[activity.type] ?? MessageSquare;
              const typeLabel =
                ACTIVITY_LABELS[activity.type] ??
                activity.type.replace(/_/g, " ");

              return (
                <li key={activity._id} className="flex items-start gap-3">
                  <div
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0 bg-surface-sunken dark:bg-surface-raised",
                    )}
                    aria-hidden="true"
                  >
                    <Icon className="size-4 text-ink-500 dark:text-ink-400" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <p className="text-sm font-medium text-ink-900 dark:text-ink-50">
                      {activity.title}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-ink-500 dark:text-ink-400">
                      <span className="font-medium text-ink-600 dark:text-ink-400">
                        {typeLabel}
                      </span>
                      <span aria-hidden="true">•</span>
                      <time dateTime={activity.occurredAt}>
                        {formatRelativeTime(activity.occurredAt)}
                      </time>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
