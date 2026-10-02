"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MetricCard, MetricCardSkeleton } from "./metric-card";
import { OverdueTasks } from "./overdue-tasks";
import { PipelineSummary } from "./pipeline-summary";
import { RecentActivity } from "./recent-activity";

interface DashboardData {
  metricCards: {
    dealsWonThisMonth: number;
    dealsLostThisMonth: number;
    pipelineValue: number;
    formattedPipelineValue: string;
    leadConversionRate: number;
    winRate: number;
  };
  pipelineSummary: Array<{
    stageId: string;
    stageName: string;
    count: number;
    totalValue: number;
    formattedValue: string;
  }>;
  overdueTasks: number;
  recentActivity: Array<{
    _id: string;
    title: string;
    type: string;
    occurredAt: string;
    metadata?: Record<string, unknown>;
  }>;
}

const METRIC_GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3";
/**
 * Five metrics in a grid of four left a row with one card in it and three empty
 * cells, which reads as a failed render rather than a layout. Three columns
 * fills every cell at `lg` when the fifth card spans two, and the same span
 * makes it full-width at `sm` — the odd card out is the one that stretches, so
 * the raggedness lands somewhere deliberate instead of at the end of the grid.
 */
const WIDE_METRIC_CARD = "sm:col-span-2 lg:col-span-2";

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/api/v1/dashboard");
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message ?? "Failed to load dashboard");
      }
      const result = await response.json();
      setData(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <section
        className="space-y-6"
        aria-live="polite"
        aria-atomic="true"
        aria-label="Loading dashboard"
      >
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-semibold text-ink-900 dark:text-ink-50">
              Dashboard
            </h1>
            <p className="text-sm text-ink-500 dark:text-ink-400">
              Overview of your pipeline and tasks
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            disabled
            aria-label="Refreshing"
            aria-busy="true"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          </Button>
        </div>

        <section className={METRIC_GRID} aria-label="Metric cards">
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton />
          <MetricCardSkeleton className={WIDE_METRIC_CARD} />
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <PipelineSummary stages={[]} formattedTotalValue="" loading />
            <OverdueTasks count={0} tasks={[]} loading />
          </div>
          <div className="lg:col-span-1">
            <RecentActivity activities={[]} loading />
          </div>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <div className="space-y-6" role="alert">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-900 dark:text-ink-50">
            Dashboard
          </h1>
        </div>
        <div className="p-8 text-center">
          <p className="text-critical mb-4">Failed to load dashboard</p>
          <p className="text-sm text-ink-500 dark:text-ink-400 mb-4">{error}</p>
          <Button
            variant="primary"
            onClick={() => {
              setLoading(true);
              fetchData();
            }}
          >
            <RefreshCw className="size-4 mr-2" aria-hidden="true" />
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const { metricCards, pipelineSummary, overdueTasks, recentActivity } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-900 dark:text-ink-50">
            Dashboard
          </h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Overview of your pipeline and tasks
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            setLoading(true);
            fetchData();
          }}
          aria-label="Refresh dashboard"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <section aria-labelledby="metrics-heading" className="space-y-4">
        <h2 id="metrics-heading" className="sr-only">
          Key Metrics
        </h2>
        <div className={METRIC_GRID}>
          <MetricCard
            title="Deals Won This Month"
            value={metricCards.dealsWonThisMonth}
            icon={
              <svg
                className="text-positive"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            }
          />
          <MetricCard
            title="Deals Lost This Month"
            value={metricCards.dealsLostThisMonth}
            icon={
              <svg
                className="text-critical"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            }
          />
          <MetricCard
            title="Pipeline Value"
            value={metricCards.pipelineValue}
            formattedValue={metricCards.formattedPipelineValue}
            icon={
              <svg
                className="text-info"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
              </svg>
            }
          />
          <MetricCard
            title="Lead Conversion Rate"
            value={`${metricCards.leadConversionRate}%`}
            icon={
              <svg
                className="text-positive"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M18 15l-6-6-6 6" />
              </svg>
            }
          />
          <MetricCard
            // Win rate was computed, rounded and shipped in the payload since
            // before any of these cards existed, and rendered by none of them.
            // That is the metric that would have made the old contradiction
            // visible — the two counts could not add up to its denominator — so
            // hiding it left the inconsistency with nothing to expose it.
            title="Win Rate"
            value={`${metricCards.winRate}%`}
            className={WIDE_METRIC_CARD}
            icon={
              <svg
                className="text-positive"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="4" />
              </svg>
            }
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="pipeline-heading" className="space-y-4">
          <h2 id="pipeline-heading" className="sr-only">
            Pipeline & Tasks
          </h2>
          <PipelineSummary
            stages={pipelineSummary}
            formattedTotalValue={metricCards.formattedPipelineValue}
          />
          <OverdueTasks count={overdueTasks} tasks={[]} />
        </section>
        <section aria-labelledby="activity-heading" className="lg:col-span-1">
          <h2 id="activity-heading" className="sr-only">
            Recent Activity
          </h2>
          <RecentActivity activities={recentActivity} />
        </section>
      </div>
    </div>
  );
}
