"use client";

import {
  Edit2,
  GripVertical,
  MoreHorizontal,
  Plus,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Input,
  Label,
  Textarea,
} from "@/components/ui";
import { cn } from "@/shared/lib/cn";

interface Pipeline {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  order: number;
  stages: PipelineStage[];
}

interface PipelineStage {
  id: string;
  key: string;
  name: string;
  order: number;
  probability: number;
  color: string;
  isWon: boolean;
  isLost: boolean;
}

interface PipelineListProps {
  pipelines: Pipeline[];
  onCreate: (data: {
    name: string;
    description?: string;
    isDefault?: boolean;
  }) => Promise<void>;
  onUpdate: (id: string, data: Partial<Pipeline>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReorderStages: (
    pipelineId: string,
    stages: PipelineStage[],
  ) => Promise<void>;
}

export function PipelineList({
  pipelines,
  onCreate,
  onUpdate,
  onDelete,
  onReorderStages,
}: PipelineListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [newPipelineDescription, setNewPipelineDescription] = useState("");
  const [newPipelineDefault, setNewPipelineDefault] = useState(false);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPipelineName.trim()) return;
    setCreating(true);
    try {
      await onCreate({
        name: newPipelineName.trim(),
        description: newPipelineDescription.trim() || undefined,
        isDefault: newPipelineDefault,
      });
      setNewPipelineName("");
      setNewPipelineDescription("");
      setNewPipelineDefault(false);
    } finally {
      setCreating(false);
    }
  };

  const handleEditSubmit = async (id: string) => {
    if (!editName.trim()) return;
    await onUpdate(id, {
      name: editName.trim(),
      description: editDescription.trim() || null,
    });
    setEditingId(null);
  };

  const handleDelete = async (id: string) => {
    if (
      !confirm(
        "Delete this pipeline? This cannot be undone if deals reference it.",
      )
    )
      return;
    await onDelete(id);
  };

  return (
    <div className="space-y-4">
      {/* Create Pipeline Dialog */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogTrigger
          render={
            <Button className="w-full justify-start gap-2">
              <Plus className="h-4 w-4" />
              New Pipeline
            </Button>
          }
        />
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Pipeline</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={newPipelineName}
                onChange={(e) => setNewPipelineName(e.target.value)}
                placeholder="Sales Pipeline"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                value={newPipelineDescription}
                onChange={(e) => setNewPipelineDescription(e.target.value)}
                placeholder="Pipeline description"
                rows={3}
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isDefault"
                checked={newPipelineDefault}
                onChange={(e) => setNewPipelineDefault(e.target.checked)}
                className="h-4 w-4 rounded border-gray-300"
              />
              <Label htmlFor="isDefault" className="text-sm font-normal">
                Set as default pipeline
              </Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!newPipelineName.trim()}>
                Create
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Pipeline List */}
      <div className="space-y-3">
        {pipelines.map((pipeline) => (
          <PipelineCard
            key={pipeline.id}
            pipeline={pipeline}
            isEditing={editingId === pipeline.id}
            editName={editName}
            editDescription={editDescription}
            onEditClick={() => {
              setEditName(pipeline.name);
              setEditDescription(pipeline.description ?? "");
              setEditingId(pipeline.id);
            }}
            onEditSubmit={() => handleEditSubmit(pipeline.id)}
            onEditCancel={() => setEditingId(null)}
            onEditNameChange={(e) => setEditName(e.target.value)}
            onEditDescriptionChange={(e) => setEditDescription(e.target.value)}
            onDelete={() => handleDelete(pipeline.id)}
            onReorderStages={(stages) => onReorderStages(pipeline.id, stages)}
          />
        ))}
      </div>
    </div>
  );
}

interface PipelineCardProps {
  pipeline: Pipeline;
  isEditing: boolean;
  editName: string;
  editDescription: string;
  onEditClick: () => void;
  onEditSubmit: () => void;
  onEditCancel: () => void;
  onEditNameChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onEditDescriptionChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onDelete: () => void;
  onReorderStages: (stages: PipelineStage[]) => void;
}

function PipelineCard({
  pipeline,
  isEditing,
  editName,
  editDescription,
  onEditClick,
  onEditSubmit,
  onEditCancel,
  onEditNameChange,
  onEditDescriptionChange,
  onDelete,
  onReorderStages,
}: PipelineCardProps) {
  const [draggingStageId, setDraggingStageId] = useState<string | null>(null);
  const [localStages, setLocalStages] = useState<PipelineStage[]>(
    pipeline.stages,
  );

  // Sync localStages with pipeline.stages when pipeline changes
  // In a real app, you might want to handle this differently
  const stages = isEditing ? localStages : pipeline.stages;

  const handleDragStart = (e: React.DragEvent, stageId: string) => {
    setDraggingStageId(stageId);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, targetStageId: string) => {
    e.preventDefault();
    if (!draggingStageId || draggingStageId === targetStageId) {
      setDraggingStageId(null);
      return;
    }

    setLocalStages((prev) => {
      const newStages = [...prev];
      const fromIndex = newStages.findIndex((s) => s.id === draggingStageId);
      const toIndex = newStages.findIndex((s) => s.id === targetStageId);

      if (fromIndex === -1 || toIndex === -1) return prev;

      const [removed] = newStages.splice(fromIndex, 1);
      newStages.splice(toIndex, 0, removed);

      // Reassign orders
      return newStages.map((stage, index) => ({ ...stage, order: index }));
    });

    setDraggingStageId(null);
  };

  const handleDragEnd = () => {
    setDraggingStageId(null);
  };

  const handleSaveStages = () => {
    onReorderStages(localStages);
    onEditCancel();
  };

  return (
    <Card
      className={cn("transition-shadow", isEditing && "ring-2 ring-blue-500")}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-4">
          {isEditing ? (
            <div className="flex-1 space-y-2">
              <Input
                value={editName}
                onChange={onEditNameChange}
                onKeyDown={(e) => e.key === "Enter" && onEditSubmit()}
                autoFocus
              />
              <Textarea
                value={editDescription}
                onChange={onEditDescriptionChange}
                rows={2}
                placeholder="Description"
                className="resize-none"
              />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={onEditCancel}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSaveStages}>
                  Save
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <CardTitle className="text-lg truncate">
                    {pipeline.name}
                  </CardTitle>
                  {pipeline.isDefault && (
                    <Badge tone="neutral" className="text-xs">
                      Default
                    </Badge>
                  )}
                </div>
                {pipeline.description && (
                  <p className="text-sm text-muted-foreground mt-1 truncate">
                    {pipeline.description}
                  </p>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <IconButton
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Actions for ${pipeline.name}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </IconButton>
                  }
                />
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={onEditClick}>
                    <Edit2 className="h-4 w-4 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onDelete} className="text-red-600">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Stages */}
        <ul className="space-y-2">
          {stages.map((stage, index) => (
            <StageRow
              key={stage.id}
              stage={stage}
              index={index}
              isDragging={draggingStageId === stage.id}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onDragEnd={handleDragEnd}
            />
          ))}
        </ul>

        {pipeline.stages.length === 0 && (
          <p className="text-center text-muted-foreground py-4 text-sm">
            No stages yet. Edit to add stages.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

interface StageRowProps {
  stage: PipelineStage;
  index: number;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent, stageId: string) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent, targetStageId: string) => void;
  onDragEnd: () => void;
}

function StageRow({
  stage,
  index,
  isDragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: StageRowProps) {
  const colorClasses = {
    slate: "bg-slate-100 text-slate-700 border-slate-200",
    gray: "bg-gray-100 text-gray-700 border-gray-200",
    zinc: "bg-zinc-100 text-zinc-700 border-zinc-200",
    neutral: "bg-neutral-100 text-neutral-700 border-neutral-200",
    stone: "bg-stone-100 text-stone-700 border-stone-200",
    red: "bg-red-100 text-red-700 border-red-200",
    orange: "bg-orange-100 text-orange-700 border-orange-200",
    amber: "bg-amber-100 text-amber-700 border-amber-200",
    yellow: "bg-yellow-100 text-yellow-700 border-yellow-200",
    lime: "bg-lime-100 text-lime-700 border-lime-200",
    green: "bg-green-100 text-green-700 border-green-200",
    emerald: "bg-emerald-100 text-emerald-700 border-emerald-200",
    teal: "bg-teal-100 text-teal-700 border-teal-200",
    cyan: "bg-cyan-100 text-cyan-700 border-cyan-200",
    sky: "bg-sky-100 text-sky-700 border-sky-200",
    blue: "bg-blue-100 text-blue-700 border-blue-200",
    indigo: "bg-indigo-100 text-indigo-700 border-indigo-200",
    violet: "bg-violet-100 text-violet-700 border-violet-200",
    purple: "bg-purple-100 text-purple-700 border-purple-200",
    fuchsia: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200",
    pink: "bg-pink-100 text-pink-700 border-pink-200",
    rose: "bg-rose-100 text-rose-700 border-rose-200",
  };

  const colorClass =
    colorClasses[stage.color as keyof typeof colorClasses] ?? colorClasses.blue;

  return (
    <li
      className={cn(
        "flex items-center gap-3 p-2 rounded-lg border transition-all",
        isDragging && "opacity-50 rotate-1 shadow-lg",
      )}
      draggable
      onDragStart={(e) => onDragStart(e, stage.id)}
      onDragOver={onDragOver}
      onDrop={(e) => onDrop(e, stage.id)}
      onDragEnd={onDragEnd}
    >
      <GripVertical className="h-5 w-5 text-muted-foreground/50 cursor-grab active:cursor-grabbing" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "px-2 py-0.5 rounded text-xs font-medium",
              colorClass,
            )}
          >
            {stage.name}
          </span>
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
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>Probability: {stage.probability}%</span>
          <span>Key: {stage.key}</span>
        </div>
      </div>
      <span className="text-muted-foreground text-sm">{index + 1}</span>
    </li>
  );
}
