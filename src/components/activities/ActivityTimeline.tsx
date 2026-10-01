"use client";

import {
  Calendar,
  Check,
  ChevronDown,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Phone,
  Plus,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  ScrollArea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Textarea,
} from "@/components/ui";
import type { ActivityType } from "@/modules/activities/activity.model";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";

interface ActivityTimelineProps {
  /** Timeline for a specific record */
  entity?: { entityType: string; entityId: string };
  /** Organization-wide feed */
  organizationId?: string;
  /** Initial page size */
  initialPageSize?: number;
  /** Show composer at top */
  showComposer?: boolean;
  /** Filter by activity types */
  allowedTypes?: ActivityType[];
  /** Current user ID for ownership checks */
  currentUserId?: string;
  /** Mode: 'feed' for org feed (cursor pagination), 'timeline' for entity (occurredAt pagination) */
  mode?: "feed" | "timeline";
}

interface ActivityItem {
  _id: string;
  type: ActivityType;
  title: string;
  body: string | null;
  direction: "INBOUND" | "OUTBOUND" | null;
  durationSeconds: number | null;
  occurredAt: string;
  actorId: string | null;
  ownerId: string;
  subjects: Array<{ entityType: string; entityId: string }>;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** Placeholder rows shown while the timeline loads. */
const TIMELINE_SKELETON_ROWS = [
  "row-1",
  "row-2",
  "row-3",
  "row-4",
  "row-5",
] as const;

const ACTIVITY_ICONS: Record<
  ActivityType,
  React.ComponentType<{ className?: string }>
> = {
  NOTE: MessageSquare,
  TASK: Check,
  CALL: Phone,
  MEETING: Calendar,
  SYSTEM_EVENT: Loader2,
  STAGE_CHANGE: Loader2,
  EMAIL: MessageSquare,
  SMS: MessageSquare,
  WHATSAPP: MessageSquare,
};

const ACTIVITY_LABELS: Record<ActivityType, string> = {
  NOTE: "Note",
  TASK: "Task",
  CALL: "Call",
  MEETING: "Meeting",
  SYSTEM_EVENT: "System",
  STAGE_CHANGE: "Stage Change",
  EMAIL: "Email",
  SMS: "SMS",
  WHATSAPP: "WhatsApp",
};

function ActivityItemComponent({
  activity,
  currentUserId,
  onDelete,
}: {
  activity: ActivityItem;
  currentUserId?: string;
  onDelete?: (id: string) => void;
}) {
  const Icon = ACTIVITY_ICONS[activity.type] || Loader2;
  const isOwner = currentUserId && activity.ownerId === currentUserId;
  const [showMenu, setShowMenu] = useState(false);

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return null;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  };

  return (
    <Card className="flex flex-col gap-2 transition-opacity hover:opacity-100">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
          <Icon className="w-4 h-4 text-muted-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium text-foreground">
              {activity.title}
            </p>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground whitespace-nowrap">
                {formatRelativeTime(new Date(activity.occurredAt))}
              </span>
              {isOwner && onDelete && (
                <div className="relative">
                  <button
                    type="button"
                    onClick={() => setShowMenu(!showMenu)}
                    className="p-1 rounded hover:bg-muted transition-colors"
                    aria-label="More options"
                  >
                    <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
                  </button>
                  {showMenu && (
                    <div className="absolute right-0 top-full mt-1 z-10">
                      <button
                        type="button"
                        onClick={() => {
                          onDelete(activity._id);
                          setShowMenu(false);
                        }}
                        className="block w-full px-3 py-1 text-left text-sm text-red-600 hover:bg-red-50 rounded"
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          {activity.body && (
            <p className="mt-1 text-sm text-muted-foreground whitespace-pre-wrap">
              {activity.body}
            </p>
          )}
          {(activity.direction || activity.durationSeconds) && (
            <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
              {activity.direction && (
                <span className="flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                  {activity.direction}
                </span>
              )}
              {activity.durationSeconds && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {formatDuration(activity.durationSeconds)}
                </span>
              )}
            </div>
          )}
          {activity.metadata && Object.keys(activity.metadata).length > 0 && (
            <details className="mt-2">
              <summary className="text-xs text-muted-foreground cursor-pointer">
                Metadata
              </summary>
              <pre className="mt-1 text-xs text-muted-foreground bg-muted p-2 rounded overflow-auto">
                {JSON.stringify(activity.metadata, null, 2)}
              </pre>
            </details>
          )}
        </div>
      </div>
    </Card>
  );
}

function ActivitySkeleton() {
  return (
    <Card className="flex flex-col gap-2">
      <div className="flex items-start gap-3">
        <Skeleton className="w-8 h-8 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2 mt-2" />
          <Skeleton className="h-3 w-1/3 mt-1" />
        </div>
      </div>
    </Card>
  );
}

export function ActivityTimeline({
  entity,
  organizationId,
  initialPageSize = 20,
  showComposer = true,
  allowedTypes,
  currentUserId,
  mode = "feed",
}: ActivityTimelineProps) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const fetchActivities = useCallback(
    async (isLoadMore = false) => {
      if (isLoadMore) setLoadingMore(true);
      else setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams();
        params.set("limit", String(initialPageSize));

        // Determine which endpoint to use
        const isFeedMode = mode === "feed" && organizationId && !entity;
        const endpoint = isFeedMode
          ? "/api/v1/activities/feed"
          : "/api/v1/activities";

        if (cursor) {
          params.set(isFeedMode ? "cursor" : "before", cursor);
        }

        if (entity) {
          params.set("entityType", entity.entityType);
          params.set("entityId", entity.entityId);
        } else if (organizationId && !isFeedMode) {
          params.set("organizationId", organizationId);
        }

        if (allowedTypes && allowedTypes.length > 0) {
          params.set("type", allowedTypes[0]); // Simplified - would need array support
        }

        const response = await fetch(`${endpoint}?${params.toString()}`);
        if (!response.ok) throw new Error("Failed to fetch activities");

        const data = await response.json();

        // Handle different response formats
        let newActivities: ActivityItem[];
        let nextCursor: string | null = null;

        if (isFeedMode) {
          newActivities = data.data?.activities || data.data || [];
          nextCursor = data.data?.nextCursor || null;
        } else {
          newActivities = data.data || [];
        }

        if (isLoadMore) {
          setActivities((prev) => [...prev, ...newActivities]);
        } else {
          setActivities(newActivities);
        }

        if (isFeedMode) {
          setHasMore(!!nextCursor);
          if (nextCursor) setCursor(nextCursor);
          else setHasMore(false);
        } else {
          if (newActivities.length < initialPageSize) {
            setHasMore(false);
          } else if (newActivities.length > 0) {
            const last = newActivities[newActivities.length - 1];
            setCursor(last.occurredAt);
          }
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load activities",
        );
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [entity, organizationId, initialPageSize, allowedTypes, cursor, mode],
  );

  useEffect(() => {
    fetchActivities(false);
  }, [fetchActivities]);

  // Infinite scroll observer
  useEffect(() => {
    if (!hasMore || loadingMore) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          fetchActivities(true);
        }
      },
      { rootMargin: "100px" },
    );

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current);
    }

    return () => observerRef.current?.disconnect();
  }, [hasMore, loadingMore, fetchActivities]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this activity?")) return;

    try {
      const response = await fetch(`/api/v1/activities/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete");
      setActivities((prev) => prev.filter((a) => a._id !== id));
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete");
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {TIMELINE_SKELETON_ROWS.map((row) => (
          <ActivitySkeleton key={row} />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="Failed to load activities"
        description={error}
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => fetchActivities(false)}
          >
            Retry
          </Button>
        }
      />
    );
  }

  if (activities.length === 0) {
    return (
      <EmptyState
        title={entity ? "No activities yet" : "No organization activity"}
        description={
          entity
            ? "Add a note, log a call, or schedule a meeting to start the timeline."
            : "Activity will appear here as your team works."
        }
        icon={MessageSquare}
      />
    );
  }

  return (
    <div className="space-y-3">
      {activities.map((activity) => (
        <ActivityItemComponent
          key={activity._id}
          activity={activity}
          currentUserId={currentUserId}
          onDelete={handleDelete}
        />
      ))}
      {hasMore && (
        <div ref={loadMoreRef} className="flex justify-center py-4">
          {loadingMore ? (
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => fetchActivities(true)}
            >
              Load more
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
