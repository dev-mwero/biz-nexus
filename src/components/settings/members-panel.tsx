"use client";

import { LogOut, UserMinus, UserRoundCog, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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
import { formatDate } from "@/shared/lib/format";

/**
 * The member directory.
 *
 * One row per membership, from `GET /organizations/current/members`, with a
 * role select and suspend/remove actions. Every write is gated on the
 * permission the endpoint demands — `users.update` for a role change or a
 * suspension, `users.remove` for removal — so a viewer sees the directory and
 * no controls rather than controls that 403.
 *
 * The last-owner refusals are the server's (`409 OWNER_REQUIRED`), and they are
 * surfaced as a message rather than hidden: figuring out client-side whether
 * this row is the only owner is a second copy of a security rule, and the copy
 * that matters is the one in the service.
 *
 * `OWNER` is not in the role select. It is not assignable — granting a second
 * owner is an ownership transfer with its own permission — and offering it only
 * to have the request refused would misrepresent the rule.
 */

interface MemberRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  roleKey: string;
  status: string;
  title: string | null;
  joinedAt: string | null;
}

const ASSIGNABLE_ROLES = [
  { value: "ADMIN", label: "Admin" },
  { value: "MEMBER", label: "Member" },
  { value: "VIEWER", label: "Viewer" },
];

const ROLE_LABELS: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

export function MembersPanel({
  currentUserId,
  canUpdate,
  canRemove,
}: {
  currentUserId: string | null;
  canUpdate: boolean;
  canRemove: boolean;
}) {
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch(
        "/api/v1/organizations/current/members?includeSuspended=true",
      );
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const body = await res.json();
      setMembers(body.data ?? []);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(
    id: string,
    run: () => Promise<Response>,
    success: string,
  ) {
    setBusyId(id);
    setError(null);
    try {
      const res = await run();
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "That change could not be made.");
        return;
      }
      toast.success(success);
      await load();
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setBusyId(null);
    }
  }

  function changeRole(member: MemberRow, roleKey: string) {
    void mutate(
      member.id,
      () =>
        fetch(`/api/v1/organizations/current/members/${member.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roleKey }),
        }),
      `${member.name || member.email} is now a ${ROLE_LABELS[roleKey] ?? roleKey}.`,
    );
  }

  function toggleStatus(member: MemberRow) {
    const next = member.status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED";
    void mutate(
      member.id,
      () =>
        fetch(`/api/v1/organizations/current/members/${member.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: next }),
        }),
      next === "SUSPENDED"
        ? `${member.email} is suspended.`
        : `${member.email} is active again.`,
    );
  }

  function remove(member: MemberRow) {
    void mutate(
      member.id,
      () =>
        fetch(`/api/v1/organizations/current/members/${member.id}`, {
          method: "DELETE",
        }),
      `${member.email} was removed.`,
    );
  }

  function leave(member: MemberRow) {
    void mutate(
      member.id,
      () => fetch("/api/v1/organizations/current/leave", { method: "POST" }),
      "You have left the organisation.",
    );
  }

  return (
    <Card variant="outlined">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4" aria-hidden="true" />
          Members
        </CardTitle>
      </CardHeader>
      <CardContent>
        {error && (
          <p role="alert" className="mb-3 text-sm text-critical">
            {error}
          </p>
        )}

        {loading && members.length === 0 ? (
          <div className="space-y-2">
            {["a", "b", "c"].map((key) => (
              <Skeleton key={key} className="h-9 w-full" />
            ))}
          </div>
        ) : loadError ? (
          <div>
            <p role="alert" className="text-sm text-critical">
              Could not load the member directory.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => void load()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const isSelf = member.userId === currentUserId;
                const isBusy = busyId === member.id;

                return (
                  <TableRow key={member.id}>
                    <TableCell>
                      <div className="font-medium">
                        {member.name || "—"}
                        {isSelf && (
                          <span className="ml-2 text-xs text-ink-500">
                            (you)
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-ink-500 dark:text-ink-400">
                        {member.email}
                      </div>
                    </TableCell>

                    <TableCell>
                      {canUpdate && !isSelf ? (
                        <Select
                          value={member.roleKey}
                          onValueChange={(value) =>
                            value && changeRole(member, value)
                          }
                          disabled={isBusy || member.roleKey === "OWNER"}
                        >
                          <SelectTrigger className="w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ASSIGNABLE_ROLES.map((role) => (
                              <SelectItem key={role.value} value={role.value}>
                                {role.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge tone="neutral" size="sm">
                          {ROLE_LABELS[member.roleKey] ?? member.roleKey}
                        </Badge>
                      )}
                    </TableCell>

                    <TableCell>
                      <Badge
                        tone={
                          member.status === "ACTIVE"
                            ? "positive"
                            : member.status === "SUSPENDED"
                              ? "critical"
                              : "neutral"
                        }
                        size="sm"
                      >
                        {member.status}
                      </Badge>
                    </TableCell>

                    <TableCell className="text-ink-500">
                      {member.joinedAt ? formatDate(member.joinedAt) : "—"}
                    </TableCell>

                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {isSelf ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => leave(member)}
                          >
                            <LogOut className="size-3.5" aria-hidden="true" />
                            Leave
                          </Button>
                        ) : (
                          <>
                            {canUpdate && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => toggleStatus(member)}
                              >
                                <UserRoundCog
                                  className="size-3.5"
                                  aria-hidden="true"
                                />
                                {member.status === "SUSPENDED"
                                  ? "Restore"
                                  : "Suspend"}
                              </Button>
                            )}
                            {canRemove && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => remove(member)}
                              >
                                <UserMinus
                                  className="size-3.5"
                                  aria-hidden="true"
                                />
                                Remove
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
