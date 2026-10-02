import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const METRIC_CARDS = ["metric-1", "metric-2", "metric-3", "metric-4"] as const;
const TABLE_ROWS = ["row-1", "row-2", "row-3", "row-4", "row-5"] as const;
const LIST_ROWS = ["row-1", "row-2", "row-3"] as const;
const ACTIVITY_ROWS = ["row-1", "row-2", "row-3", "row-4", "row-5"] as const;

/**
 * Loading UI for the (app) route group.
 * Shown while server components are streaming.
 */
export default function AppLoading() {
  return (
    <div className="min-h-screen bg-canvas">
      {/* Top bar skeleton */}
      <div className="h-16 border-b border-line" aria-hidden="true" />

      {/* Page content skeleton */}
      <main
        className="p-4 sm:p-6 lg:p-8"
        aria-busy="true"
        aria-label="Loading page"
      >
        <div className="space-y-6">
          {/* Header skeleton */}
          <div className="flex items-center justify-between">
            <div>
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-4 w-64 mt-2" />
            </div>
            <Skeleton className="h-9 w-20" />
          </div>

          {/* Metric cards skeleton */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {METRIC_CARDS.map((slot) => (
              <div
                key={slot}
                className="border border-line rounded-lg p-4 bg-surface"
              >
                <Skeleton className="h-3 w-1/4" />
                <Skeleton className="h-8 w-3/4 mt-2" />
                <Skeleton className="h-3 w-1/3 mt-2" />
              </div>
            ))}
          </div>

          {/* Main content skeleton */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-4">
              {/* Pipeline summary skeleton */}
              <div className="border border-line rounded-lg p-4 bg-surface">
                <Skeleton className="h-5 w-32 mb-4" />
                <div className="space-y-3">
                  {TABLE_ROWS.map((slot) => (
                    <div
                      key={slot}
                      className="flex items-center justify-between"
                    >
                      <div className="flex items-center gap-3">
                        <Skeleton className="h-2 w-8 rounded" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                      <div className="flex items-center gap-4 text-right">
                        <Skeleton className="h-4 w-16 text-right" />
                        <Skeleton className="h-4 w-24 text-right" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Overdue tasks skeleton */}
              <div className="border border-line rounded-lg p-4 bg-surface">
                <div className="flex items-center gap-2 mb-4">
                  <Skeleton className="h-5 w-5" />
                  <Skeleton className="h-5 w-24" />
                </div>
                <div className="space-y-3">
                  {LIST_ROWS.map((slot) => (
                    <div
                      key={slot}
                      className="flex items-center gap-3 p-3 rounded-lg bg-surface-sunken dark:bg-surface-raised"
                    >
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3 w-24 ml-auto" />
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Recent activity skeleton */}
            <div className="border border-line rounded-lg p-4 bg-surface lg:col-span-1">
              <Skeleton className="h-5 w-24 mb-4" />
              <div className="space-y-3">
                {ACTIVITY_ROWS.map((slot) => (
                  <div key={slot} className="flex items-start gap-3">
                    <Skeleton className="h-8 w-8 rounded-lg flex-shrink-0" />
                    <div className="flex-1 space-y-1">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                      <Skeleton className="h-3 w-1/4" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
