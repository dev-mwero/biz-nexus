"use client";

import { format } from "date-fns";
import {
  ArrowLeft,
  Building2,
  Calendar,
  DollarSign,
  Edit2,
  Mail,
  MessageCircle,
  MessageSquare,
  Phone,
  RotateCcw,
  Target,
  Trash2,
  Trophy,
  Users,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogActions,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
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
  Input,
  Label,
  ScrollArea,
  Separator,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { cn } from "@/shared/lib/cn";
import { formatRelativeTime } from "@/shared/lib/format";

const DEAL_STATUSES = ["OPEN", "WON", "LOST"] as const;
type DealStatus = (typeof DEAL_STATUSES)[number];

const statusBadgeTone: Record<
  DealStatus,
  "neutral" | "positive" | "attention" | "critical" | "info" | "outline"
> = {
  OPEN: "info",
  WON: "positive",
  LOST: "critical",
};

interface Deal {
  _id: string;
  organizationId: string;
  name: string;
  companyId?: string | null;
  companyName?: string;
  contactId?: string | null;
  contactName?: string;
  pipelineId: string;
  pipelineName?: string;
  stageId: string;
  stageName?: string;
  ownerId: string;
  ownerName?: string;
  value: number;
  currency: string;
  probability: number;
  status: DealStatus;
  expectedCloseDate: string | Date | null;
  closedAt: string | Date | null;
  lostReason: string | null;
  description: string | null;
  sortOrder: number;
  tags: string[];
  tagNames?: string[];
  customFields: Record<string, unknown>;
  createdAt: string | Date;
  updatedAt: string | Date;
}

interface ActivityItem {
  _id: string;
  title: string;
  type: string;
  occurredAt: string;
  metadata?: Record<string, unknown>;
}

const ACTIVITY_ICONS: Record<
  string,
  React.ComponentType<{ className?: string }>
> = {
  NOTE: () => <Mail className="h-4 w-4" />,
  CALL: () => <Phone className="h-4 w-4" />,
  MEETING: () => <Calendar className="h-4 w-4" />,
  STAGE_CHANGE: () => <RotateCcw className="h-4 w-4" />,
  EMAIL: () => <Mail className="h-4 w-4" />,
  SMS: () => <MessageCircle className="h-4 w-4" />,
  WHATSAPP: () => <MessageSquare className="h-4 w-4" />,
  SYSTEM_EVENT: () => <Mail className="h-4 w-4" />,
  TASK: () => <Target className="h-4 w-4" />,
};

export default function DealDetailPage() {
  const params = useParams();
  const router = useRouter();
  const dealId = params.id as string;
  const [deal, setDeal] = useState<Deal | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [winning, setWinning] = useState(false);
  const [losing, setLosing] = useState(false);
  const [loseReason, setLoseReason] = useState("");
  const [showLoseDialog, setShowLoseDialog] = useState(false);
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(true);
  const [hasMoreActivities, setHasMoreActivities] = useState(true);
  const [activitiesPage, setActivitiesPage] = useState(1);

  const fetchDeal = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/deals/${dealId}`);
      if (!res.ok) {
        if (res.status === 404) {
          router.push("/deals");
          return;
        }
        throw new Error("Failed to fetch deal");
      }
      const data = await res.json();
      setDeal(data.data);
    } catch (err) {
      toast.error("Failed to load deal");
      router.push("/deals");
    } finally {
      setLoading(false);
    }
  }, [dealId, router]);

  const fetchActivities = useCallback(
    async (page = 1, append = false) => {
      if (page === 1) setActivitiesLoading(true);
      try {
        const res = await fetch(
          `/api/v1/deals/${dealId}/timeline?page=${page}&pageSize=25`,
        );
        if (!res.ok) throw new Error("Failed to fetch activities");
        const data = await res.json();
        const newActivities = data.data || [];
        setActivities((prev) =>
          append ? [...prev, ...newActivities] : newActivities,
        );
        setHasMoreActivities(data.meta?.totalPages > page);
      } catch (err) {
        console.error("Failed to load activities:", err);
      } finally {
        if (page === 1) setActivitiesLoading(false);
      }
    },
    [dealId],
  );

  const loadMoreActivities = useCallback(() => {
    fetchActivities(activitiesPage + 1, true);
    setActivitiesPage((prev) => prev + 1);
  }, [activitiesPage, fetchActivities]);

  useEffect(() => {
    fetchDeal();
    fetchActivities(1);
  }, [fetchDeal, fetchActivities]);

  const formatCurrency = (value: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  const formatDate = (date: string | Date | null | undefined) => {
    if (!date) return "—";
    return format(new Date(date), "MMM d, yyyy");
  };

  const formatDateTime = (date: string | Date | null | undefined) => {
    if (!date) return "—";
    return format(new Date(date), "MMM d, yyyy h:mm a");
  };

  const handleWin = async () => {
    if (!deal) return;
    setWinning(true);
    try {
      const res = await fetch(`/api/v1/deals/${dealId}/win`, {
        method: "POST",
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error?.message || "Failed to mark as won");
      }
      toast.success("Deal marked as won");
      fetchDeal();
      fetchActivities(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to mark as won");
    } finally {
      setWinning(false);
    }
  };

  const handleLose = async () => {
    if (!deal) return;
    setLosing(true);
    try {
      const res = await fetch(`/api/v1/deals/${dealId}/lose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: loseReason }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error?.message || "Failed to mark as lost");
      }
      toast.success("Deal marked as lost");
      setShowLoseDialog(false);
      setLoseReason("");
      fetchDeal();
      fetchActivities(1);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to mark as lost",
      );
    } finally {
      setLosing(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/deals/${dealId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete deal");
      toast.success("Deal deleted");
      router.push("/deals");
      router.refresh();
    } catch (err) {
      toast.error("Failed to delete deal");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!deal) return null;

  const isOverdue =
    deal.expectedCloseDate &&
    new Date(deal.expectedCloseDate) < new Date() &&
    deal.status === "OPEN";

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/deals">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-ink-900">{deal.name}</h1>
            <div className="flex items-center gap-3 mt-1">
              <Badge tone={statusBadgeTone[deal.status]}>{deal.status}</Badge>
              {deal.pipelineName && (
                <span className="text-sm text-ink-500 flex items-center gap-1">
                  <Target className="h-3 w-3" />
                  {deal.pipelineName} / {deal.stageName}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {deal.status === "OPEN" && (
            <>
              <Button
                variant="secondary"
                onClick={handleWin}
                disabled={winning}
              >
                <Trophy className="h-4 w-4 mr-2" />
                Mark Won
              </Button>
              <Button
                variant="destructive"
                onClick={() => setShowLoseDialog(true)}
                disabled={losing}
              >
                <XCircle className="h-4 w-4 mr-2" />
                Mark Lost
              </Button>
            </>
          )}
          <Link href={`/deals/${dealId}/edit`}>
            <Button variant="secondary">
              <Edit2 className="h-4 w-4 mr-2" />
              Edit
            </Button>
          </Link>
          <DropdownMenu>
            <DropdownMenuTrigger>
              <Button variant="ghost" size="sm" aria-label="More actions">
                <Trash2 className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <AlertDialog>
                <AlertDialogTrigger>
                  <DropdownMenuItem className="text-red-600 focus:text-red-600">
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete Deal</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete this deal? This action
                      cannot be undone.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogActions
                    confirmLabel="Delete"
                    cancelLabel="Cancel"
                    destructive
                    onConfirm={handleDelete}
                    confirmLoading={deleting}
                  />
                </AlertDialogContent>
              </AlertDialog>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Tabs defaultValue="details" className="space-y-6">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Deal Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <dt className="text-sm text-ink-500">Value</dt>
                      <dd className="text-2xl font-semibold text-ink-900">
                        {formatCurrency(deal.value, deal.currency)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-ink-500">Probability</dt>
                      <dd className="text-2xl font-semibold text-ink-900">
                        {deal.probability}%
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-ink-500">Expected Close</dt>
                      <dd
                        className={cn(
                          "font-medium",
                          isOverdue && "text-red-600",
                        )}
                      >
                        {deal.expectedCloseDate
                          ? formatDate(deal.expectedCloseDate)
                          : "—"}
                        {isOverdue && (
                          <span className="ml-1 text-sm">⚠ Overdue</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-ink-500">Status</dt>
                      <dd className="font-medium">
                        <Badge tone={statusBadgeTone[deal.status]}>
                          {deal.status}
                        </Badge>
                      </dd>
                    </div>
                    {deal.closedAt && (
                      <div>
                        <dt className="text-sm text-ink-500">Closed</dt>
                        <dd className="font-medium">
                          {formatDate(deal.closedAt)}
                        </dd>
                      </div>
                    )}
                    {deal.lostReason && deal.status === "LOST" && (
                      <div>
                        <dt className="text-sm text-ink-500">Lost Reason</dt>
                        <dd className="font-medium text-red-600">
                          {deal.lostReason}
                        </dd>
                      </div>
                    )}
                  </div>

                  {deal.description && (
                    <div className="pt-4 border-t">
                      <h4 className="font-medium text-sm text-ink-700 mb-2">
                        Description
                      </h4>
                      <p className="whitespace-pre-wrap text-ink-600">
                        {deal.description}
                      </p>
                    </div>
                  )}

                  {deal.companyName && (
                    <div className="pt-4 border-t">
                      <h4 className="font-medium text-sm text-ink-700 mb-2">
                        Company
                      </h4>
                      <p className="flex items-center gap-2 text-ink-600">
                        <Building2 className="h-4 w-4 text-ink-400" />
                        {deal.companyName}
                      </p>
                    </div>
                  )}

                  {deal.contactName && (
                    <div className="pt-4 border-t">
                      <h4 className="font-medium text-sm text-ink-700 mb-2">
                        Contact
                      </h4>
                      <p className="flex items-center gap-2 text-ink-600">
                        <Target className="h-4 w-4 text-ink-400" />
                        {deal.contactName}
                      </p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {Object.keys(deal.customFields).length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Custom Fields</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {Object.entries(deal.customFields).map(([key, value]) => (
                        <div key={key}>
                          <dt className="text-sm text-ink-500">{key}</dt>
                          <dd className="text-sm font-medium text-ink-900">
                            {typeof value === "object"
                              ? JSON.stringify(value)
                              : String(value)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Details</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <dl className="space-y-4">
                    <div>
                      <dt className="text-sm text-ink-500">Owner</dt>
                      <dd className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-ink-400" />
                        <span>{deal.ownerName || deal.ownerId}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-ink-500">Pipeline</dt>
                      <dd className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-ink-400" />
                        <span>{deal.pipelineName || deal.pipelineId}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-ink-500">Stage</dt>
                      <dd className="flex items-center gap-2">
                        <Target className="h-4 w-4 text-ink-400" />
                        <span>{deal.stageName || deal.stageId}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-ink-500">Tags</dt>
                      <dd className="flex flex-wrap gap-1">
                        {deal.tagNames && deal.tagNames.length > 0 ? (
                          deal.tagNames.map((tag) => (
                            <Badge key={tag} tone="neutral" className="text-xs">
                              {tag}
                            </Badge>
                          ))
                        ) : (
                          <span className="text-ink-400 text-sm">—</span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-ink-500">Created</dt>
                      <dd className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-ink-400" />
                        <span>{formatDateTime(deal.createdAt)}</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-sm text-ink-500">Updated</dt>
                      <dd className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-ink-400" />
                        <span>{formatDateTime(deal.updatedAt)}</span>
                      </dd>
                    </div>
                  </dl>
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="timeline">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Activity Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ScrollArea className="max-h-[600px]">
                {activitiesLoading ? (
                  <div className="space-y-3">
                    {Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <Skeleton className="h-8 w-8 rounded-lg flex-shrink-0" />
                        <div className="flex-1 space-y-1">
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-3 w-1/2" />
                          <Skeleton className="h-3 w-1/4" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : activities.length === 0 ? (
                  <div className="text-center py-8 text-ink-500">
                    No activity yet
                  </div>
                ) : (
                  <div className="space-y-3">
                    {activities.map((activity) => {
                      const Icon =
                        ACTIVITY_ICONS[activity.type] ||
                        (() => <Mail className="h-4 w-4" />);
                      const typeLabel = activity.type
                        .replace(/_/g, " ")
                        .toLowerCase();

                      return (
                        <div
                          key={activity._id}
                          className="flex items-start gap-3"
                        >
                          <div
                            className={cn(
                              "flex h-8 w-8 items-center justify-center rounded-lg flex-shrink-0 bg-surface-sunken dark:bg-surface-raised",
                            )}
                            aria-hidden="true"
                          >
                            <Icon className="text-ink-500 dark:text-ink-400" />
                          </div>
                          <div className="flex-1 min-w-0 space-y-1">
                            <p className="text-sm font-medium text-ink-900 dark:text-ink-50">
                              {activity.title}
                            </p>
                            <div className="flex items-center gap-2 text-xs text-ink-500 dark:text-ink-400">
                              <span className="font-medium text-ink-600 dark:text-ink-400 capitalize">
                                {typeLabel}
                              </span>
                              <span aria-hidden="true">•</span>
                              <time dateTime={activity.occurredAt}>
                                {formatRelativeTime(activity.occurredAt)}
                              </time>
                            </div>
                            {activity.metadata?.fromStage &&
                              activity.metadata?.toStage && (
                                <div className="text-xs text-ink-500">
                                  From:{" "}
                                  <span className="font-medium">
                                    {activity.metadata.fromStage.stageName}
                                  </span>{" "}
                                  → To:{" "}
                                  <span className="font-medium">
                                    {activity.metadata.toStage.stageName}
                                  </span>
                                </div>
                              )}
                          </div>
                        </div>
                      );
                    })}
                    {hasMoreActivities && (
                      <div className="text-center pt-4">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={loadMoreActivities}
                          disabled={activitiesLoading}
                        >
                          Load more
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={showLoseDialog} onOpenChange={setShowLoseDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Deal as Lost</AlertDialogTitle>
            <AlertDialogDescription>
              This will move the deal to the lost stage. Please provide a
              reason.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="loseReason">Reason</Label>
              <Input
                id="loseReason"
                value={loseReason}
                onChange={(e) => setLoseReason(e.target.value)}
                placeholder="Why was this deal lost?"
              />
            </div>
          </div>
          <AlertDialogActions>
            <AlertDialogActions.Cancel>Cancel</AlertDialogActions.Cancel>
            <AlertDialogActions.Confirm
              onConfirm={handleLose}
              confirmLoading={losing}
            >
              Mark Lost
            </AlertDialogActions.Confirm>
          </AlertDialogActions>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
