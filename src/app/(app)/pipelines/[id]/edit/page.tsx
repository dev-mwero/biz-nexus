"use client";

import {
  ArrowLeft,
  ChevronRight,
  GripVertical,
  Plus,
  Target,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
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
  Textarea,
} from "@/components/ui";

const STAGE_COLORS = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
] as const;

interface StageFormData {
  _id?: string;
  key: string;
  name: string;
  order: number;
  probability: number;
  color: (typeof STAGE_COLORS)[number];
  isWon: boolean;
  isLost: boolean;
}

interface Pipeline {
  _id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  order: number;
  stages: StageFormData[];
  createdAt: string;
  updatedAt: string;
}

export default async function EditPipelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const paramsResolved = await params;
  const pipelineId = paramsResolved.id;

  useEffect(() => {
    const fetchPipeline = async () => {
      try {
        const res = await fetch(`/api/v1/pipelines/${pipelineId}`);
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error?.message || "Failed to fetch pipeline");
        }
        const data = await res.json();
        const pipelineData = data.data;
        // Add _id to stages for tracking
        const stagesWithIds = pipelineData.stages.map((stage: any) => ({
          ...stage,
          _id: stage._id,
        }));
        setPipeline({ ...pipelineData, stages: stagesWithIds });
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load pipeline",
        );
      } finally {
        setLoading(false);
      }
    };

    fetchPipeline();
  }, [pipelineId]);

  const updateField = (field: string, value: unknown) => {
    setPipeline((prev) => (prev ? { ...prev, [field]: value } : null));
  };

  const updateStage = (
    index: number,
    field: keyof StageFormData,
    value: unknown,
  ) => {
    setPipeline((prev) =>
      prev
        ? {
            ...prev,
            stages: prev.stages.map((stage, i) =>
              i === index ? { ...stage, [field]: value } : stage,
            ),
          }
        : null,
    );
  };

  const addStage = () => {
    if (!pipeline) return;
    const nextOrder =
      pipeline.stages.length > 0
        ? Math.max(...pipeline.stages.map((s) => s.order)) + 1
        : 0;
    setPipeline((prev) =>
      prev
        ? {
            ...prev,
            stages: [
              ...prev.stages,
              {
                key: `STAGE_${nextOrder}`,
                name: `Stage ${nextOrder + 1}`,
                order: nextOrder,
                probability: 0,
                color: "blue",
                isWon: false,
                isLost: false,
              },
            ],
          }
        : null,
    );
  };

  const removeStage = (index: number) => {
    if (!pipeline || pipeline.stages.length <= 1) return;
    setPipeline((prev) =>
      prev
        ? {
            ...prev,
            stages: prev.stages.filter((_, i) => i !== index),
          }
        : null,
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pipeline) return;

    setError("");
    setSubmitting(true);

    try {
      // Validate stages
      const stages = pipeline.stages;
      const wonCount = stages.filter((s) => s.isWon).length;
      const lostCount = stages.filter((s) => s.isLost).length;
      const keys = stages.map((s) => s.key);
      const orders = stages.map((s) => s.order);

      if (wonCount > 1 || lostCount > 1) {
        throw new Error(
          "A pipeline may have at most one won stage and one lost stage.",
        );
      }
      if (new Set(keys).size !== keys.length) {
        throw new Error("Stage keys must be unique within a pipeline.");
      }
      if (new Set(orders).size !== orders.length) {
        throw new Error("Stage orders must be unique within a pipeline.");
      }

      const res = await fetch(`/api/v1/pipelines/${pipelineId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: pipeline.name.trim(),
          description: pipeline.description?.trim() || null,
          isDefault: pipeline.isDefault,
          order: pipeline.order,
          stages: stages.map(({ _id, isWon, isLost, ...rest }) => ({
            ...rest,
            isWon: isWon ?? false,
            isLost: isLost ?? false,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Failed to update pipeline");
      }

      toast.success("Pipeline updated");
      router.push(`/pipelines/${pipelineId}`);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update pipeline",
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (error || !pipeline) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/pipelines">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
        </div>
        <div className="text-center py-12">
          <h2 className="text-lg font-medium text-ink-900">
            Pipeline not found
          </h2>
          <p className="text-ink-500 mt-1">
            {error || "The pipeline you're looking for doesn't exist."}
          </p>
          <Link
            href="/pipelines"
            className="mt-4 inline-flex items-center gap-2 text-primary hover:underline"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Pipelines
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/pipelines/${pipeline._id}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Edit Pipeline</h1>
          <p className="text-sm text-ink-500">
            Modify pipeline details and stages
          </p>
        </div>
      </div>

      {error && (
        <div
          className="rounded-md border border-critical bg-critical/10 p-4 text-sm text-critical"
          role="alert"
        >
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Pipeline Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field>
              <FieldLabel htmlFor="name">Pipeline Name *</FieldLabel>
              <Input
                id="name"
                value={pipeline.name}
                onChange={(e) => updateField("name", e.target.value)}
                placeholder="Enterprise Sales Pipeline"
                required
                maxLength={80}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="description">Description</FieldLabel>
              <Textarea
                id="description"
                value={pipeline.description || ""}
                onChange={(e) => updateField("description", e.target.value)}
                placeholder="Optional description of this pipeline"
                rows={3}
                maxLength={500}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="isDefault">Default Pipeline</FieldLabel>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="isDefault"
                    checked={pipeline.isDefault}
                    onChange={(e) => updateField("isDefault", e.target.checked)}
                    className="h-4 w-4 rounded border-ink-300 text-primary focus:ring-primary"
                  />
                  <label
                    htmlFor="isDefault"
                    className="text-sm text-ink-600 cursor-pointer"
                  >
                    Set as the default pipeline for new deals
                  </label>
                </div>
              </Field>

              <Field>
                <FieldLabel htmlFor="order">Display Order</FieldLabel>
                <Input
                  id="order"
                  type="number"
                  value={pipeline.order.toString()}
                  onChange={(e) =>
                    updateField("order", parseInt(e.target.value, 10) || 0)
                  }
                  min="0"
                  max="999"
                />
              </Field>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Stages</CardTitle>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addStage}
            >
              <Plus className="h-4 w-4 mr-1" /> Add Stage
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-ink-500">
              Drag to reorder. Each pipeline must have at most one Won stage and
              one Lost stage.
            </p>

            <div className="space-y-3">
              {pipeline.stages.map((stage, index) => (
                <div
                  key={`${stage._id || stage.key}-${index}`}
                  className="border border-line rounded-lg p-4 bg-surface/50"
                >
                  <div className="flex items-start gap-3">
                    <GripVertical className="h-5 w-5 text-ink-400 cursor-grab mt-1 shrink-0" />

                    <div className="flex-1 space-y-3 min-w-0">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        <Field>
                          <FieldLabel htmlFor={`stage-key-${index}`}>
                            Key *
                          </FieldLabel>
                          <Input
                            id={`stage-key-${index}`}
                            value={stage.key}
                            onChange={(e) =>
                              updateStage(
                                index,
                                "key",
                                e.target.value
                                  .toUpperCase()
                                  .replace(/[^A-Z0-9_]/g, ""),
                              )
                            }
                            placeholder="NEW"
                            maxLength={30}
                            required
                          />
                        </Field>

                        <Field>
                          <FieldLabel htmlFor={`stage-name-${index}`}>
                            Name *
                          </FieldLabel>
                          <Input
                            id={`stage-name-${index}`}
                            value={stage.name}
                            onChange={(e) =>
                              updateStage(index, "name", e.target.value)
                            }
                            placeholder="New"
                            maxLength={60}
                            required
                          />
                        </Field>

                        <Field>
                          <FieldLabel htmlFor={`stage-order-${index}`}>
                            Order *
                          </FieldLabel>
                          <Input
                            id={`stage-order-${index}`}
                            type="number"
                            value={stage.order.toString()}
                            onChange={(e) =>
                              updateStage(
                                index,
                                "order",
                                parseInt(e.target.value, 10) || 0,
                              )
                            }
                            min="0"
                            max="999"
                            required
                          />
                        </Field>

                        <Field>
                          <FieldLabel htmlFor={`stage-probability-${index}`}>
                            Probability %
                          </FieldLabel>
                          <Input
                            id={`stage-probability-${index}`}
                            type="number"
                            value={stage.probability.toString()}
                            onChange={(e) =>
                              updateStage(
                                index,
                                "probability",
                                parseInt(e.target.value, 10) || 0,
                              )
                            }
                            min="0"
                            max="100"
                          />
                        </Field>

                        <Field>
                          <FieldLabel htmlFor={`stage-color-${index}`}>
                            Color
                          </FieldLabel>
                          <Select
                            value={stage.color}
                            onValueChange={(v) =>
                              updateStage(
                                index,
                                "color",
                                v as (typeof STAGE_COLORS)[number],
                              )
                            }
                          >
                            <SelectTrigger id={`stage-color-${index}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STAGE_COLORS.map((color) => (
                                <SelectItem key={color} value={color}>
                                  {color.charAt(0).toUpperCase() +
                                    color.slice(1)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>

                        <div className="flex items-end gap-3">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={stage.isWon}
                              onChange={(e) =>
                                updateStage(index, "isWon", e.target.checked)
                              }
                              className="h-4 w-4 rounded border-ink-300 text-primary focus:ring-primary"
                            />
                            <span className="text-sm text-ink-600">Won</span>
                          </label>
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={stage.isLost}
                              onChange={(e) =>
                                updateStage(index, "isLost", e.target.checked)
                              }
                              className="h-4 w-4 rounded border-ink-300 text-primary focus:ring-primary"
                            />
                            <span className="text-sm text-ink-600">Lost</span>
                          </label>
                        </div>
                      </div>

                      {pipeline.stages.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-critical"
                          onClick={() => removeStage(index)}
                        >
                          <Trash2 className="h-4 w-4 mr-1" /> Remove Stage
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Link href={`/pipelines/${pipeline._id}`}>
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </form>
    </div>
  );
}
