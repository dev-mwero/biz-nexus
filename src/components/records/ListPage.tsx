"use client";

import { formatDistanceToNow } from "date-fns";
import {
  ChevronDown,
  ChevronUp,
  Filter,
  Loader2,
  MoreHorizontal,
  Plus,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  type BadgeProps,
  Button,
  ButtonLink,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  IconButton,
  Input,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Toaster,
} from "@/components/ui";
import { cn } from "@/shared/lib/cn";

interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
  width?: string;
}

/**
 * Tone vocabulary of the badge primitive. `Badge` deliberately has no
 * `variant` prop, so call sites name a tone instead of an ad-hoc style.
 */
type StatusTone = NonNullable<BadgeProps["tone"]>;

interface ListPageProps<T> {
  title: string;
  description?: string;
  columns: Column<T>[];
  fetchData: (params: URLSearchParams) => Promise<{
    data: T[];
    meta: { page: number; pageSize: number; total: number; totalPages: number };
  }>;
  createUrl?: string;
  rowActions?: (row: T) => React.ReactNode;
  defaultSort?: string;
  defaultFilters?: Record<string, string>;
  searchPlaceholder?: string;
  filterOptions?: {
    key: string;
    label: string;
    options: { value: string; label: string }[];
  }[];
  statusBadgeConfig?: Record<string, { tone: StatusTone }>;
}

export function ListPage<T extends { _id: string; createdAt: string | Date }>({
  title,
  description,
  columns,
  fetchData,
  createUrl,
  rowActions,
  defaultSort = "-createdAt",
  defaultFilters = {},
  searchPlaceholder = "Search...",
  filterOptions = [],
  statusBadgeConfig = {},
}: ListPageProps<T>) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  // Pagination is request state, not a filter: it is what the next fetch asks
  // for. Keeping it out of `filters` stops it being written into the query
  // string as if it were a record field.
  const [pagination, setPagination] = useState({ page: 1, pageSize: 20 });
  const [sort, setSort] = useState(defaultSort);
  const [filters, setFilters] =
    useState<Record<string, string>>(defaultFilters);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  /**
   * True when the empty result is caused by something the user chose rather
   * than by the collection being empty. Only this state gets a "Clear filters"
   * escape hatch.
   */
  const isFiltered =
    debouncedSearch.length > 0 ||
    Object.values(filters).some((value) => value !== "");

  // Build URL search params
  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("q", debouncedSearch);
    params.set("page", pagination.page.toString());
    params.set("pageSize", pagination.pageSize.toString());
    params.set("sort", sort);
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params;
  }, [debouncedSearch, pagination.page, pagination.pageSize, sort, filters]);

  // Fetch data
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = buildParams();
      const result = await fetchData(params);
      setData(result.data || []);
      setMeta(
        result.meta || {
          page: pagination.page,
          pageSize: pagination.pageSize,
          total: result.data?.length || 0,
        },
      );
    } catch (err) {
      console.error("Failed to fetch data:", err);
      setError(err instanceof Error ? err.message : "Failed to fetch data");
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [buildParams, fetchData, pagination.page, pagination.pageSize]);

  // `loadData` is rebuilt whenever the query changes (search, filters, sort or
  // pagination), so re-running the effect is what refetches.
  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSort = (key: string) => {
    if (sort === key) {
      setSort(`-${key}`);
    } else if (sort === `-${key}`) {
      setSort(key);
    } else {
      setSort(key);
    }
    setPagination((p) => ({ ...p, page: 1 }));
  };

  /**
   * Base UI reports a cleared select as `null`. "Cleared" means no filter for
   * this key, which is what an empty option value already means, so `null` is
   * normalised to `""` rather than being pushed into the query string.
   */
  const handleFilterChange = (key: string, value: string | null) => {
    setFilters((f) => ({ ...f, [key]: value ?? "" }));
    setPagination((p) => ({ ...p, page: 1 }));
  };

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebouncedSearch(search);
      setPagination((p) => ({ ...p, page: 1 }));
    }, 300);
    return () => clearTimeout(timeout);
  }, [search]);

  const handleSearch = (value: string) => {
    setSearch(value);
  };

  const handlePageChange = (page: number) => {
    setPagination((p) => ({ ...p, page }));
  };

  const getSortIcon = (key: string) => {
    if (sort === key) return <ChevronUp className="h-4 w-4" />;
    if (sort === `-${key}`) return <ChevronDown className="h-4 w-4" />;
    return null;
  };

  // Kept as the single renderer for `statusBadgeConfig`; a caller that maps
  // statuses inline in a column renderer is what currently bypasses it.
  const renderStatusBadge = (status: string) => {
    const config = statusBadgeConfig[status] || { tone: "outline" as const };
    return <Badge tone={config.tone}>{status}</Badge>;
  };

  return (
    <div className="flex flex-col h-full gap-4">
      <Toaster />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink-900">{title}</h1>
          {description && (
            <p className="text-sm text-ink-500 mt-1">{description}</p>
          )}
        </div>
        {createUrl && (
          <ButtonLink href={createUrl} className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            New
          </ButtonLink>
        )}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-md">
          <label htmlFor="list-search" className="sr-only">
            {searchPlaceholder}
          </label>
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400"
            aria-hidden="true"
          />
          <Input
            id="list-search"
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-10"
            aria-label={searchPlaceholder}
          />
        </div>

        {filterOptions.map((filter) => (
          <Select
            key={filter.key}
            value={filters[filter.key] || ""}
            onValueChange={(v) => handleFilterChange(filter.key, v)}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder={filter.label} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All</SelectItem>
              {filter.options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}

        {Object.keys(filters).some((k) => filters[k]) && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilters(defaultFilters)}
          >
            <Filter className="h-4 w-4 mr-1" />
            Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        {loading ? (
          <div className="p-8 flex justify-center">
            <Spinner size="lg" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <p className="text-critical mb-4" role="alert">
              {error}
            </p>
            <Button
              variant="primary"
              onClick={() => {
                setLoading(true);
                loadData();
              }}
            >
              Try again
            </Button>
          </div>
        ) : data.length === 0 ? (
          /* "Nothing here yet" and "nothing matched what you asked for" are
             different states with different next actions. Offering "Create"
             to someone whose search excluded every row is a dead end. */
          isFiltered ? (
            <EmptyState
              title="No matching records"
              description={
                debouncedSearch
                  ? `Nothing matches “${debouncedSearch}”.`
                  : "No records match the current filters."
              }
              action={{
                label: "Clear filters",
                onClick: () => {
                  setSearch("");
                  setDebouncedSearch("");
                  setFilters(defaultFilters);
                },
              }}
            />
          ) : (
            <EmptyState
              title="No records found"
              description="Get started by creating your first record."
              action={
                createUrl ? { label: "Create", href: createUrl } : undefined
              }
            />
          )
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => {
                    const sortDirection =
                      sort === col.key
                        ? "ascending"
                        : sort === `-${col.key}`
                          ? "descending"
                          : "none";
                    return (
                      <TableHead
                        key={col.key}
                        style={{ width: col.width }}
                        // `aria-sort` is only meaningful on the header cell, and
                        // it is what a screen reader announces instead of the
                        // icon it cannot see.
                        aria-sort={col.sortable ? sortDirection : undefined}
                        className="select-none"
                      >
                        {col.sortable ? (
                          <button
                            type="button"
                            onClick={() => handleSort(col.key)}
                            className={cn(
                              "flex items-center gap-1 text-left font-medium",
                              "hover:text-ink-900 dark:hover:text-ink-50",
                              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-info",
                            )}
                          >
                            {col.header}
                            {getSortIcon(col.key)}
                          </button>
                        ) : (
                          <div className="flex items-center gap-1">
                            {col.header}
                          </div>
                        )}
                      </TableHead>
                    );
                  })}
                  {rowActions && (
                    <TableHead className="w-12 text-right">Actions</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => (
                  <TableRow key={row._id}>
                    {columns.map((col) => (
                      <TableCell key={col.key}>
                        {col.render
                          ? col.render(row)
                          : ((row as Record<string, unknown>)[
                              col.key
                            ]?.toString() ?? "—")}
                      </TableCell>
                    ))}
                    {rowActions && (
                      <TableCell className="text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={
                              <IconButton
                                variant="ghost"
                                size="sm"
                                aria-label="More actions"
                              >
                                <MoreHorizontal className="h-4 w-4" />
                              </IconButton>
                            }
                          />
                          <DropdownMenuContent align="end">
                            {rowActions(row)}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {/* Pagination */}
            {meta.totalPages > 1 && (
              <div className="px-4 py-3 border-t border-line flex items-center justify-between">
                <div className="text-sm text-ink-500">
                  Showing {(meta.page - 1) * meta.pageSize + 1} to{" "}
                  {Math.min(meta.page * meta.pageSize, meta.total)} of{" "}
                  {meta.total}
                </div>
                <Pagination
                  page={meta.page}
                  totalPages={meta.totalPages}
                  onPageChange={handlePageChange}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
