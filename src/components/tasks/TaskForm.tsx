"use client";

import { Calendar, Link2, User, X } from "lucide-react";
import { Types } from "mongoose";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Field,
  FieldError,
  FieldLabel,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@/components/ui";
import {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type TaskPriority,
  type TaskStatus,
} from "@/modules/tasks/task.model";
import { cn } from "@/shared/lib/cn";

/**
 * A related-entity row as held in form state. `rowKey` is client-only identity
 * for React: the row has no server id, and keying on `entityType`/`entityId`
 * would remount (and blur) the inputs on every keystroke, because those are
 * exactly the fields being edited.
 */
interface RelatedEntity {
  rowKey: string;
  entityType: string;
  entityId: string;
}

interface TaskFormProps {
  organizationId: string;
  task?: {
    _id: string;
    title: string;
    description: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    dueAt: string | null;
    assigneeId: string | null;
    related: Array<{ entityType: string; entityId: string }>;
  };
  onSuccess?: () => void;
  onClose?: () => void;
  open?: boolean;
}

export function TaskForm({
  organizationId,
  task,
  onSuccess,
  onClose,
  open: controlledOpen,
}: TaskFormProps) {
  const [open, setOpen] = useState(controlledOpen ?? false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<TaskStatus>("TODO");
  const [priority, setPriority] = useState<TaskPriority>("MEDIUM");
  const [dueAt, setDueAt] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [related, setRelated] = useState<RelatedEntity[]>([]);
  const relatedRowCounter = useRef(0);
  // Stable identity across renders: the counter is a ref, so this never
  // changes and callers can depend on it without re-running.
  const toRelatedEntity = useCallback(
    (rel: { entityType: string; entityId: string }): RelatedEntity => ({
      rowKey: `related-${relatedRowCounter.current++}`,
      entityType: rel.entityType,
      entityId: rel.entityId,
    }),
    [],
  );
  const [newRelatedType, setNewRelatedType] = useState("");
  const [newRelatedId, setNewRelatedId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || "");
      setStatus(task.status);
      setPriority(task.priority);
      setDueAt(
        task.dueAt ? new Date(task.dueAt).toISOString().slice(0, 16) : "",
      );
      setAssigneeId(task.assigneeId || "");
      setRelated(task.related.map((rel) => toRelatedEntity(rel)));
    } else {
      setTitle("");
      setDescription("");
      setStatus("TODO");
      setPriority("MEDIUM");
      setDueAt("");
      setAssigneeId("");
      setRelated([]);
    }
    setError(null);
  }, [task, toRelatedEntity]);

  useEffect(() => {
    if (controlledOpen !== undefined) setOpen(controlledOpen);
  }, [controlledOpen]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    setError(null);
    setSubmitting(true);

    try {
      const url = task ? `/api/v1/tasks/${task._id}` : "/api/v1/tasks";
      const method = task ? "PATCH" : "POST";

      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          status,
          priority,
          dueAt: dueAt ? new Date(dueAt).toISOString() : null,
          assigneeId: assigneeId || null,
          // `rowKey` is form bookkeeping and is not part of the payload.
          related: related.map(({ entityType: entity, entityId: id }) => ({
            entityType: entity,
            entityId: id,
          })),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || "Failed to save task");
      }

      onSuccess?.();
      onClose?.();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save task");
    } finally {
      setSubmitting(false);
    }
  };

  const addRelated = () => {
    if (
      newRelatedType &&
      newRelatedId &&
      Types.ObjectId.isValid(newRelatedId)
    ) {
      setRelated((prev) => [
        ...prev,
        toRelatedEntity({
          entityType: newRelatedType,
          entityId: newRelatedId,
        }),
      ]);
      setNewRelatedType("");
      setNewRelatedId("");
    }
  };

  const removeRelated = (index: number) => {
    setRelated((prev) => prev.filter((_, i) => i !== index));
  };

  const renderForm = () => (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field>
        <FieldLabel>Title *</FieldLabel>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title"
          disabled={submitting}
        />
      </Field>

      <Field>
        <FieldLabel>Description</FieldLabel>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Task details..."
          rows={3}
          disabled={submitting}
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel>Status</FieldLabel>
          <Select
            value={status}
            onValueChange={(v) => setStatus(v as TaskStatus)}
            disabled={submitting}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s.replace("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field>
          <FieldLabel>Priority</FieldLabel>
          <Select
            value={priority}
            onValueChange={(v) => setPriority(v as TaskPriority)}
            disabled={submitting}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_PRIORITIES.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field>
        <FieldLabel>Due date</FieldLabel>
        <Input
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          disabled={submitting}
        />
      </Field>

      <Field>
        <FieldLabel>Assignee (User ID)</FieldLabel>
        <div className="relative">
          <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={assigneeId}
            onChange={(e) => setAssigneeId(e.target.value)}
            placeholder="User ObjectId"
            className="pl-9"
            disabled={submitting}
          />
        </div>
      </Field>

      <Field>
        <FieldLabel>Related entities</FieldLabel>
        <div className="space-y-2">
          {related.map((rel, index) => (
            <div key={rel.rowKey} className="flex items-center gap-2">
              <Input
                value={rel.entityType}
                onChange={(e) => {
                  const updated = [...related];
                  updated[index] = {
                    ...updated[index],
                    entityType: e.target.value,
                  };
                  setRelated(updated);
                }}
                placeholder="Entity type (contact, company, deal)"
                className="flex-1"
                disabled={submitting}
              />
              <Input
                value={rel.entityId}
                onChange={(e) => {
                  const updated = [...related];
                  updated[index] = {
                    ...updated[index],
                    entityId: e.target.value,
                  };
                  setRelated(updated);
                }}
                placeholder="Entity ObjectId"
                className="flex-1"
                disabled={submitting}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeRelated(index)}
                disabled={submitting}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Input
              value={newRelatedType}
              onChange={(e) => setNewRelatedType(e.target.value)}
              placeholder="Type"
              className="flex-1"
              disabled={submitting}
            />
            <Input
              value={newRelatedId}
              onChange={(e) => setNewRelatedId(e.target.value)}
              placeholder="ObjectId"
              className="flex-1"
              disabled={submitting}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={addRelated}
              disabled={submitting}
            >
              <Link2 className="w-4 h-4 mr-1" />
              Add
            </Button>
          </div>
        </div>
      </Field>

      {error && <FieldError>{error}</FieldError>}

      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            onClose?.();
            setOpen(false);
          }}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving..." : task ? "Update" : "Create"}
        </Button>
      </div>
    </form>
  );

  if (controlledOpen !== undefined) {
    return <>{renderForm()}</>;
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
        </DialogHeader>
        {renderForm()}
      </DialogContent>
    </Dialog>
  );
}
