"use client";

import { format } from "date-fns";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Calendar,
  Edit,
  Mail,
  Phone,
  RefreshCw,
  Tag,
  Target,
  Trash2,
  User,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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
  IconButton,
  Separator,
} from "@/components/ui";

const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "UNQUALIFIED",
  "CONVERTED",
  "LOST",
] as const;

const statusBadgeConfig: Record<
  string,
  { variant: "default" | "success" | "warning" | "danger" | "outline" }
> = {
  NEW: { variant: "outline" },
  CONTACTED: { variant: "default" },
  QUALIFIED: { variant: "success" },
  UNQUALIFIED: { variant: "danger" },
  CONVERTED: { variant: "success" },
  LOST: { variant: "danger" },
};

interface Lead {
  _id: string;
  title: string;
  contactId?: string | null;
  contactSnapshot: {
    firstName: string;
    lastName: string;
    email: string;
    phone?: string | null;
    companyName?: string | null;
  };
  companyId?: string | null;
  source: string;
  status: (typeof LEAD_STATUSES)[number];
  score: number;
  ownerId: string;
  tags: string[];
  notes?: string | null;
  customFields: Record<string, unknown>;
  convertedAt?: string | Date | null;
  convertedContactId?: string | null;
  convertedCompanyId?: string | null;
  convertedDealId?: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export default function LeadDetailPage() {
  const params = useParams();
  const router = useRouter();
  const leadId = params.id as string;
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [_deleting, setDeleting] = useState(false);

  useEffect(() => {
    const fetchLead = async () => {
      try {
        const res = await fetch(`/api/v1/crm/leads/${leadId}`);
        if (!res.ok) {
          if (res.status === 404) {
            router.push("/crm/leads");
            return;
          }
          throw new Error("Failed to fetch lead");
        }
        const data = await res.json();
        setLead(data.data);
      } catch (_err) {
        toast.error("Failed to load lead");
        router.push("/crm/leads");
      } finally {
        setLoading(false);
      }
    };
    fetchLead();
  }, [leadId, router]);

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete this lead?")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/crm/leads/${leadId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete lead");
      toast.success("Lead deleted");
      router.push("/crm/leads");
      router.refresh();
    } catch (_err) {
      toast.error("Failed to delete lead");
    } finally {
      setDeleting(false);
    }
  };

  const handleConvert = () => {
    router.push(`/crm/leads/${leadId}/convert`);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!lead) return null;

  const isConverted = lead.status === "CONVERTED";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link href="/crm/leads">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold text-ink-900">
                {lead.title}
              </h1>
              <Badge
                variant={statusBadgeConfig[lead.status]?.variant || "outline"}
              >
                {lead.status}
              </Badge>
            </div>
            <p className="text-sm text-ink-500 mt-1">
              Source: {lead.source} • Score: {lead.score}
            </p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton variant="ghost" size="sm" aria-label="More actions">
              <Target className="h-4 w-4" />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <Link href={`/crm/leads/${leadId}/edit`}>
              <DropdownMenuItem>
                <Edit className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
            </Link>
            {!isConverted && (
              <DropdownMenuItem onClick={handleConvert}>
                <ArrowRight className="h-4 w-4 mr-2" />
                Convert Lead
              </DropdownMenuItem>
            )}
            {isConverted && lead.convertedContactId && (
              <DropdownMenuItem>
                <RefreshCw className="h-4 w-4 mr-2" />
                Converted to Contact
              </DropdownMenuItem>
            )}
            <Separator />
            <DropdownMenuItem onClick={handleDelete} className="text-critical">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Contact Snapshot */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="h-5 w-5" />
                Contact Snapshot
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-primary font-semibold text-lg">
                    {lead.contactSnapshot.firstName[0]}
                    {lead.contactSnapshot.lastName[0]}
                  </span>
                </div>
                <div>
                  <p className="font-medium text-lg">
                    {lead.contactSnapshot.firstName}{" "}
                    {lead.contactSnapshot.lastName}
                  </p>
                  {lead.contactSnapshot.companyName && (
                    <p className="text-sm text-ink-500 flex items-center gap-1">
                      <Building2 className="h-3 w-3" />
                      {lead.contactSnapshot.companyName}
                    </p>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t">
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="h-4 w-4 text-ink-400" />
                  <a
                    href={`mailto:${lead.contactSnapshot.email}`}
                    className="text-ink-600 hover:underline"
                  >
                    {lead.contactSnapshot.email}
                  </a>
                </div>
                {lead.contactSnapshot.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="h-4 w-4 text-ink-400" />
                    <a
                      href={`tel:${lead.contactSnapshot.phone}`}
                      className="text-ink-600 hover:underline"
                    >
                      {lead.contactSnapshot.phone}
                    </a>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Conversion Info */}
          {isConverted && (
            <Card className="border-success/30 bg-success/5">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2 text-success">
                  <RefreshCw className="h-5 w-5" />
                  Conversion Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  {lead.convertedContactId && (
                    <div>
                      <p className="text-xs text-ink-500">Converted Contact</p>
                      <p className="font-mono text-sm">
                        {lead.convertedContactId}
                      </p>
                    </div>
                  )}
                  {lead.convertedCompanyId && (
                    <div>
                      <p className="text-xs text-ink-500">Converted Company</p>
                      <p className="font-mono text-sm">
                        {lead.convertedCompanyId}
                      </p>
                    </div>
                  )}
                  {lead.convertedDealId && (
                    <div>
                      <p className="text-xs text-ink-500">Converted Deal</p>
                      <p className="font-mono text-sm">
                        {lead.convertedDealId}
                      </p>
                    </div>
                  )}
                </div>
                {lead.convertedAt && (
                  <div className="pt-2 border-t flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-ink-400" />
                    <span>
                      Converted on{" "}
                      {format(new Date(lead.convertedAt), "MMM d, yyyy HH:mm")}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Notes */}
          {lead.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-ink-600">{lead.notes}</p>
              </CardContent>
            </Card>
          )}

          {/* Tags */}
          {lead.tags.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Tag className="h-5 w-5" />
                  Tags
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {lead.tags.map((tagId) => (
                    <Badge key={tagId} variant="outline">
                      {tagId}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-ink-500 uppercase tracking-wide">
                  Owner
                </p>
                <p className="font-mono text-sm">{lead.ownerId}</p>
              </div>
              <div>
                <p className="text-xs text-ink-500 uppercase tracking-wide">
                  Created
                </p>
                <p className="text-sm">
                  {format(new Date(lead.createdAt), "MMM d, yyyy HH:mm")}
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-500 uppercase tracking-wide">
                  Updated
                </p>
                <p className="text-sm">
                  {format(new Date(lead.updatedAt), "MMM d, yyyy HH:mm")}
                </p>
              </div>
              {lead.companyId && (
                <div>
                  <p className="text-xs text-ink-500 uppercase tracking-wide">
                    Company ID
                  </p>
                  <p className="font-mono text-sm">{lead.companyId}</p>
                </div>
              )}
              {lead.contactId && (
                <div>
                  <p className="text-xs text-ink-500 uppercase tracking-wide">
                    Contact ID
                  </p>
                  <p className="font-mono text-sm">{lead.contactId}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Custom Fields */}
          {Object.keys(lead.customFields).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Custom Fields</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="space-y-3">
                  {Object.entries(lead.customFields).map(([key, value]) => (
                    <div key={key} className="flex justify-between text-sm">
                      <dt className="text-ink-500 capitalize">
                        {key.replace(/_/g, " ")}
                      </dt>
                      <dd className="font-medium text-ink-900">
                        {String(value)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          )}

          {!isConverted && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="pt-6">
                <Button className="w-full" size="lg" onClick={handleConvert}>
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Convert Lead
                </Button>
                <p className="text-center text-xs text-ink-500 mt-2">
                  Creates Contact, Company, and/or Deal
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
