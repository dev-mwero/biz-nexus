"use client";

import {
  Building2,
  CheckSquare,
  Loader2,
  Search,
  Target,
  User,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/shared/lib/cn";

interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  entityType: "contact" | "company" | "deal" | "task";
  score: number;
  url: string;
  metadata?: Record<string, unknown>;
}

/** Placeholder cards shown while a search is in flight. */
const SEARCH_SKELETON_ROWS = [
  "row-1",
  "row-2",
  "row-3",
  "row-4",
  "row-5",
] as const;

const ENTITY_ICONS: Record<
  SearchResult["entityType"],
  React.ComponentType<{ className?: string }>
> = {
  contact: User,
  company: Building2,
  deal: Target,
  task: CheckSquare,
};

const ENTITY_LABELS: Record<SearchResult["entityType"], string> = {
  contact: "Contact",
  company: "Company",
  deal: "Deal",
  task: "Task",
};

export default function SearchPage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const performSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/v1/search?q=${encodeURIComponent(searchQuery)}`,
      );
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error?.message ?? "Search failed");
      }
      const data = await response.json();
      setResults(data.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setQuery(value);

    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (value.length >= 2) {
      searchTimeoutRef.current = setTimeout(() => {
        performSearch(value);
      }, 150);
    } else {
      setResults([]);
    }
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setError(null);
    inputRef.current?.focus();
  };

  if (!query) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink-900 dark:text-ink-50">
            Search
          </h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Find contacts, companies, deals, and tasks across your organization.
          </p>
        </div>

        <div className="relative max-w-2xl">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-ink-400"
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="search"
            placeholder="Search contacts, companies, deals, tasks..."
            className="w-full pl-10 pr-10 py-3 bg-surface border border-line rounded-lg text-base text-ink-900 dark:text-ink-50 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-info"
            aria-label="Global search"
            autoComplete="off"
            onChange={handleChange}
          />
        </div>

        <div className="text-center py-12 text-ink-500 dark:text-ink-400">
          <p>Start typing to search...</p>
          <p className="text-sm mt-2">Minimum 2 characters</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink-900 dark:text-ink-50">
          Search
        </h1>
        <p className="text-sm text-ink-500 dark:text-ink-400">
          Find contacts, companies, deals, and tasks across your organization.
        </p>
      </div>

      <div className="relative max-w-2xl">
        <Search
          className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-ink-400"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={handleChange}
          placeholder="Search contacts, companies, deals, tasks..."
          className="w-full pl-10 pr-10 py-3 bg-surface border border-line rounded-lg text-base text-ink-900 dark:text-ink-50 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-info"
          aria-label="Global search"
          autoComplete="off"
        />
        {query && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute right-2 top-1/2 -translate-y-1/2"
            onClick={handleClear}
            aria-label="Clear search"
          >
            <X className="size-4" />
          </Button>
        )}
      </div>

      {loading && (
        <output
          className="space-y-3 block"
          aria-live="polite"
          aria-label="Loading search results"
        >
          {SEARCH_SKELETON_ROWS.map((slot) => (
            <Card key={slot} variant="outlined">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Skeleton className="h-10 w-10 rounded-lg flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-5 w-1/2" />
                    <Skeleton className="h-4 w-1/3" />
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </output>
      )}

      {error && (
        <div
          className="p-4 bg-critical-surface border border-critical/20 rounded-lg"
          role="alert"
        >
          <p className="text-critical text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && results.length === 0 && query.length >= 2 && (
        <div className="py-12">
          <EmptyState
            icon={Search}
            title="No results found"
            description={`No matches for "${query}"`}
            compact
          />
        </div>
      )}

      {!loading && !error && results.length > 0 && (
        <section className="space-y-3" aria-label="Search results">
          {results.map((result) => {
            const Icon = ENTITY_ICONS[result.entityType];
            return (
              <Card
                key={result.id}
                variant="outlined"
                className="hover:border-info/50 transition-colors"
              >
                <CardContent className="p-4">
                  <a
                    href={result.url}
                    className="flex items-start gap-3 w-full"
                  >
                    <div
                      className={cn(
                        "flex h-10 w-10 items-center justify-center rounded-lg flex-shrink-0",
                        "bg-surface-sunken dark:bg-surface-raised",
                      )}
                      aria-hidden="true"
                    >
                      <Icon className="size-5 text-ink-500 dark:text-ink-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-ink-900 dark:text-ink-50 truncate">
                        {result.title}
                      </p>
                      {result.subtitle && (
                        <p className="text-sm text-ink-500 dark:text-ink-400 truncate mt-0.5">
                          {result.subtitle}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-1">
                        <span className="px-2 py-0.5 text-[10px] font-medium uppercase rounded bg-surface-sunken dark:bg-surface-raised text-ink-500">
                          {ENTITY_LABELS[result.entityType]}
                        </span>
                        <span className="text-xs text-ink-400 dark:text-ink-500 font-mono">
                          Score: {result.score.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </a>
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}
    </div>
  );
}
