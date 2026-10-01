"use client";

import { Bell, Check, Loader2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";

interface Notification {
  _id: string;
  title: string;
  body: string;
  type: string;
  readAt: string | null;
  createdAt: string;
  data: Record<string, unknown>;
}

interface UseNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  isLoading: boolean;
  isStreamConnected: boolean;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  refresh: () => Promise<void>;
}

const BELL_PAGE_SIZE = 20;

export function useNotifications(): UseNotificationsReturn {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isStreamConnected, setIsStreamConnected] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 10;

  const fetchNotifications = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/notifications?limit=20");
      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();
      setNotifications(data.data ?? []);
    } catch {
      setNotifications([]);
    }
  }, []);

  const fetchUnreadCount = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/notifications/unread-count");
      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();
      setUnreadCount(data.data?.count ?? 0);
    } catch {
      setUnreadCount(0);
    }
  }, []);

  const markRead = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/v1/notifications/${id}/read`, {
        method: "PATCH",
      });
      if (!response.ok) throw new Error("Failed to mark read");

      setNotifications((prev) =>
        prev.map((n) =>
          n._id === id ? { ...n, readAt: new Date().toISOString() } : n,
        ),
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // Ignore errors, UI will recover on next fetch
    }
  }, []);

  const markAllRead = useCallback(async () => {
    try {
      const response = await fetch("/api/v1/notifications/read-all", {
        method: "POST",
      });
      if (!response.ok) throw new Error("Failed to mark all read");

      setNotifications((prev) =>
        prev.map((n) =>
          n.readAt ? n : { ...n, readAt: new Date().toISOString() },
        ),
      );
      setUnreadCount(0);
    } catch {
      // Ignore errors
    }
  }, []);

  const connectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const eventSource = new EventSource("/api/v1/notifications/stream");
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      setIsStreamConnected(true);
      reconnectAttempts.current = 0;
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "unread-count") {
          setUnreadCount(data.count);
          // Refresh notifications when count changes
          fetchNotifications();
        }
      } catch {
        // Ignore parse errors
      }
    };

    eventSource.onerror = () => {
      setIsStreamConnected(false);
      eventSource.close();

      // Exponential backoff reconnection
      if (reconnectAttempts.current < maxReconnectAttempts) {
        const delay = Math.min(1000 * 2 ** reconnectAttempts.current, 30_000);
        reconnectAttempts.current += 1;
        reconnectTimeoutRef.current = setTimeout(() => {
          connectSSE();
        }, delay);
      }
    };
  }, [fetchNotifications]);

  const disconnectSSE = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
      setIsStreamConnected(false);
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([fetchNotifications(), fetchUnreadCount()]);
    setIsLoading(false);
  }, [fetchNotifications, fetchUnreadCount]);

  // Initial load and SSE connection
  useEffect(() => {
    refresh();
    connectSSE();

    return () => {
      disconnectSSE();
    };
  }, [refresh, connectSSE, disconnectSSE]);

  return {
    notifications,
    unreadCount,
    isLoading,
    isStreamConnected,
    markRead,
    markAllRead,
    refresh,
  };
}

export function NotificationBell() {
  const {
    notifications,
    unreadCount,
    isLoading,
    isStreamConnected,
    markRead,
    markAllRead,
  } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);

  // Live region for announcing unread count changes to screen readers
  const [announcedCount, setAnnouncedCount] = useState(unreadCount);
  useEffect(() => {
    if (unreadCount !== announcedCount) {
      setAnnouncedCount(unreadCount);
    }
  }, [unreadCount, announcedCount]);

  if (isLoading) {
    return (
      <div className="relative">
        <Button variant="ghost" size="icon" aria-label="Notifications" disabled>
          <Bell className="size-5" aria-hidden="true" />
          <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-critical text-[10px] font-medium text-white">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          </span>
        </Button>
      </div>
    );
  }

  const unreadNotifications = notifications.filter((n) => !n.readAt);

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={
              unreadCount > 0
                ? `${unreadCount} unread notifications`
                : "Notifications"
            }
            aria-expanded={isOpen}
          >
            <Bell className="size-5" aria-hidden="true" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-critical text-[10px] font-medium text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </Button>
        }
      />

      {/* Live region for screen readers */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {unreadCount > 0
          ? `${unreadCount} unread notifications`
          : "No unread notifications"}
      </div>

      <DropdownMenuContent
        align="end"
        className="w-80 min-w-[320px] max-h-[480px]"
      >
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="font-medium">
            Notifications
          </DropdownMenuLabel>
          {unreadCount > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllRead}>
              Mark all read
            </Button>
          )}
        </div>
        <DropdownMenuSeparator />

        {notifications.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Bell}
              title="No notifications"
              description="You're all caught up."
              compact
            />
          </div>
        ) : (
          <div className="max-h-[380px] overflow-y-auto">
            {notifications.map((notification) => (
              <DropdownMenuItem
                key={notification._id}
                className={cn(
                  "flex flex-col items-start gap-1 p-2",
                  !notification.readAt &&
                    "bg-info-surface/50 dark:bg-info-surface/30",
                )}
                onSelect={() =>
                  !notification.readAt && markRead(notification._id)
                }
                // Already-read notifications cannot be marked again; the
                // timestamp is a string when read, so it has to be coerced to
                // the boolean `disabled` expects.
                disabled={Boolean(notification.readAt)}
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        !notification.readAt && "font-semibold",
                      )}
                    >
                      {notification.title}
                    </p>
                    <p className="text-xs text-ink-500 dark:text-ink-400 truncate">
                      {notification.body}
                    </p>
                    <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-0.5">
                      {formatRelativeTime(notification.createdAt)}
                    </p>
                  </div>
                  {!notification.readAt && (
                    <Check
                      className="size-4 text-positive flex-shrink-0"
                      aria-hidden="true"
                    />
                  )}
                </div>
              </DropdownMenuItem>
            ))}
          </div>
        )}

        {notifications.length >= BELL_PAGE_SIZE && <DropdownMenuSeparator />}

        <DropdownMenuItem
          className="text-center text-info hover:bg-info-surface dark:hover:bg-info-surface"
          onSelect={() => (window.location.href = "/notifications")}
        >
          View all notifications
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
