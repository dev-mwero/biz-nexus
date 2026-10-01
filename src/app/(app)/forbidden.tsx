"use client";

import { ArrowLeft, Home, Lock, RefreshCw } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

interface ForbiddenProps {
  message?: string;
}

/**
 * App shell forbidden page.
 * Shown when the user is authenticated but lacks permission for a resource within the app.
 */
export default function AppForbidden({ message }: ForbiddenProps) {
  return (
    <AppShell>
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 size-16 rounded-full bg-critical-surface flex items-center justify-center">
            <Lock className="size-8 text-critical" aria-hidden="true" />
          </div>

          <h1 className="font-display text-3xl font-semibold text-ink-900 dark:text-ink-50 mb-2">
            Access denied
          </h1>

          <p className="text-ink-500 dark:text-ink-400 mb-6">
            You don&apos;t have permission to access this resource.
          </p>

          {message && (
            <div className="mb-6 p-4 bg-surface-sunken dark:bg-surface-raised rounded-lg text-left">
              <p className="text-sm text-ink-600 dark:text-ink-400">
                {message}
              </p>
            </div>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              variant="primary"
              onClick={() => window.history.back()}
              className="w-full sm:w-auto"
            >
              <RefreshCw className="size-4 mr-2" aria-hidden="true" />
              Go back
            </Button>
            <Link href="/app/dashboard">
              <Button variant="secondary" className="w-full sm:w-auto">
                <Home className="size-4 mr-2" aria-hidden="true" />
                Dashboard
              </Button>
            </Link>
            <Button
              variant="ghost"
              onClick={() => window.history.back()}
              className="w-full sm:w-auto"
            >
              <ArrowLeft className="size-4 mr-2" aria-hidden="true" />
              Previous page
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
