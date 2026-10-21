"use client";

import { Check, Copy, Mail, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldLabel,
  Input,
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
 * Team invitations.
 *
 * The invitation token is the part worth reading before changing anything. There
 * is no mailer yet (`docs/DISCOVERY.md`), so `POST .../members/invitations`
 * returns the raw token exactly once and it is the only way to deliver the
 * invitation. A form that swallowed it would create invitations nobody could
 * accept, so the token is surfaced on screen for the inviter to hand over. When
 * the mailer exists this block should go and the token should stop being a
 * response field.
 */

interface InvitationRow {
  _id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

const INVITABLE_ROLES = [
  { value: "ADMIN", label: "Admin" },
  { value: "MEMBER", label: "Member" },
  { value: "VIEWER", label: "Viewer" },
];

export function InvitationsPanel({
  canInvite,
  canRevoke,
}: {
  canInvite: boolean;
  canRevoke: boolean;
}) {
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [roleKey, setRoleKey] = useState("MEMBER");
  const [inviting, setInviting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [issuedEmail, setIssuedEmail] = useState<string | null>(null);
  const [replaced, setReplaced] = useState(false);

  const loadInvitations = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/v1/organizations/current/invitations");
      if (res.ok) {
        const body = await res.json();
        setInvitations(body.data ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInvitations();
  }, [loadInvitations]);

  async function handleInvite(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    setIssuedToken(null);

    if (!email.trim()) {
      setFormError("Enter an email address to invite.");
      return;
    }

    setInviting(true);
    try {
      const res = await fetch(
        "/api/v1/organizations/current/members/invitations",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), roleKey }),
        },
      );

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setFormError(body?.error?.message ?? "Could not send the invitation.");
        return;
      }

      const body = await res.json();
      setIssuedToken(body.data?.token ?? null);
      setIssuedEmail(body.data?.invitation?.email ?? email.trim());
      setReplaced(Boolean(body.data?.replaced));
      setEmail("");
      await loadInvitations();
    } catch {
      setFormError("Could not reach the server. Try again.");
    } finally {
      setInviting(false);
    }
  }

  async function handleRevoke(id: string) {
    const res = await fetch(`/api/v1/organizations/current/invitations/${id}`, {
      method: "DELETE",
    });
    if (res.ok) await loadInvitations();
  }

  return (
    <Card variant="outlined">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4" aria-hidden="true" />
          Team invitations
        </CardTitle>
      </CardHeader>

      {canInvite && (
        <CardContent>
          <form
            onSubmit={handleInvite}
            className="flex flex-col gap-3 sm:flex-row sm:items-end"
          >
            <Field className="flex-1">
              <FieldLabel>Email</FieldLabel>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
                autoComplete="email"
              />
            </Field>
            <Field className="sm:w-40">
              <FieldLabel>Role</FieldLabel>
              <Select
                value={roleKey}
                onValueChange={(value) => setRoleKey(value ?? "MEMBER")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INVITABLE_ROLES.map((role) => (
                    <SelectItem key={role.value} value={role.value}>
                      {role.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Button type="submit" loading={inviting}>
              Send invitation
            </Button>
          </form>

          {formError && (
            <p role="alert" className="mt-3 text-sm text-critical">
              {formError}
            </p>
          )}

          {issuedToken && (
            <div className="mt-4 rounded-md border border-attention-border bg-attention-surface p-3 text-sm">
              <p className="font-medium text-ink-700 dark:text-ink-200">
                {replaced ? "Invitation replaced" : "Invitation created"} for{" "}
                {issuedEmail}.
              </p>
              <p className="mt-1 text-ink-500 dark:text-ink-400">
                There is no email delivery yet — pass this token along yourself.
                It cannot be shown again.
              </p>
              <TokenCopy token={issuedToken} />
            </div>
          )}
        </CardContent>
      )}

      <CardContent className="pt-0">
        {loading && invitations.length === 0 ? (
          <div className="space-y-2">
            {["a", "b", "c"].map((key) => (
              <Skeleton key={key} className="h-9 w-full" />
            ))}
          </div>
        ) : invitations.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-500 dark:text-ink-400">
            No pending invitations.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Sent</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invitations.map((invitation) => (
                <TableRow key={invitation._id}>
                  <TableCell className="font-medium">
                    {invitation.email}
                  </TableCell>
                  <TableCell className="text-ink-500">
                    {formatDate(invitation.createdAt)}
                  </TableCell>
                  <TableCell>
                    <Badge tone="attention" size="sm">
                      {formatDate(invitation.expiresAt)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canRevoke && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleRevoke(invitation._id)}
                      >
                        Revoke
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

function TokenCopy({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);
  const acceptUrl = "/api/v1/auth/accept-invitation";

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the token is visible on screen either
      // way, so there is nothing to recover from and nothing to report.
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded border border-line bg-surface px-2 py-1 font-mono text-xs text-ink-700 dark:text-ink-200">
          {token}
        </code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => void copy()}
        >
          {copied ? (
            <>
              <Check className="size-3.5" aria-hidden="true" /> Copied
            </>
          ) : (
            <>
              <Copy className="size-3.5" aria-hidden="true" /> Copy
            </>
          )}
        </Button>
      </div>
      <p className="flex items-center gap-1.5 text-xs text-ink-500 dark:text-ink-400">
        <Mail className="size-3.5" aria-hidden="true" />
        Accept at <code className="font-mono">{acceptUrl}</code>
      </p>
    </div>
  );
}
