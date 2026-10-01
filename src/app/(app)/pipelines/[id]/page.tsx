"use client";

import {
  ArrowLeft,
  ChevronRight,
  Edit,
  GripVertical,
  MoreHorizontal,
  Target,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui";

const STAGE_COLORS: Record<string, string> = {
  slate: "bg-slate-100 text-slate-800 border-slate-200",
  gray: "bg-gray-100 text-gray-800 border-gray-200",
  zinc: "bg-zinc-100 text-zinc-800 border-zinc-200",
  neutral: "bg-neutral-100 text-neutral-800 border-neutral-200",
  stone: "bg-stone-100 text-stone-800 border-stone-200",
  red: "bg-red-100 text-red-800 border-red-200",
  orange: "bg-orange-100 text-orange-800 border-orange-200",
  amber: "bg-amber-100 text-amber-800 border-amber-200",
  yellow: "bg-yellow-100 text-yellow-800 border-yellow-200",
  lime: "bg-lime-100 text-lime-800 border-lime-200",
  green: "bg-green-100 text-green-800 border-green-200",
  emerald: "bg-emerald-100 text-emerald-800 border-emerald-200",
  teal: "bg-teal-100 text-teal-800 border-teal-200",
  cyan: "bg-cyan-100 text-cyan-800 border-cyan-200",
  sky: "bg-sky-100 text-sky-800 border-sky-200",
  blue: "bg-blue-100 text-blue-800 border-blue-200",
  indigo: "bg-indigo-100 text-indigo-800 border-indigo-200",
  violet: "bg-violet-100 text-violet-800 border-violet-200",
  purple: "bg-purple-100 text-purple-800 border-purple-200",
  fuchsia: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200",
  pink: "bg-pink-100 text-pink-800 border-pink-200",
  rose: "bg-rose-100 text-rose-800 border-rose-200",
};

interface PipelineStage {
  _id: string;
  key: string;
  name: string;
  order: number;
  probability: number;
  color: string;
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
  stages: PipelineStage[];
  createdAt: string;
  updatedAt: string;
}

export default async function PipelineDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

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
        setPipeline(data.data);
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

  const handleDelete = async () => {
    if (!confirm(`Delete "${pipeline?.name}"? This cannot be undone.`)) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/pipelines/${pipelineId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Failed to delete pipeline");
      }
      toast.success("Pipeline deleted");
      router.push("/pipelines");
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to delete pipeline",
      );
    } finally {
      setDeleting(false);
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
      <div className="text-center py-12">
        <h2 className="text-lg font-medium text-ink-900">Pipeline not found</h2>
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
    );
  }

  const sortedStages = [...pipeline.stages].sort((a, b) => a.order - b.order);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/pipelines">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-semibold text-ink-900 flex items-center gap-2">
            {pipeline.name}
            {pipeline.isDefault && (
              <Badge tone="positive" className="text-xs">
                Default
              </Badge>
            )}
          </h1>
          {pipeline.description && (
            <p className="text-sm text-ink-500 mt-1">{pipeline.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/pipelines/${pipeline._id}/edit`}>
            <Button variant="secondary" size="sm">
              <Edit className="h-4 w-4 mr-1" />
              Edit
            </Button>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button variant="ghost" size="icon" aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={handleDelete} destructive>
                <Trash2 className="h-4 w-4 mr-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {sortedStages.map((stage, index) => (
          <Card
            key={stage._id}
            className={`relative transition-all ${stage.isWon ? "ring-2 ring-green-500" : ""} ${stage.isLost ? "ring-2 ring-red-500" : ""}`}
          >
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <div
                    className={`w-3 h-3 rounded-full border ${STAGE_COLORS[stage.color] || "bg-blue-100 border-blue-200"} shrink-0`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-ink-900 truncate">
                      {stage.name}
                    </p>
                    <p className="text-xs text-ink-500 font-mono">
                      {stage.key}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {stage.isWon && (
                    <Badge tone="positive" className="text-xs">
                      Won
                    </Badge>
                  )}
                  {stage.isLost && (
                    <Badge tone="critical" className="text-xs">
                      Lost
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-500">Order</span>
                <span className="font-medium text-ink-900">{stage.order}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-500">Probability</span>
                <span className="font-medium text-ink-900">
                  {stage.probability}%
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-ink-500">Color</span>
                <span
                  className={`font-medium text-ink-900 capitalize ${STAGE_COLORS[stage.color] || ""} px-2 py-0.5 rounded`}
                >
                  {stage.color}
                </span>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {pipeline.stages.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <Target className="h-12 w-12 text-ink-300 mx-auto mb-3" />
            <p className="text-ink-500">No stages defined</p>
            <Link
              href={`/pipelines/${pipeline._id}/edit`}
              className="mt-3 inline-flex items-center gap-2 text-primary hover:underline"
            >
              <ChevronRight className="h-4 w-4" />
              Add Stages
            </Link>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pipeline Details</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-ink-500">ID</p>
            <p className="font-mono text-ink-900">{pipeline._id}</p>
          </div>
          <div>
            <p className="text-ink-500">Organization ID</p>
            <p className="font-mono text-ink-900">{pipeline.organizationId}</p>
          </div>
          <div>
            <p className="text-ink-500">Created</p>
            <p className="font-medium text-ink-900">
              {new Date(pipeline.createdAt).toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-ink-500">Last Updated</p>
            <p className="font-medium text-ink-900">
              {new Date(pipeline.updatedAt).toLocaleString()}
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
