"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/shared/lib/cn";
import { formatCurrency } from "@/shared/lib/format";

interface PipelineStageSummary {
  stageId: string;
  stageName: string;
  count: number;
  totalValue: number;
  formattedValue: string;
}

interface PipelineSummaryProps {
  stages: PipelineStageSummary[];
  currency: string;
  loading?: boolean;
}

export function PipelineSummary({
  stages,
  currency,
  loading = false,
}: PipelineSummaryProps) {
  const totalCount = stages.reduce((sum, s) => sum + s.count, 0);
  const totalValue = stages.reduce((sum, s) => sum + s.totalValue, 0);

  if (loading) {
    return (
      <Card variant="outlined" aria-hidden="true">
        <CardHeader>
          <CardTitle>Pipeline Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className="space-y-3"
            role="status"
            aria-label="Loading pipeline summary"
          >
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-4">
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
            <div className="border-t border-line pt-3 mt-3 flex items-center justify-between">
              <Skeleton className="h-4 w-20" />
              <div className="flex items-center gap-4 text-right">
                <Skeleton className="h-4 w-16 text-right" />
                <Skeleton className="h-4 w-24 text-right" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined">
      <CardHeader>
        <CardTitle>Pipeline Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {stages.length > 0 ? (
            <>
              <div
                role="table"
                aria-label="Pipeline stages"
                className="overflow-x-auto"
              >
                <div role="rowgroup" className="space-y-3">
                  {stages.map((stage) => (
                    <div
                      key={stage.stageId}
                      role="row"
                      className="flex items-center justify-between gap-4"
                    >
                      <div
                        role="cell"
                        className="flex items-center gap-3 min-w-0 flex-1"
                      >
                        <div
                          role="img"
                          aria-label={`${stage.stageName} stage`}
                          className="h-2 w-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: "var(--bn-info)" }}
                        />
                        <span className="text-sm font-medium text-ink-900 dark:text-ink-50 truncate">
                          {stage.stageName}
                        </span>
                      </div>
                      <div
                        role="cell"
                        className="flex items-center gap-4 text-right whitespace-nowrap"
                      >
                        <span
                          className="font-mono tabular-nums text-sm text-ink-900 dark:text-ink-50"
                          aria-label={`${stage.count} deals`}
                        >
                          {stage.count}
                        </span>
                        <span
                          className="font-mono tabular-nums text-sm font-medium text-ink-900 dark:text-ink-50"
                          aria-label={`${stage.formattedValue} value`}
                        >
                          {stage.formattedValue}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div
                role="row"
                className="border-t border-line pt-3 mt-3 flex items-center justify-between"
              >
                <span
                  role="cell"
                  className="text-sm font-semibold text-ink-900 dark:text-ink-50"
                >
                  Total
                </span>
                <div
                  role="cell"
                  className="flex items-center gap-4 text-right whitespace-nowrap"
                >
                  <span
                    className="font-mono tabular-nums text-sm font-semibold text-ink-900 dark:text-ink-50"
                    aria-label={`${totalCount} total deals`}
                  >
                    {totalCount}
                  </span>
                  <span
                    className="font-mono tabular-nums text-sm font-semibold text-ink-900 dark:text-ink-50"
                    aria-label={`Total value ${formatCurrency(totalValue, currency)}`}
                  >
                    {formatCurrency(totalValue, currency)}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <div
              className="text-center py-8 text-ink-500 dark:text-ink-400"
              role="status"
            >
              No open deals in pipeline
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
