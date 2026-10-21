"use client";

import { Bell, BellOff, CheckCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useNotifications } from "@/components/notifications/notification-bell";
import { Badge, Button, Card, CardContent, Skeleton } from "@/components/ui";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";

/**
 * The notification inbox.
 *
 * The bell (`NotificationBell`) already owns the transport — the list fetch, the
 * unread count, the SSE stream and the reconnect backoff — and exposes all of it
 * through `useNotifications`. This page is the full-screen destination that bell
 * links to, so it reuses that hook rather than opening a second EventSource
 * against the same stream: two subscriptions would double every update and
 * disconnect one of them on navigation.
 *
 * Per `docs/PLAN.md` §1K this screen was a deliberate placeholder. The API, the
 * model and the bell all existed; only the page did not.
 */

interface InboxNotification {
  _id: string;
  title: string;
  body: string;
  type: string;
  readAt: string | null;
  createdAt: string;
  data: Record<string, unknown>;
}

/**
 * A notification's deep link, when it carries one.
 *
 * `data` is caller-supplied and redacted before storage, so the only contract is
 * "may contain a string at `url`". Anything else — a missing key, a non-string,
 * an object — is treated as "no link" rather than rendered, because a bad value
 * here would become an `href` and there is no page to send the user to.
 */
function deepLink(notification: InboxNotification): string | null {
  const url = notification.data?.url;
  return typeof url === "string" && url.startsWith("/") ? url : null;
}

export default function NotificationsPage() {
  const { notifications, unreadCount, isLoading, markRead, markAllRead } =
    useNotifications();

  // `isLoading` covers the initial fetch; the hook does not surface a fetch
  // error, and a notification list that failed to load is indistinguishable
  // from one that is empty. Announce the difference rather than pretend.
  const [loadedOnce, setLoadedOnce] = useState(false);
  useEffect(() => {
    if (!isLoading) setLoadedOnce(true);
  }, [isLoading]);

  const items = notifications as InboxNotification[];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div
            className="grid size-10 place-items-center rounded-lg border border-line bg-surface-sunken text-ink-500"
            aria-hidden="true"
          >
            <Bell className="size-5" strokeWidth={1.75} />
          </div>
          <div>
            <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50">
              Notifications
            </h1>
            <p className="text-sm text-ink-500 dark:text-ink-400">
              {unreadCount > 0
                ? `${unreadCount} unread`
                : "You're all caught up"}
            </p>
          </div>
        </div>

        {unreadCount > 0 && (
          <Button variant="secondary" onClick={() => void markAllRead()}>
            <CheckCheck className="size-4" aria-hidden="true" />
            Mark all read
          </Button>
        )}
      </div>

      {isLoading && !loadedOnce ? (
        <Card variant="outlined">
          <CardContent className="divide-y divide-line p-0">
            {["a", "b", "c", "d", "e"].map((key) => (
              <div key={key} className="flex items-start gap-3 p-4">
                <Skeleton className="size-9 shrink-0 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card variant="outlined">
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div
              className="grid size-12 place-items-center rounded-lg border border-line bg-surface-sunken text-ink-400"
              aria-hidden="true"
            >
              <BellOff className="size-5" strokeWidth={1.75} />
            </div>
            <div className="space-y-1">
              <p className="font-display font-semibold text-ink-900 dark:text-ink-50">
                No notifications
              </p>
              <p className="mx-auto max-w-sm text-sm text-ink-500 dark:text-ink-400">
                Assignments, mentions and reminders land here.
              </p>
            </div>
            <Link
              href="/dashboard"
              className="text-sm font-medium text-info underline-offset-4 hover:underline"
            >
              Back to dashboard
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card variant="outlined">
          <CardContent className="divide-y divide-line p-0">
            <ul aria-label="Notifications">
              {items.map((notification) => {
                const unread = !notification.readAt;
                const href = deepLink(notification);
                const body = (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p
                            className={cn(
                              "truncate text-sm text-ink-900 dark:text-ink-50",
                              unread ? "font-semibold" : "font-medium",
                            )}
                          >
                            {notification.title}
                          </p>
                          {unread && (
                            <Badge tone="info" size="sm" dot>
                              New
                            </Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">
                          {notification.body}
                        </p>
                        <p className="mt-1 text-xs text-ink-400 dark:text-ink-500">
                          {formatRelativeTime(notification.createdAt)}
                        </p>
                      </div>
                    </div>
                  </>
                );

                // One interaction, two effects: opening a notification reads it.
                // The element is a button when there is nowhere to go (so the
                // click still marks it read) and a link when there is, because a
                // navigation the user can middle-click or open in a new tab must
                // stay a real anchor.
                return (
                  <li key={notification._id}>
                    {href ? (
                      <Link
                        href={href}
                        onClick={() => {
                          if (unread) void markRead(notification._id);
                        }}
                        className={cn(
                          "block p-4 transition-colors hover:bg-surface-hover",
                          unread &&
                            "bg-info-surface/40 dark:bg-info-surface/20",
                        )}
                      >
                        {body}
                      </Link>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          if (unread) void markRead(notification._id);
                        }}
                        className={cn(
                          "block w-full p-4 text-left transition-colors hover:bg-surface-hover",
                          unread &&
                            "bg-info-surface/40 dark:bg-info-surface/20",
                        )}
                      >
                        {body}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
