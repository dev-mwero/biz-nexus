"use client";

import { Calendar, Loader2, MessageSquare, Phone } from "lucide-react";
import { Types } from "mongoose";
import { useState } from "react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@/components/ui";
import type { ActivityType } from "@/modules/activities/activity.model";
import { cn } from "@/shared/lib/cn";

interface ActivityComposerProps {
  /** The entity this activity is about */
  entity: { entityType: string; entityId: string };
  /** Activity types to allow */
  allowedTypes?: ActivityType[];
  /** Default type */
  defaultType?: ActivityType;
  /** Called after successful creation */
  onCreated?: () => void;
  /** Organization ID for the API */
  organizationId?: string;
}

const ACTIVITY_TYPE_OPTIONS: Array<{
  value: ActivityType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "NOTE", label: "Note", icon: MessageSquare },
  { value: "CALL", label: "Call", icon: Phone },
  { value: "MEETING", label: "Meeting", icon: Calendar },
];

const TYPE_FIELDS: Record<
  ActivityType,
  {
    label: string;
    placeholder: string;
    showDirection?: boolean;
    showDuration?: boolean;
  }
> = {
  NOTE: {
    label: "Note",
    placeholder: "Write a note...",
    showDirection: false,
    showDuration: false,
  },
  CALL: {
    label: "Call details",
    placeholder: "Call notes...",
    showDirection: true,
    showDuration: true,
  },
  MEETING: {
    label: "Meeting notes",
    placeholder: "Meeting notes...",
    showDirection: false,
    showDuration: true,
  },
  TASK: {
    label: "Task",
    placeholder: "Task details...",
    showDirection: false,
    showDuration: false,
  },
  SYSTEM_EVENT: {
    label: "System event",
    placeholder: "Details...",
    showDirection: false,
    showDuration: false,
  },
  STAGE_CHANGE: {
    label: "Stage change",
    placeholder: "Details...",
    showDirection: false,
    showDuration: false,
  },
  EMAIL: {
    label: "Email",
    placeholder: "Email content...",
    showDirection: true,
    showDuration: false,
  },
  SMS: {
    label: "SMS",
    placeholder: "Message...",
    showDirection: true,
    showDuration: false,
  },
  WHATSAPP: {
    label: "WhatsApp",
    placeholder: "Message...",
    showDirection: true,
    showDuration: false,
  },
};

export function ActivityComposer({
  entity,
  allowedTypes = ["NOTE", "CALL", "MEETING"],
  defaultType = "NOTE",
  onCreated,
  organizationId,
}: ActivityComposerProps) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ActivityType>(defaultType);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [direction, setDirection] = useState<"INBOUND" | "OUTBOUND">(
    "OUTBOUND",
  );
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);
  const [occurredAt, setOccurredAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentTypeConfig = TYPE_FIELDS[type] || TYPE_FIELDS.NOTE;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const response = await fetch("/api/v1/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityType: entity.entityType,
          entityId: entity.entityId,
          type,
          title: title || currentTypeConfig.label,
          body: body || null,
          direction: currentTypeConfig.showDirection ? direction : null,
          durationSeconds: currentTypeConfig.showDuration
            ? durationSeconds
            : null,
          occurredAt: occurredAt || new Date().toISOString(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.error?.message || "Failed to create activity",
        );
      }

      setOpen(false);
      setTitle("");
      setBody("");
      setDurationSeconds(null);
      setOccurredAt("");
      onCreated?.();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create activity",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setError(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button className="w-full justify-start gap-2" variant="outline">
          <Loader2 className="w-4 h-4" />
          <span>Add activity</span>
          <span className="text-muted-foreground">({type})</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Log activity</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field>
            <FieldLabel>Type</FieldLabel>
            <Select
              value={type}
              onValueChange={(v) => setType(v as ActivityType)}
              disabled={submitting}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select activity type" />
              </SelectTrigger>
              <SelectContent>
                {allowedTypes.map((t) => {
                  const Icon =
                    ACTIVITY_TYPE_OPTIONS.find((o) => o.value === t)?.icon ||
                    Loader2;
                  return (
                    <SelectItem key={t} value={t}>
                      <Icon className="w-4 h-4 mr-2" />
                      {ACTIVITY_TYPE_OPTIONS.find((o) => o.value === t)
                        ?.label || t}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel>Title</FieldLabel>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={currentTypeConfig.label}
              disabled={submitting}
            />
          </Field>

          <Field>
            <FieldLabel>{currentTypeConfig.label}</FieldLabel>
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={currentTypeConfig.placeholder}
              rows={4}
              disabled={submitting}
            />
          </Field>

          {currentTypeConfig.showDirection && (
            <Field>
              <FieldLabel>Direction</FieldLabel>
              <Select
                value={direction}
                onValueChange={(v) => setDirection(v as "INBOUND" | "OUTBOUND")}
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="INBOUND">Inbound</SelectItem>
                  <SelectItem value="OUTBOUND">Outbound</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          )}

          {currentTypeConfig.showDuration && (
            <Field>
              <FieldLabel>Duration (minutes)</FieldLabel>
              <Input
                type="number"
                min="0"
                value={
                  durationSeconds
                    ? String(Math.floor(durationSeconds / 60))
                    : ""
                }
                onChange={(e) => {
                  const val = parseInt(e.target.value, 10);
                  setDurationSeconds(isNaN(val) ? null : val * 60);
                }}
                placeholder="0"
                disabled={submitting}
              />
            </Field>
          )}

          <Field>
            <FieldLabel>Occurred at</FieldLabel>
            <Input
              type="datetime-local"
              value={occurredAt}
              onChange={(e) => setOccurredAt(e.target.value)}
              disabled={submitting}
            />
          </Field>

          {error && <FieldError>{error}</FieldError>}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
