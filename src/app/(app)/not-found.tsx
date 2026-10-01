import { ArrowLeft, Home, Search } from "lucide-react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";

/**
 * App shell not-found page.
 * Shown when a route within the authenticated app shell doesn't match.
 */
export default function AppNotFound() {
  return (
    <AppShell>
      <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center">
          <div className="mx-auto mb-6 size-16 rounded-full bg-info-surface flex items-center justify-center">
            <Search className="size-8 text-info" aria-hidden="true" />
          </div>

          <h1 className="font-display text-3xl font-semibold text-ink-900 dark:text-ink-50 mb-2">
            Page not found
          </h1>

          <p className="text-ink-500 dark:text-ink-400 mb-8">
            Sorry, we couldn&apos;t find that page. It might have been moved or
            doesn&apos;t exist.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link href="/app/dashboard">
              <Button variant="primary" className="w-full sm:w-auto">
                <Home className="size-4 mr-2" aria-hidden="true" />
                Go to Dashboard
              </Button>
            </Link>
            <Link href="/app/search">
              <Button variant="secondary" className="w-full sm:w-auto">
                <Search className="size-4 mr-2" aria-hidden="true" />
                Search
              </Button>
            </Link>
            <Button
              variant="ghost"
              onClick={() => window.history.back()}
              className="w-full sm:w-auto"
            >
              <ArrowLeft className="size-4 mr-2" aria-hidden="true" />
              Go back
            </Button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
