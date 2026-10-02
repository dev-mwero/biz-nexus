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
    try {
      const params = buildParams();
      const result = await fetchData(params);
      setData(result.data);
      setMeta(result.meta);
    } catch (error) {
      console.error("Failed to fetch data:", error);
    } finally {
      setLoading(false);
    }
  }, [buildParams, fetchData]);

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

  const handleSearch = (value: string) => {
    setSearch(value);
    // Debounce
    const timeout = setTimeout(() => {
      setDebouncedSearch(value);
      setPagination((p) => ({ ...p, page: 1 }));
    }, 300);
    return () => clearTimeout(timeout);
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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
            className="pl-10"
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
        ) : data.length === 0 ? (
          <EmptyState
            title="No records found"
            description="Get started by creating your first record."
            action={
              createUrl ? { label: "Create", href: createUrl } : undefined
            }
          />
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => (
                    <TableHead
                      key={col.key}
                      style={{ width: col.width }}
                      className="cursor-pointer select-none"
                      onClick={() => col.sortable && handleSort(col.key)}
                    >
                      <div className="flex items-center gap-1">
                        {col.header}
                        {col.sortable && getSortIcon(col.key)}
                      </div>
                    </TableHead>
                  ))}
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
