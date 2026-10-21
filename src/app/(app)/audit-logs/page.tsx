"use client";

import { History, ScrollText, ShieldAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  Field,
  FieldLabel,
  Input,
  Pagination,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui";
import { useSession } from "@/shared/auth/session-client";
import { formatDateTime } from "@/shared/lib/format";

/**
 * The audit-log screen.
 *
 * Read-only, and deliberately so: `docs/PLAN.md` §1K records that Phase 1 shipped
 * the `GET /api/v1/audit-logs` endpoint, the model and the permission but no
 * screen. This is that screen.
 *
 * The permission is `auditLogs.read`, which only the OWNER system role holds, so
 * the page checks it from the session before it fetches and shows a forbidden
 * state rather than firing a request the server would answer with a 403. That is
 * a UX decision, not a security one — the API enforces the same permission and is
 * the only thing standing between a caller and another organisation's history.
 */

interface AuditLogRow {
  _id: string;
  createdAt: string;
  actorName: string;
  action: string;
  entityType: string;
  entityId: string | null;
  entityLabel: string | null;
  ip: string | null;
}

const ACTION_OPTIONS = [
  { value: "all", label: "All actions" },
  { value: "create", label: "Created" },
  { value: "update", label: "Updated" },
  { value: "delete", label: "Deleted" },
  { value: "stage_change", label: "Stage change" },
  { value: "settings.update", label: "Settings update" },
];

const PAGE_SIZE = 20;

export default function AuditLogsPage() {
  const { data: session } = useSession();
  const canRead = session?.permissions?.includes("auditLogs.read") ?? false;

  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [entityType, setEntityType] = useState("");
  const [entityId, setEntityId] = useState("");
  const [action, setAction] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(targetPage),
          pageSize: String(PAGE_SIZE),
          sort: "-createdAt",
        });
        if (entityType.trim()) params.set("entityType", entityType.trim());
        if (entityId.trim()) params.set("entityId", entityId.trim());
        if (action !== "all") params.set("action", action);
        if (from) params.set("from", new Date(from).toISOString());
        if (to) params.set("to", new Date(to).toISOString());

        const res = await fetch(`/api/v1/audit-logs?${params.toString()}`);
        if (!res.ok) {
          if (res.status === 403 || res.status === 401) {
            throw new Error(
              "You do not have permission to view the audit log.",
            );
          }
          throw new Error("Failed to load the audit log.");
        }

        const body = await res.json();
        setLogs(body.data ?? []);
        setTotal(body.meta?.total ?? 0);
        setTotalPages(body.meta?.totalPages ?? 0);
        setPage(body.meta?.page ?? targetPage);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load the audit log.",
        );
        setLogs([]);
      } finally {
        setLoading(false);
      }
    },
    [entityType, entityId, action, from, to],
  );

  useEffect(() => {
    if (canRead) void load(1);
  }, [canRead, load]);

  if (!canRead) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card variant="outlined">
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div
              className="grid size-12 place-items-center rounded-lg border border-line bg-surface-sunken text-ink-400"
              aria-hidden="true"
            >
              <ShieldAlert className="size-5" strokeWidth={1.75} />
            </div>
            <div className="space-y-1">
              <p className="font-display font-semibold text-ink-900 dark:text-ink-50">
                Not available
              </p>
              <p className="mx-auto max-w-sm text-sm text-ink-500 dark:text-ink-400">
                The audit log is visible to organisation owners only.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasFilters = Boolean(
    entityType.trim() || entityId.trim() || action !== "all" || from || to,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div
          className="grid size-10 place-items-center rounded-lg border border-line bg-surface-sunken text-ink-500"
          aria-hidden="true"
        >
          <ScrollText className="size-5" strokeWidth={1.75} />
        </div>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50">
            Audit log
          </h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Every recorded change in this organisation, newest first.
          </p>
        </div>
      </div>

      <Card variant="outlined">
        <CardContent className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <Field>
            <FieldLabel>Entity type</FieldLabel>
            <Input
              value={entityType}
              onChange={(e) => setEntityType(e.target.value)}
              placeholder="contact, deal…"
            />
          </Field>
          <Field>
            <FieldLabel>Entity id</FieldLabel>
            <Input
              value={entityId}
              onChange={(e) => setEntityId(e.target.value)}
              placeholder="ObjectId"
            />
          </Field>
          <Field>
            <FieldLabel>Action</FieldLabel>
            <Select
              value={action}
              onValueChange={(value) => setAction(value ?? "all")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACTION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>From</FieldLabel>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel>To</FieldLabel>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </Field>
          <div className="sm:col-span-2 lg:col-span-5 flex justify-end gap-2">
            {hasFilters && (
              <Button
                variant="ghost"
                onClick={() => {
                  setEntityType("");
                  setEntityId("");
                  setAction("all");
                  setFrom("");
                  setTo("");
                }}
              >
                Clear
              </Button>
            )}
            <Button variant="secondary" onClick={() => void load(1)}>
              Apply filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <div
          role="alert"
          className="rounded-md border border-critical bg-critical/10 p-4 text-sm text-critical"
        >
          {error}
        </div>
      )}

      <Card variant="outlined">
        {loading && logs.length === 0 ? (
          <CardContent className="space-y-2 p-4">
            {["a", "b", "c", "d", "e", "f"].map((key) => (
              <Skeleton key={key} className="h-9 w-full" />
            ))}
          </CardContent>
        ) : logs.length === 0 ? (
          <CardContent className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div
              className="grid size-12 place-items-center rounded-lg border border-line bg-surface-sunken text-ink-400"
              aria-hidden="true"
            >
              <History className="size-5" strokeWidth={1.75} />
            </div>
            <div className="space-y-1">
              <p className="font-display font-semibold text-ink-900 dark:text-ink-50">
                No audit entries
              </p>
              <p className="mx-auto max-w-sm text-sm text-ink-500 dark:text-ink-400">
                {hasFilters
                  ? "No entries match these filters."
                  : "Changes will appear here as your team works."}
              </p>
            </div>
          </CardContent>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>IP</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log._id}>
                    <TableCell className="whitespace-nowrap">
                      {formatDateTime(log.createdAt)}
                    </TableCell>
                    <TableCell>{log.actorName}</TableCell>
                    <TableCell>
                      <Badge tone="neutral" size="sm">
                        {log.action}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="capitalize">{log.entityType}</span>
                      {(log.entityLabel || log.entityId) && (
                        <span className="ml-2 text-xs text-ink-400 dark:text-ink-500">
                          {log.entityLabel ?? log.entityId?.slice(-8)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-ink-500 dark:text-ink-400">
                      {log.ip ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <CardContent className="flex items-center justify-between border-t border-line">
              <p className="text-sm text-ink-500 dark:text-ink-400">
                {total} {total === 1 ? "entry" : "entries"}
              </p>
              <Pagination
                page={page}
                totalPages={totalPages}
                onPageChange={(next) => void load(next)}
              />
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}
