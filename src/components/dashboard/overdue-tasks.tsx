"use client";

import { AlertTriangle, ArrowRight, Clock } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/shared/lib/cn";

interface OverdueTasksProps {
  count: number;
  loading?: boolean;
}

/**
 * The count is the whole story, because the count is all there is.
 *
 * The dashboard endpoint's `overdueTasks` facet is a `$count` pipeline stage: it
 * returns how many open tasks are past their due date and no task documents
 * with it. This card used to take a `tasks` prop and render the first five rows
 * of it, but the only caller passed an empty array and no query in the codebase
 * could ever fill it — so any non-zero count produced a title badge reading "3
 * overdue tasks" above a completely empty body, with the "View all" link gated
 * behind a `tasks.length > 5` that could never be satisfied either.
 *
 * Rather than render a list the system cannot deliver, the count is the
 * primary content and the card points at the tasks page, which is where the
 * detail actually lives. Adding a facet to return the rows is a real fix, but
 * it belongs to the API rather than to a presentational component, and until
 * then the honest summary is worth more than an empty promise.
 */
export function OverdueTasks({ count, loading = false }: OverdueTasksProps) {
  if (loading) {
    return (
      <Card variant="outlined" aria-hidden="true">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4" aria-hidden="true" />
            Overdue Tasks
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* The skeleton mirrors the real body — a figure over an action —
              because a list-shaped placeholder in front of a single number
              spends a screen's worth of vertical space promising rows that
              never arrive, then yanks the card out from under the reader. */}
          <div className="flex flex-col items-center gap-3 py-6">
            <Skeleton className="h-10 w-16" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-8 w-28" />
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
        </CardTitle>
      </CardHeader>
      <CardContent>
        {count === 0 ? (
          <div
            className="text-center py-8"
            aria-live="polite"
            aria-atomic="true"
          >
            <Clock
              className="size-12 mx-auto text-ink-300 dark:text-ink-600 mb-2"
              aria-hidden="true"
            />
            <p className="text-ink-500 dark:text-ink-400">No overdue tasks</p>
          </div>
        ) : (
          <div
            className="flex flex-col items-center gap-3 py-6 text-center"
            aria-live="polite"
            aria-atomic="true"
          >
            <p className="font-mono text-4xl font-semibold tabular-nums text-attention">
              {count.toLocaleString()}
            </p>
            <p className="text-sm text-ink-500 dark:text-ink-400">
              {count === 1
                ? "task is past its due date"
                : "tasks are past their due dates"}
            </p>
            <ButtonLink href="/tasks" variant="secondary" size="sm">
              View tasks
              <ArrowRight className="size-4" aria-hidden="true" />
            </ButtonLink>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
