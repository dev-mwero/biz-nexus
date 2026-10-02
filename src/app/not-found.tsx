import { Home, Search } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

/**
 * Root not-found page.
 * Shown when no route matches at any level.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-canvas">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-6 size-16 rounded-full bg-info-surface flex items-center justify-center">
          <Search className="size-8 text-info" aria-hidden="true" />
        </div>

        <h1 className="font-display text-3xl font-semibold text-ink-900 dark:text-ink-50 mb-2">
          Page not found
        </h1>

        <p className="text-ink-500 dark:text-ink-400 mb-8">
          Sorry, we couldn&apos;t find the page you&apos;re looking for. It
          might have been moved or doesn&apos;t exist.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link href="/dashboard">
            <Button variant="primary" className="w-full sm:w-auto">
              <Home className="size-4 mr-2" aria-hidden="true" />
              Go to Dashboard
            </Button>
          </Link>
          <Link href="/search">
            <Button variant="secondary" className="w-full sm:w-auto">
              <Search className="size-4 mr-2" aria-hidden="true" />
              Search
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
