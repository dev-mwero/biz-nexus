"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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

/**
 * The dedicated deal-creation screen.
 *
 * Unlike `POST /api/v1/deals`'s other fields, a deal cannot be created without a
 * `pipelineId` and a `stageId` — the service refuses without them. There is no
 * default the client may assume, so this form fetches the organisation's
 * pipelines first and derives the stage list from the chosen pipeline. Selecting
 * a pipeline resets the stage, because a stage belongs to exactly one pipeline
 * and carrying a stale id across would earn a 422.
 *
 * Per `docs/PLAN.md` §1K this route was a deliberate placeholder so the list's
 * and command palette's "New deal" actions resolved. It no longer is.
 */

interface PipelineStage {
  _id: string;
  key: string;
  name: string;
  order: number;
  probability: number;
}

interface Pipeline {
  _id: string;
  name: string;
  isDefault: boolean;
  stages: PipelineStage[];
}

export default function NewDealPage() {
  const router = useRouter();

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loadingPipelines, setLoadingPipelines] = useState(true);
  const [pipelineError, setPipelineError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [probability, setProbability] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [description, setDescription] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPipelines = useCallback(async () => {
    setLoadingPipelines(true);
    setPipelineError(null);
    try {
      const res = await fetch("/api/v1/pipelines");
      if (!res.ok) throw new Error("Failed to load pipelines");
      const body = await res.json();
      const list: Pipeline[] = body.data ?? [];
      setPipelines(list);

      // Prefer the organisation's default pipeline; fall back to the first.
      const initial = list.find((p) => p.isDefault) ?? list[0];
      if (initial) {
        setPipelineId(initial._id);
        const firstStage = [...initial.stages].sort(
          (a, b) => a.order - b.order,
        )[0];
        setStageId(firstStage?._id ?? "");
      }
    } catch (err) {
      setPipelineError(
        err instanceof Error ? err.message : "Failed to load pipelines",
      );
    } finally {
      setLoadingPipelines(false);
    }
  }, []);

  useEffect(() => {
    void loadPipelines();
  }, [loadPipelines]);

  const selectedStages = useMemo(() => {
    const pipeline = pipelines.find((p) => p._id === pipelineId);
    return pipeline
      ? [...pipeline.stages].sort((a, b) => a.order - b.order)
      : [];
  }, [pipelines, pipelineId]);

  const handlePipelineChange = (nextId: string) => {
    setPipelineId(nextId);
    const pipeline = pipelines.find((p) => p._id === nextId);
    const firstStage = pipeline
      ? [...pipeline.stages].sort((a, b) => a.order - b.order)[0]
      : undefined;
    setStageId(firstStage?._id ?? "");
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!name.trim()) {
      setError("Deal name is required.");
      return;
    }
    if (!pipelineId || !stageId) {
      setError("Choose a pipeline and a stage.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/v1/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          pipelineId,
          stageId,
          value: value.trim() === "" ? 0 : Number(value),
          currency: currency.trim() || "USD",
          probability: probability.trim() === "" ? 0 : Number(probability),
          expectedCloseDate: expectedCloseDate
            ? new Date(expectedCloseDate).toISOString()
            : null,
          description: description.trim() || null,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message || "Failed to create deal");
      }

      const body = await res.json();
      toast.success("Deal created");
      const id = body?.data?._id;
      router.push(id ? `/deals/${id}` : "/deals");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create deal");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/deals"
          className="inline-flex size-9 items-center justify-center rounded-md text-ink-700 transition-colors hover:bg-surface-hover dark:text-ink-200"
          aria-label="Back to deals"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50">
            New Deal
          </h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Add a deal to your sales pipeline.
          </p>
        </div>
      </div>

      {pipelineError && (
        <div
          role="alert"
          className="rounded-md border border-critical bg-critical/10 p-4 text-sm text-critical"
        >
          {pipelineError}.{" "}
          <button
            type="button"
            className="font-medium underline underline-offset-2"
            onClick={() => void loadPipelines()}
          >
            Retry
          </button>
        </div>
      )}

      {!loadingPipelines && pipelines.length === 0 && !pipelineError && (
        <div
          role="alert"
          className="rounded-md border border-line bg-surface-sunken p-4 text-sm text-ink-600 dark:text-ink-300"
        >
          This organisation has no pipeline yet. Create one before adding a
          deal.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card variant="outlined">
          <CardHeader>
            <CardTitle className="text-lg">Deal details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field error={error ?? undefined}>
              <FieldLabel>Deal name</FieldLabel>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Acme renewal"
                maxLength={200}
                disabled={submitting}
                required
              />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel>Pipeline</FieldLabel>
                <Select
                  value={pipelineId}
                  onValueChange={(value) => handlePipelineChange(value ?? "")}
                  disabled={submitting || loadingPipelines}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a pipeline" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((pipeline) => (
                      <SelectItem key={pipeline._id} value={pipeline._id}>
                        {pipeline.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel>Stage</FieldLabel>
                <Select
                  value={stageId}
                  onValueChange={(value) => setStageId(value ?? "")}
                  disabled={submitting || selectedStages.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a stage" />
                  </SelectTrigger>
                  <SelectContent>
                    {selectedStages.map((stage) => (
                      <SelectItem key={stage._id} value={stage._id}>
                        {stage.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel>Value</FieldLabel>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="0"
                  disabled={submitting}
                />
              </Field>
              <Field>
                <FieldLabel>Currency</FieldLabel>
                <Input
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                  placeholder="USD"
                  maxLength={3}
                  disabled={submitting}
                />
              </Field>
              <Field>
                <FieldLabel>Probability (%)</FieldLabel>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="1"
                  value={probability}
                  onChange={(e) => setProbability(e.target.value)}
                  placeholder="0"
                  disabled={submitting}
                />
              </Field>
            </div>

            <Field>
              <FieldLabel>Expected close date</FieldLabel>
              <Input
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                disabled={submitting}
              />
            </Field>

            <Field>
              <FieldLabel>Description</FieldLabel>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Context, next steps, competitors…"
                rows={3}
                maxLength={2000}
                disabled={submitting}
              />
            </Field>

            {error && <FieldError>{error}</FieldError>}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 border-t border-line pt-4">
          <Link href="/deals">
            <Button type="button" variant="secondary" disabled={submitting}>
              Cancel
            </Button>
          </Link>
          <Button
            type="submit"
            loading={submitting}
            disabled={submitting || pipelines.length === 0}
          >
            {submitting ? "Creating…" : "Create Deal"}
          </Button>
        </div>
      </form>
    </div>
  );
}
