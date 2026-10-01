"use client";

import { ArrowLeft, GripVertical, Plus, Target, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
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

const DEFAULT_STAGES: StageFormData[] = [
  {
    key: "NEW",
    name: "New",
    order: 0,
    probability: 10,
    color: "slate",
    isWon: false,
    isLost: false,
  },
  {
    key: "QUALIFIED",
    name: "Qualified",
    order: 1,
    probability: 25,
    color: "blue",
    isWon: false,
    isLost: false,
  },
  {
    key: "PROPOSAL",
    name: "Proposal",
    order: 2,
    probability: 50,
    color: "amber",
    isWon: false,
    isLost: false,
  },
  {
    key: "NEGOTIATION",
    name: "Negotiation",
    order: 3,
    probability: 75,
    color: "orange",
    isWon: false,
    isLost: false,
  },
  {
    key: "WON",
    name: "Won",
    order: 4,
    probability: 100,
    color: "green",
    isWon: true,
    isLost: false,
  },
  {
    key: "LOST",
    name: "Lost",
    order: 5,
    probability: 0,
    color: "red",
    isWon: false,
    isLost: true,
  },
];

interface StageFormData {
  key: string;
  name: string;
  order: number;
  probability: number;
  color: (typeof STAGE_COLORS)[number];
  isWon: boolean;
  isLost: boolean;
}

export default function NewPipelinePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState<{
    name: string;
    description: string;
    isDefault: boolean;
    stages: StageFormData[];
  }>({
    name: "",
    description: "",
    isDefault: false,
    stages: DEFAULT_STAGES,
  });

  const updateStage = (
    index: number,
    field: keyof StageFormData,
    value: unknown,
  ) => {
    setFormData({
      ...formData,
      stages: formData.stages.map((stage, i) =>
        i === index ? { ...stage, [field]: value } : stage,
      ),
    });
  };

  const addStage = () => {
    const nextOrder =
      formData.stages.length > 0
        ? Math.max(...formData.stages.map((s) => s.order)) + 1
        : 0;
    setFormData({
      ...formData,
      stages: [
        ...formData.stages,
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
    });
  };

  const removeStage = (index: number) => {
    if (formData.stages.length <= 1) return;
    setFormData({
      ...formData,
      stages: formData.stages.filter((_, i) => i !== index),
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    try {
      // Validate stages
      const stages = formData.stages;
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

      const res = await fetch("/api/v1/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          isDefault: formData.isDefault,
          stages: stages.map(({ isWon, isLost, ...rest }) => ({
            ...rest,
            isWon: isWon ?? false,
            isLost: isLost ?? false,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Failed to create pipeline");
      }

      const data = await res.json();
      toast.success("Pipeline created");
      router.push(`/pipelines/${data.data._id}`);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create pipeline",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/pipelines">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">New Pipeline</h1>
          <p className="text-sm text-ink-500">
            Create a new sales pipeline with custom stages
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
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="Enterprise Sales Pipeline"
                required
                maxLength={80}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="description">Description</FieldLabel>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="Optional description of this pipeline"
                rows={3}
                maxLength={500}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="isDefault">
                Make this the default pipeline
              </FieldLabel>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isDefault"
                  checked={formData.isDefault}
                  onChange={(e) =>
                    setFormData({ ...formData, isDefault: e.target.checked })
                  }
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
              {formData.stages.map((stage, index) => (
                <div
                  key={`${stage.key}-${index}`}
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

                      {formData.stages.length > 1 && (
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
          <Link href="/pipelines">
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create Pipeline"}
          </Button>
        </div>
      </form>
    </div>
  );
}
