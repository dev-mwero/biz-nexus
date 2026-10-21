"use client";

import { Building2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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
} from "@/components/ui";

/**
 * The organisation's own settings.
 *
 * Reads `GET /organizations/current` and writes it back with `PATCH`, which is
 * the pair WS2d added. Everything here is gated on `organization.update`: a
 * member without it sees the same values as read-only inputs and no save
 * button, which is honest — the server would refuse the write anyway, and a
 * form that appears to accept one and then 403s is worse than one that never
 * offered it.
 *
 * Billing is deliberately absent. `docs/PRODUCT.md` §6 leaves SaaS billing out
 * of the MVP, and a disabled "Billing" tab is a promise this product has not
 * made. When it exists it belongs here as its own panel.
 */

interface OrganizationSettings {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  dateFormat: string;
  weekStartsOn: number;
  isActive: boolean;
}

const DATE_FORMATS = [
  { value: "YYYY-MM-DD", label: "2026-01-31" },
  { value: "DD/MM/YYYY", label: "31/01/2026" },
  { value: "MM/DD/YYYY", label: "01/31/2026" },
  { value: "DD MMM YYYY", label: "31 Jan 2026" },
] as const;

const WEEK_STARTS = [
  { value: "0", label: "Sunday" },
  { value: "1", label: "Monday" },
  { value: "6", label: "Saturday" },
] as const;

/** A short list to suggest, not to constrain: the field accepts any IANA id. */
const COMMON_TIMEZONES = [
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Singapore",
  "Australia/Sydney",
];

export function OrganizationPanel({ canUpdate }: { canUpdate: boolean }) {
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The editable copy. Kept separate from `settings` so Cancel can restore the
  // server's values without a refetch.
  const [form, setForm] = useState({
    name: "",
    timezone: "",
    currency: "",
    dateFormat: "",
    weekStartsOn: "1",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const res = await fetch("/api/v1/organizations/current");
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const body = await res.json();
      const data = body.data as OrganizationSettings;
      setSettings(data);
      setForm({
        name: data.name,
        timezone: data.timezone,
        currency: data.currency,
        dateFormat: data.dateFormat,
        weekStartsOn: String(data.weekStartsOn),
      });
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!form.name.trim()) {
      setError("An organisation needs a name.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/v1/organizations/current", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          timezone: form.timezone.trim(),
          currency: form.currency.trim().toUpperCase(),
          dateFormat: form.dateFormat,
          weekStartsOn: Number(form.weekStartsOn),
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Could not save the settings.");
        return;
      }

      const body = await res.json();
      setSettings(body.data as OrganizationSettings);
      toast.success("Organisation settings saved.");
    } catch {
      setError("Could not reach the server. Try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="size-4" aria-hidden="true" />
            Organisation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {["a", "b", "c", "d"].map((key) => (
            <Skeleton key={key} className="h-9 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (loadError || !settings) {
    return (
      <Card variant="outlined">
        <CardHeader>
          <CardTitle>Organisation</CardTitle>
        </CardHeader>
        <CardContent>
          <p role="alert" className="text-sm text-critical">
            Could not load the organisation settings.
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3"
            onClick={() => void load()}
          >
            Try again
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card variant="outlined">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="size-4" aria-hidden="true" />
          Organisation
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="org-name">Name</FieldLabel>
              <Input
                id="org-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                readOnly={!canUpdate}
                disabled={!canUpdate}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="org-slug">Slug</FieldLabel>
              <Input
                id="org-slug"
                value={settings.slug}
                readOnly
                disabled
                aria-describedby="org-slug-help"
              />
              <p
                id="org-slug-help"
                className="mt-1 text-xs text-ink-500 dark:text-ink-400"
              >
                The slug is in every invitation link. It is not editable here.
              </p>
            </Field>

            <Field>
              <FieldLabel htmlFor="org-timezone">Timezone</FieldLabel>
              <Input
                id="org-timezone"
                list="org-timezone-options"
                value={form.timezone}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                readOnly={!canUpdate}
                disabled={!canUpdate}
              />
              <datalist id="org-timezone-options">
                {COMMON_TIMEZONES.map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
            </Field>

            <Field>
              <FieldLabel htmlFor="org-currency">Currency</FieldLabel>
              <Input
                id="org-currency"
                value={form.currency}
                maxLength={3}
                onChange={(e) =>
                  setForm({
                    ...form,
                    currency: e.target.value.toUpperCase().slice(0, 3),
                  })
                }
                readOnly={!canUpdate}
                disabled={!canUpdate}
                placeholder="USD"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="org-date-format">Date format</FieldLabel>
              <Select
                value={form.dateFormat}
                onValueChange={(value) =>
                  value && setForm({ ...form, dateFormat: value })
                }
                disabled={!canUpdate}
              >
                <SelectTrigger id="org-date-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATE_FORMATS.map((format) => (
                    <SelectItem key={format.value} value={format.value}>
                      {format.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor="org-week-start">Week starts on</FieldLabel>
              <Select
                value={form.weekStartsOn}
                onValueChange={(value) =>
                  value && setForm({ ...form, weekStartsOn: value })
                }
                disabled={!canUpdate}
              >
                <SelectTrigger id="org-week-start">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WEEK_STARTS.map((day) => (
                    <SelectItem key={day.value} value={day.value}>
                      {day.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          {error && (
            <p role="alert" className="text-sm text-critical">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            {canUpdate ? (
              <Button type="submit" loading={saving}>
                Save changes
              </Button>
            ) : (
              <Badge tone="neutral" size="sm">
                Read-only — you need the organisation.update permission to
                change these
              </Badge>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
