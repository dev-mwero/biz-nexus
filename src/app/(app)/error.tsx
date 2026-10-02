"use client";

import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * Error boundary for the (app) route group.
 * Catches rendering errors in any child route.
 */
export default function AppError({ error, reset }: ErrorProps) {
  useEffect(() => {
    // Log the error to the console for debugging
    console.error("[App Error]", error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-canvas">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 size-16 rounded-full bg-critical-surface flex items-center justify-center">
          <AlertTriangle className="size-8 text-critical" aria-hidden="true" />
        </div>

        <h1 className="font-display text-2xl font-semibold text-ink-900 dark:text-ink-50 mb-2">
          Something went wrong
        </h1>

        <p className="text-ink-500 dark:text-ink-400 mb-6">
          We encountered an unexpected error. Please try refreshing the page or
          navigate back to the dashboard.
        </p>

        {error.digest && (
          <details className="mb-6 text-left">
            <summary className="text-xs text-ink-400 cursor-pointer hover:text-ink-600">
              Error details (for support)
            </summary>
            <pre className="mt-2 p-3 text-xs bg-surface-sunken dark:bg-surface-raised rounded text-ink-500 overflow-auto max-h-32">
              {error.digest}
            </pre>
          </details>
        )}

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Button
            variant="primary"
            onClick={reset}
            className="w-full sm:w-auto"
          >
            <RefreshCw className="size-4 mr-2" aria-hidden="true" />
            Try again
          </Button>
          <Link href="/dashboard">
            <Button variant="secondary" className="w-full sm:w-auto">
              <Home className="size-4 mr-2" aria-hidden="true" />
              Go to Dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
