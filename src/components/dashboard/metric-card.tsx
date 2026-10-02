"use client";

import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/shared/lib/cn";
import { formatCurrency } from "@/shared/lib/format";

interface MetricCardProps {
  title: string;
  value: number | string;
  formattedValue?: string;
  trend?: { value: number; label: string };
  icon?: React.ReactNode;
  loading?: boolean;
  currency?: string;
  compact?: boolean;
  /**
   * Landed on the card, because the card is the grid item.
   *
   * A span class handed to a wrapper `div` would size the wrapper instead, and
   * the wrapper — not the card — would take the row's stretched height, leaving
   * a short card sitting next to a tall one. Grid placement and grid height are
   * two questions about the same box, so they are answered on the same box.
   */
  className?: string;
}

export function MetricCard({
  title,
  value,
  formattedValue,
  trend,
  icon,
  loading = false,
  currency = "USD",
  compact = false,
  className,
}: MetricCardProps) {
  const displayValue = loading
    ? null
    : (formattedValue ??
      (typeof value === "number" ? formatCurrency(value, currency) : value));

  const trendValue = trend?.value ?? 0;
  const trendLabel = trend?.label ?? "";

  return (
    <Card variant="outlined" className={className}>
      <CardContent className={cn("pt-4", compact && "pb-3")}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-2xs font-semibold tracking-[0.06em] uppercase text-ink-500 dark:text-ink-400",
                compact && "text-[10px]",
              )}
            >
              {title}
            </p>
            {loading ? (
              <Skeleton className="h-8 w-3/4 mt-1" aria-hidden="true" />
            ) : (
              <p
                className={cn(
                  "font-mono font-semibold tabular-nums text-ink-900 dark:text-ink-50 mt-1",
                  compact && "text-xl",
                  !compact && "text-3xl",
                )}
              >
                {displayValue}
              </p>
            )}
            {trend && !loading && (
              <div
                className={cn(
                  "flex items-center gap-1 mt-2",
                  compact && "text-xs",
                  !compact && "text-sm",
                )}
              >
                <span className="sr-only">
                  {trendValue > 0
                    ? "Trending up"
                    : trendValue < 0
                      ? "Trending down"
                      : "No change"}
                </span>
                {trendValue > 0 ? (
                  <TrendingUp
                    className={cn(
                      "text-positive",
                      compact && "size-3",
                      !compact && "size-4",
                    )}
                    aria-hidden="true"
                  />
                ) : trendValue < 0 ? (
                  <TrendingDown
                    className={cn(
                      "text-critical",
                      compact && "size-3",
                      !compact && "size-4",
                    )}
                    aria-hidden="true"
                  />
                ) : (
                  <Minus
                    className={cn(
                      "text-ink-400",
                      compact && "size-3",
                      !compact && "size-4",
                    )}
                    aria-hidden="true"
                  />
                )}
                <span
                  className={cn(
                    "font-medium",
                    trendValue > 0 && "text-positive",
                    trendValue < 0 && "text-critical",
                    trendValue === 0 && "text-ink-500",
                  )}
                >
                  {trendValue > 0 ? "+" : ""}
                  {trendValue.toFixed(1)}%
                </span>
                <span className="text-ink-400 dark:text-ink-500">
                  {trendLabel}
                </span>
              </div>
            )}
          </div>
          {icon && !loading && (
            <div
              className={cn(
                "flex-shrink-0 text-ink-300 dark:text-ink-700",
                compact && "size-8",
                !compact && "size-10",
              )}
              aria-hidden="true"
            >
              {icon}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function MetricCardSkeleton({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  // Takes a `className` for the same reason `MetricCard` does: the skeleton has
  // to occupy the cell the real card will occupy, or the grid reflows at the
  // moment the data arrives and the row a reader was already looking at moves.
  return (
    <Card variant="outlined" aria-hidden="true" className={className}>
      <CardContent className={cn("pt-4", compact && "pb-3")}>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-8 w-3/4 mt-2" />
            <Skeleton className="h-3 w-1/3 mt-2" />
          </div>
          <Skeleton
            className={cn(
              "flex-shrink-0 rounded-lg",
              compact && "size-8",
              !compact && "size-10",
            )}
          />
        </div>
      </CardContent>
    </Card>
  );
}
