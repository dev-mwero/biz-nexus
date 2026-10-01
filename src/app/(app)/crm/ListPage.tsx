"use client";

import { formatDistanceToNow } from "date-fns";
import {
  Building2,
  ChevronDown,
  ChevronUp,
  Edit,
  Eye,
  Filter,
  Loader2,
  Mail,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  Tag as TagIcon,
  Trash2,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState } from "react";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
  statusBadgeConfig?: Record<
    string,
    { variant: "default" | "success" | "warning" | "danger" | "outline" }
  >;
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [meta, setMeta] = useState({
    page: 1,
    pageSize: 20,
    total: 0,
    totalPages: 0,
  });
  const [sort, setSort] = useState(defaultSort);
  const [filters, setFilters] = useState(defaultFilters);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Build URL search params
  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (debouncedSearch) params.set("q", debouncedSearch);
    params.set("page", meta.page.toString());
    params.set("pageSize", meta.pageSize.toString());
    params.set("sort", sort);
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    return params;
  }, [debouncedSearch, meta.page, meta.pageSize, sort, filters]);

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

  // Load on param changes
  const paramKey = useMemo(() => buildParams().toString(), [buildParams]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const loadEffect = useCallback(() => {
    loadData();
  }, [paramKey, loadData]);

  // We use a useEffect-like pattern with key
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentional
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { 0: _ } = useState(loadEffect);

  const handleSort = (key: string) => {
    if (sort === key) {
      setSort(`-${key}`);
    } else if (sort === `-${key}`) {
      setSort(key);
    } else {
      setSort(key);
    }
    setFilters((f) => ({ ...f, page: 1 }));
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilters((f) => ({ ...f, [key]: value, page: 1 }));
  };

  const handleSearch = (value: string) => {
    setSearch(value);
    // Debounce
    const timeout = setTimeout(() => {
      setDebouncedSearch(value);
      setFilters((f) => ({ ...f, page: 1 }));
    }, 300);
    return () => clearTimeout(timeout);
  };

  const handlePageChange = (page: number) => {
    setFilters((f) => ({ ...f, page }));
  };

  const handlePageSizeChange = (pageSize: number) => {
    setFilters((f) => ({ ...f, pageSize, page: 1 }));
  };

  const getSortIcon = (key: string) => {
    if (sort === key) return <ChevronUp className="h-4 w-4" />;
    if (sort === `-${key}`) return <ChevronDown className="h-4 w-4" />;
    return null;
  };

  const renderStatusBadge = (status: string) => {
    const config = statusBadgeConfig[status] || { variant: "outline" };
    return <Badge variant={config.variant}>{status}</Badge>;
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
          <Button asChild>
            <a href={createUrl} className="flex items-center gap-2">
              <Plus className="h-4 w-4" />
              New
            </a>
          </Button>
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
                          <DropdownMenuTrigger asChild>
                            <IconButton
                              variant="ghost"
                              size="sm"
                              aria-label="More actions"
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </IconButton>
                          </DropdownMenuTrigger>
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
