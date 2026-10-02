"use client";

import { ArrowLeft, Loader2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { KanbanBoard } from "@/components/deals/KanbanBoard";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Toaster,
} from "@/components/ui";

interface PipelineWithStages {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  order: number;
  stages: {
    id: string;
    key: string;
    name: string;
    order: number;
    probability: number;
    color: string;
    isWon: boolean;
    isLost: boolean;
  }[];
}

export default function DealsKanbanPage() {
  const [pipelines, setPipelines] = useState<PipelineWithStages[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(
    null,
  );
  const [columns, setColumns] = useState<
    Array<{ stage: PipelineWithStages["stages"][0]; deals: any[] }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [pipelinesLoading, setPipelinesLoading] = useState(true);

  const fetchPipelines = useCallback(async () => {
    setPipelinesLoading(true);
    try {
      const res = await fetch("/api/v1/pipelines");
      if (!res.ok) throw new Error("Failed to fetch pipelines");
      const data = await res.json();
      setPipelines(data.data);
      if (data.data.length > 0 && !selectedPipelineId) {
        setSelectedPipelineId(data.data[0].id);
      }
    } catch (error) {
      console.error("Failed to fetch pipelines:", error);
    } finally {
      setPipelinesLoading(false);
    }
  }, [selectedPipelineId]);

  const fetchBoard = useCallback(async (pipelineId: string) => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/v1/deals/pipeline-board?pipelineId=${pipelineId}`,
      );
      if (!res.ok) throw new Error("Failed to fetch board");
      const data = await res.json();
      setColumns(data.data.columns);
    } catch (error) {
      console.error("Failed to fetch board:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPipelines();
  }, [fetchPipelines]);

  useEffect(() => {
    if (selectedPipelineId) {
      fetchBoard(selectedPipelineId);
    }
  }, [selectedPipelineId, fetchBoard]);

  const handlePipelineChange = (pipelineId: string) => {
    setSelectedPipelineId(pipelineId);
  };

  const handleDealMove = async (
    dealId: string,
    stageId: string,
    sortOrder: number,
  ) => {
    const res = await fetch(`/api/v1/deals/${dealId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stageId, sortOrder }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error?.message || "Failed to move deal");
    }
    if (selectedPipelineId) {
      fetchBoard(selectedPipelineId);
    }
  };

  const handleDealCreate = async (data: { name: string; stageId: string }) => {
    if (!selectedPipelineId) return;
    const res = await fetch("/api/v1/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.name,
        pipelineId: selectedPipelineId,
        stageId: data.stageId,
      }),
    });
    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.error?.message || "Failed to create deal");
    }
    fetchBoard(selectedPipelineId);
  };

  if (pipelinesLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Toaster />

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <Link href="/deals">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to List
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-ink-900">
              Kanban Board
            </h1>
            <p className="text-sm text-ink-500">
              Drag and drop deals between stages
            </p>
          </div>
        </div>
        {pipelines.length > 0 && (
          <div className="flex items-center gap-2">
            <Select
              value={selectedPipelineId || ""}
              onValueChange={(v) => {
                // Base UI reports a cleared select as `null`; the board always
                // renders one pipeline, so a cleared select is a no-op rather
                // than an empty board.
                if (v === null) return;
                handlePipelineChange(v);
              }}
              disabled={pipelinesLoading}
            >
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Select pipeline" />
              </SelectTrigger>
              <SelectContent>
                {pipelines.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                    {p.isDefault && " (Default)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0">
        <KanbanBoard
          pipelines={pipelines}
          selectedPipelineId={selectedPipelineId}
          onPipelineChange={handlePipelineChange}
          columns={columns}
          onDealMove={handleDealMove}
          onDealCreate={handleDealCreate}
          isLoading={loading}
        />
      </div>
    </div>
  );
}
