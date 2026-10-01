"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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

const LOADING_ROW_KEYS = ["row-1", "row-2", "row-3", "row-4", "row-5"] as const;

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
          <div className="space-y-3" aria-live="polite" aria-atomic="true">
            {LOADING_ROW_KEYS.map((key) => (
              <div
                key={key}
                className="flex items-center justify-between gap-4"
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
              <table
                aria-label="Pipeline stages"
                className="w-full overflow-x-auto border-collapse"
              >
                <thead className="sr-only">
                  <tr>
                    <th scope="col">Stage</th>
                    <th scope="col">Deals</th>
                    <th scope="col">Value</th>
                  </tr>
                </thead>
                <tbody className="space-y-3">
                  {stages.map((stage) => (
                    <tr
                      key={stage.stageId}
                      className="flex items-center justify-between gap-4"
                    >
                      <td className="flex items-center gap-3 min-w-0 flex-1">
                        <span
                          role="img"
                          aria-label={`${stage.stageName} stage`}
                          className="h-2 w-2 rounded-full flex-shrink-0"
                          style={{ backgroundColor: "var(--bn-info)" }}
                        />
                        <span className="text-sm font-medium text-ink-900 dark:text-ink-50 truncate">
                          {stage.stageName}
                        </span>
                      </td>
                      <td className="flex items-center gap-4 text-right whitespace-nowrap">
                        <span className="font-mono tabular-nums text-sm text-ink-900 dark:text-ink-50">
                          {stage.count}
                          <span className="sr-only"> deals</span>
                        </span>
                        <span className="font-mono tabular-nums text-sm font-medium text-ink-900 dark:text-ink-50">
                          {stage.formattedValue}
                          <span className="sr-only"> value</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="border-t border-line pt-3 mt-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-ink-900 dark:text-ink-50">
                    Total
                  </span>
                  <div className="flex items-center gap-4 text-right whitespace-nowrap">
                    <span className="font-mono tabular-nums text-sm font-semibold text-ink-900 dark:text-ink-50">
                      {totalCount}
                      <span className="sr-only"> total deals</span>
                    </span>
                    <span className="font-mono tabular-nums text-sm font-semibold text-ink-900 dark:text-ink-50">
                      {formatCurrency(totalValue, currency)}
                      <span className="sr-only"> total value</span>
                    </span>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div
              className="text-center py-8 text-ink-500 dark:text-ink-400"
              aria-live="polite"
              aria-atomic="true"
            >
              No open deals in pipeline
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
