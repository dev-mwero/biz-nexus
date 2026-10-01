"use client";

import { format } from "date-fns";
import {
  ArrowLeft,
  Building2,
  Calendar,
  ChevronDown,
  Edit2,
  Globe,
  Mail,
  MapPin,
  Phone,
  Trash2,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
} from "@/components/ui";

const COMPANY_STATUSES = [
  "PROSPECT",
  "CUSTOMER",
  "PARTNER",
  "SUPPLIER",
  "INACTIVE",
] as const;

type CompanyStatus = (typeof COMPANY_STATUSES)[number];

interface Company {
  _id: string;
  organizationId: string;
  name: string;
  legalName?: string | null;
  industry?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  billingAddress?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  } | null;
  shippingAddress?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  } | null;
  ownerId: string;
  ownerName?: string;
  status: CompanyStatus;
  tags: string[];
  tagNames?: string[];
  notes?: string | null;
  customFields: Record<string, unknown>;
  size?: number | null;
  annualRevenue?: number | null;
  parentId?: string | null;
  parentName?: string;
  domain?: string | null;
  contactCount?: number;
  descendantContactCount?: number;
  createdAt: string | Date;
  updatedAt: string | Date;
}

const statusBadgeTone: Record<
  CompanyStatus,
  "neutral" | "positive" | "attention" | "critical" | "info" | "outline"
> = {
  PROSPECT: "outline",
  CUSTOMER: "positive",
  PARTNER: "default",
  SUPPLIER: "attention",
  INACTIVE: "critical",
};

const formatAddress = (address?: Company["billingAddress"]) => {
  if (!address) return "—";
  const parts = [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postalCode,
    address.country,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : "—";
};

export default function CompanyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const companyId = params.id as string;
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showHierarchy, setShowHierarchy] = useState(false);

  useEffect(() => {
    const fetchCompany = async () => {
      try {
        const res = await fetch(`/api/v1/crm/companies/${companyId}`);
        if (!res.ok) {
          if (res.status === 404) {
            router.push("/crm/companies");
            return;
          }
          throw new Error("Failed to fetch company");
        }
        const data = await res.json();
        setCompany(data.data);
      } catch (_err) {
        toast.error("Failed to load company");
        router.push("/crm/companies");
      } finally {
        setLoading(false);
      }
    };
    fetchCompany();
  }, [companyId, router]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/crm/companies/${companyId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete company");
      toast.success("Company deleted");
      router.push("/crm/companies");
      router.refresh();
    } catch (_err) {
      toast.error("Failed to delete company");
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

  if (!company) return null;

  const formatDateTime = (date: string | Date | null | undefined) => {
    if (!date) return "—";
    return format(new Date(date), "MMM d, yyyy h:mm a");
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/crm/companies">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-ink-900">
              {company.name}
            </h1>
            {company.legalName && company.legalName !== company.name && (
              <p className="text-sm text-ink-500">{company.legalName}</p>
            )}
            <div className="flex items-center gap-3 mt-1">
              <Badge tone={statusBadgeTone[company.status]}>
                {company.status}
              </Badge>
              {company.domain && (
                <span className="text-sm text-ink-500 flex items-center gap-1">
                  <Globe className="h-3 w-3" />
                  {company.domain}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/crm/companies/${companyId}/edit`}>
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
                    <AlertDialogTitle>Delete Company</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete this company? This action
                      cannot be undone.
                      {company.contactCount && company.contactCount > 0 && (
                        <p className="mt-2 text-sm text-warning">
                          This company has {company.contactCount} associated
                          contact(s).
                        </p>
                      )}
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

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Company Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {company.industry && (
                <div className="flex items-center gap-2 text-ink-600">
                  <Building2 className="h-4 w-4 text-ink-400" />
                  <span className="font-medium">{company.industry}</span>
                </div>
              )}

              <div className="flex flex-wrap gap-4 text-sm text-ink-600">
                {company.email && (
                  <a
                    href={`mailto:${company.email}`}
                    className="flex items-center gap-1 hover:underline"
                  >
                    <Mail className="h-4 w-4" />
                    {company.email}
                  </a>
                )}
                {company.phone && (
                  <a
                    href={`tel:${company.phone}`}
                    className="flex items-center gap-1 hover:underline"
                  >
                    <Phone className="h-4 w-4" />
                    {company.phone}
                  </a>
                )}
                {company.website && (
                  <a
                    href={company.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 hover:underline"
                  >
                    <Globe className="h-4 w-4" />
                    {company.website.replace(/^https?:\/\//, "")}
                  </a>
                )}
              </div>

              {company.size && (
                <div className="flex items-center gap-2 text-sm text-ink-600">
                  <Users className="h-4 w-4 text-ink-400" />
                  <span>Size: {company.size.toLocaleString()} employees</span>
                </div>
              )}

              {company.annualRevenue && (
                <div className="flex items-center gap-2 text-sm text-ink-600">
                  <span className="font-medium">Annual Revenue:</span>
                  <span>${company.annualRevenue.toLocaleString()}</span>
                </div>
              )}

              {company.billingAddress && (
                <div className="space-y-2 pt-4 border-t">
                  <h4 className="font-medium text-sm text-ink-700 flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    Billing Address
                  </h4>
                  <p className="text-sm text-ink-600 whitespace-pre-wrap">
                    {formatAddress(company.billingAddress)}
                  </p>
                </div>
              )}

              {company.shippingAddress && (
                <div className="space-y-2 pt-4 border-t">
                  <h4 className="font-medium text-sm text-ink-700 flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    Shipping Address
                  </h4>
                  <p className="text-sm text-ink-600 whitespace-pre-wrap">
                    {formatAddress(company.shippingAddress)}
                  </p>
                </div>
              )}

              {company.domain && (
                <div className="pt-4 border-t">
                  <h4 className="font-medium text-sm text-ink-700 flex items-center gap-1">
                    <Globe className="h-3 w-3" />
                    Email Domain
                  </h4>
                  <p className="text-sm text-ink-600">{company.domain}</p>
                  <p className="text-xs text-ink-500 mt-1">
                    Used for automatic contact-to-company association
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {company.parentId && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Hierarchy</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-ink-400" />
                  <div>
                    <p className="font-medium">Parent Company</p>
                    <p className="text-sm text-ink-500">
                      {company.parentName || company.parentId}
                    </p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowHierarchy(!showHierarchy)}
                >
                  {showHierarchy ? (
                    <ChevronUp className="h-4 w-4 mr-1" />
                  ) : (
                    <ChevronDown className="h-4 w-4 mr-1" />
                  )}
                  {showHierarchy
                    ? "Hide full hierarchy"
                    : "Show full hierarchy"}
                </Button>
                {showHierarchy && (
                  <div className="pt-4 border-t">
                    <p className="text-sm text-ink-500">
                      Full hierarchy path would be displayed here
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {company.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-ink-600">
                  {company.notes}
                </p>
              </CardContent>
            </Card>
          )}

          {Object.keys(company.customFields).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Custom Fields</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {Object.entries(company.customFields).map(([key, value]) => (
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
                    <span>{company.ownerName || company.ownerId}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-ink-500">Tags</dt>
                  <dd className="flex flex-wrap gap-1">
                    {company.tagNames && company.tagNames.length > 0 ? (
                      company.tagNames.map((tag) => (
                        <Badge key={tag} tone="neutral" className="text-xs">
                          {tag}
                        </Badge>
                      ))
                    ) : company.tags.length > 0 ? (
                      company.tags.map((tag) => (
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
                  <dt className="text-sm text-ink-500">Direct Contacts</dt>
                  <dd className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-ink-400" />
                    <span>{company.contactCount ?? 0}</span>
                  </dd>
                </div>
                {company.descendantContactCount !== undefined &&
                  company.descendantContactCount >
                    (company.contactCount ?? 0) && (
                    <div>
                      <dt className="text-sm text-ink-500">
                        Total Contacts (incl. subsidiaries)
                      </dt>
                      <dd className="flex items-center gap-2">
                        <Users className="h-4 w-4 text-ink-400" />
                        <span>{company.descendantContactCount}</span>
                      </dd>
                    </div>
                  )}
                <div>
                  <dt className="text-sm text-ink-500">Created</dt>
                  <dd className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-ink-400" />
                    <span>{formatDateTime(company.createdAt)}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-ink-500">Updated</dt>
                  <dd className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-ink-400" />
                    <span>{formatDateTime(company.updatedAt)}</span>
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-lg">Contacts</CardTitle>
              <Button asChild variant="secondary" size="sm">
                <Link href={`/crm/contacts/new?companyId=${companyId}`}>
                  <Building2 className="h-4 w-4 mr-1" />
                  Add Contact
                </Link>
              </Button>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <Users className="h-12 w-12 text-ink-300 mx-auto mb-3" />
                <p className="text-ink-500">
                  Contacts for this company are listed on the contacts page.
                </p>
                <Button asChild variant="secondary" className="mt-4" size="sm">
                  <Link href={`/crm/contacts?companyId=${companyId}`}>
                    View All Contacts
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
