"use client";

import { ChevronDown, Filter, Plus, Search, Settings, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Skeleton,
  Textarea,
} from "@/components/ui";
import { cn } from "@/shared/lib/cn";

interface KanbanStage {
  id: string;
  key: string;
  name: string;
  order: number;
  probability: number;
  color: string;
  isWon: boolean;
  isLost: boolean;
}

interface KanbanDeal {
  id: string;
  name: string;
  companyId: string | null;
  contactId: string | null;
  pipelineId: string;
  stageId: string;
  ownerId: string;
  value: number;
  currency: string;
  probability: number;
  status: string;
  expectedCloseDate: string | null;
  closedAt: string | null;
  lostReason: string | null;
  description: string | null;
  sortOrder: number;
  tags: string[];
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface KanbanColumn {
  stage: KanbanStage;
  deals: KanbanDeal[];
}

interface Pipeline {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  order: number;
  stages: KanbanStage[];
}

interface KanbanBoardProps {
  pipelines: Pipeline[];
  selectedPipelineId: string | null;
  onPipelineChange: (pipelineId: string) => void;
  columns: KanbanColumn[];
  onDealMove: (
    dealId: string,
    stageId: string,
    sortOrder: number,
  ) => Promise<void>;
  onDealCreate: (data: { name: string; stageId: string }) => Promise<void>;
  isLoading?: boolean;
}

const STAGE_COLORS = {
  slate: "bg-slate-100 border-slate-200",
  gray: "bg-gray-100 border-gray-200",
  zinc: "bg-zinc-100 border-zinc-200",
  neutral: "bg-neutral-100 border-neutral-200",
  stone: "bg-stone-100 border-stone-200",
  red: "bg-red-100 border-red-200",
  orange: "bg-orange-100 border-orange-200",
  amber: "bg-amber-100 border-amber-200",
  yellow: "bg-yellow-100 border-yellow-200",
  lime: "bg-lime-100 border-lime-200",
  green: "bg-green-100 border-green-200",
  emerald: "bg-emerald-100 border-emerald-200",
  teal: "bg-teal-100 border-teal-200",
  cyan: "bg-cyan-100 border-cyan-200",
  sky: "bg-sky-100 border-sky-200",
  blue: "bg-blue-100 border-blue-200",
  indigo: "bg-indigo-100 border-indigo-200",
  violet: "bg-violet-100 border-violet-200",
  purple: "bg-purple-100 border-purple-200",
  fuchsia: "bg-fuchsia-100 border-fuchsia-200",
  pink: "bg-pink-100 border-pink-200",
  rose: "bg-rose-100 border-rose-200",
};

const BADGE_COLORS = {
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

export function KanbanBoard({
  pipelines,
  selectedPipelineId,
  onPipelineChange,
  columns,
  onDealMove,
  onDealCreate,
  isLoading,
}: KanbanBoardProps) {
  const [creatingInStage, setCreatingInStage] = useState<string | null>(null);
  const [newDealName, setNewDealName] = useState("");
  const [filters, setFilters] = useState({
    search: "",
    ownerId: "",
    status: "",
  });

  const selectedPipeline = pipelines.find((p) => p.id === selectedPipelineId);
  const pipelineStages = selectedPipeline?.stages ?? [];

  // Filter columns based on search
  const filteredColumns = columns.map((col) => ({
    ...col,
    deals: col.deals.filter((deal) => {
      if (
        filters.search &&
        !deal.name.toLowerCase().includes(filters.search.toLowerCase())
      ) {
        return false;
      }
      if (filters.ownerId && deal.ownerId !== filters.ownerId) {
        return false;
      }
      if (filters.status && deal.status !== filters.status) {
        return false;
      }
      return true;
    }),
  }));

  const handleDragStart = (e: React.DragEvent, deal: KanbanDeal) => {
    e.dataTransfer.setData("application/json", JSON.stringify(deal));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = async (e: React.DragEvent, targetStage: KanbanStage) => {
    e.preventDefault();
    try {
      const dealData = JSON.parse(
        e.dataTransfer.getData("application/json"),
      ) as KanbanDeal;
      if (dealData.stageId === targetStage.id) return;

      // Calculate new sortOrder (append to end)
      const targetColumn = columns.find((c) => c.stage.id === targetStage.id);
      const maxSortOrder =
        targetColumn?.deals.reduce(
          (max, d) => Math.max(max, d.sortOrder),
          -1,
        ) ?? -1;
      const newSortOrder = maxSortOrder + 1;

      await onDealMove(dealData.id, targetStage.id, newSortOrder);
    } catch {
      // Invalid JSON or other error
    }
  };

  const handleCreateDeal = async (stageId: string) => {
    if (!newDealName.trim()) return;
    await onDealCreate({ name: newDealName.trim(), stageId });
    setNewDealName("");
    setCreatingInStage(null);
  };

  if (!selectedPipeline) {
    return (
      <div className="flex flex-col items-center justify-center h-[600px] text-center text-muted-foreground">
        <Filter className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-lg">Select a pipeline to view the Kanban board</p>
        <p className="text-sm mt-1">
          Or create a new pipeline from the Pipelines tab
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row gap-4 mb-4 p-4 bg-card border rounded-lg">
        <div className="flex-1 max-w-xs">
          <Select value={selectedPipelineId} onValueChange={onPipelineChange}>
            <SelectTrigger>
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

        <div className="flex-1 flex gap-2">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search deals..."
              value={filters.search}
              onChange={(e) =>
                setFilters({ ...filters, search: e.target.value })
              }
              className="pl-10"
            />
          </div>
          <Select
            value={filters.ownerId}
            onValueChange={(v) => setFilters({ ...filters, ownerId: v })}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Owner" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Owners</SelectItem>
              {/* In real app, populate from team members */}
            </SelectContent>
          </Select>
          <Select
            value={filters.status}
            onValueChange={(v) => setFilters({ ...filters, status: v })}
          >
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="">All Statuses</SelectItem>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="WON">Won</SelectItem>
              <SelectItem value="LOST">Lost</SelectItem>
            </SelectContent>
          </Select>
          {filters.search || filters.ownerId || filters.status ? (
            <Button
              variant="ghost"
              size="icon"
              onClick={() =>
                setFilters({ search: "", ownerId: "", status: "" })
              }
            >
              <X className="h-4 w-4" />
            </Button>
          ) : null}
        </div>
      </div>

      {/* Kanban Columns */}
      <div
        className="flex-1 overflow-x-auto overflow-y-hidden"
        style={{ minWidth: "100%" }}
      >
        <div
          className="flex gap-4 h-[calc(100vh-300px)] min-w-max pb-4"
          style={{ minWidth: `${pipelineStages.length * 320}px` }}
        >
          {pipelineStages.map((stage) => {
            const column = columns.find((c) => c.stage.id === stage.id);
            const deals = column?.deals ?? [];
            const stageColorClass =
              STAGE_COLORS[stage.color as keyof typeof STAGE_COLORS] ??
              STAGE_COLORS.blue;
            const badgeColorClass =
              BADGE_COLORS[stage.color as keyof typeof BADGE_COLORS] ??
              BADGE_COLORS.blue;

            return (
              <KanbanColumn
                key={stage.id}
                stage={stage}
                deals={deals}
                stageColorClass={stageColorClass}
                badgeColorClass={badgeColorClass}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, stage)}
                onAddDeal={() => setCreatingInStage(stage.id)}
                creating={creatingInStage === stage.id}
                newDealName={newDealName}
                setNewDealName={setNewDealName}
                onCreateDeal={() => handleCreateDeal(stage.id)}
                onCancelCreate={() => setCreatingInStage(null)}
                isLoading={isLoading}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface KanbanColumnProps {
  stage: KanbanStage;
  deals: KanbanDeal[];
  stageColorClass: string;
  badgeColorClass: string;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onAddDeal: () => void;
  creating: boolean;
  newDealName: string;
  setNewDealName: (name: string) => void;
  onCreateDeal: () => void;
  onCancelCreate: () => void;
  isLoading?: boolean;
}

function KanbanColumn({
  stage,
  deals,
  stageColorClass,
  badgeColorClass,
  onDragOver,
  onDrop,
  onAddDeal,
  creating,
  newDealName,
  setNewDealName,
  onCreateDeal,
  onCancelCreate,
  isLoading,
}: KanbanColumnProps) {
  const totalValue = deals.reduce((sum, d) => sum + d.value, 0);

  return (
    <div
      className={cn(
        "flex flex-col h-full min-w-[300px] max-w-[300px] rounded-lg border",
        stageColorClass,
      )}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Column Header */}
      <div className="flex items-center justify-between p-3 border-b bg-background/50 rounded-t-lg">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Badge
            variant="outline"
            className={cn("flex-shrink-0", badgeColorClass)}
          >
            {stage.name}
          </Badge>
          {stage.isWon && (
            <Badge variant="success" className="text-xs">
              Won
            </Badge>
          )}
          {stage.isLost && (
            <Badge variant="destructive" className="text-xs">
              Lost
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <span>{deals.length} deals</span>
          <Separator orientation="vertical" className="h-4" />
          <span>${totalValue.toLocaleString()}</span>
        </div>
      </div>

      {/* Deals List */}
      <div
        className="flex-1 overflow-y-auto p-2 space-y-2"
        role="list"
        aria-label={`${stage.name} deals`}
      >
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <DealCardSkeleton key={i} />)
        ) : deals.length === 0 ? (
          <div className="text-center text-muted-foreground py-8 text-sm">
            <p>No deals in this stage</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-2"
              onClick={onAddDeal}
            >
              <Plus className="h-3 w-3 mr-1" />
              Add Deal
            </Button>
          </div>
        ) : (
          deals.map((deal, index) => (
            <DealCard key={deal.id} deal={deal} index={index} />
          ))
        )}

        {/* Add Deal Form */}
        {creating && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onCreateDeal();
            }}
            className="space-y-2 p-2"
          >
            <Input
              value={newDealName}
              onChange={(e) => setNewDealName(e.target.value)}
              placeholder="Deal name"
              autoFocus
              required
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" className="flex-1">
                Create
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="flex-1"
                onClick={onCancelCreate}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {!creating && deals.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full mt-2"
            onClick={onAddDeal}
          >
            <Plus className="h-3 w-3 mr-1" />
            Add Deal
          </Button>
        )}
      </div>
    </div>
  );
}

interface DealCardProps {
  deal: KanbanDeal;
  index: number;
}

function DealCard({ deal, index }: DealCardProps) {
  const formatCurrency = (value: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  const expectedClose = formatDate(deal.expectedCloseDate);
  const isOverdue =
    expectedClose &&
    new Date(deal.expectedCloseDate!) < new Date() &&
    deal.status === "OPEN";

  return (
    <div
      className="bg-background border rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("application/json", JSON.stringify(deal));
        e.dataTransfer.effectAllowed = "move";
      }}
      role="listitem"
      tabIndex={0}
    >
      <div className="font-medium text-sm truncate">{deal.name}</div>

      {deal.value > 0 && (
        <div className="text-lg font-semibold text-primary mt-1">
          {formatCurrency(deal.value, deal.currency)}
        </div>
      )}

      <div className="flex items-center justify-between mt-2 text-xs text-muted-foreground">
        {deal.probability > 0 && <span>{deal.probability}%</span>}
        {expectedClose && (
          <span
            className={cn(
              "flex items-center gap-1",
              isOverdue && "text-red-600",
            )}
          >
            {isOverdue && "⚠"}
            {expectedClose}
          </span>
        )}
      </div>

      {deal.description && (
        <div className="mt-2 text-sm text-muted-foreground line-clamp-2">
          {deal.description}
        </div>
      )}

      {deal.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {deal.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs">
              {tag}
            </Badge>
          ))}
          {deal.tags.length > 3 && (
            <Badge variant="outline" className="text-xs">
              +{deal.tags.length - 3}
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}

function DealCardSkeleton() {
  return (
    <div className="bg-background border rounded-lg p-3 space-y-3">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-6 w-1/2" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-2/3" />
    </div>
  );
}
