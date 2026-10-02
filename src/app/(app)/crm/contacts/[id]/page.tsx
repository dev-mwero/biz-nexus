"use client";

import { format } from "date-fns";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Edit2,
  Mail,
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

const CONTACT_STATUSES = ["LEAD", "PROSPECT", "CUSTOMER", "INACTIVE"] as const;

type ContactStatus = (typeof CONTACT_STATUSES)[number];

interface Contact {
  _id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  salutation?: string | null;
  jobTitle?: string | null;
  companyId?: string | null;
  companyName?: string;
  ownerId: string;
  ownerName?: string;
  primaryEmail?: string | null;
  emails: { label: string; value: string; isPrimary: boolean }[];
  phones: { label: string; value: string; isPrimary: boolean }[];
  status: ContactStatus;
  tags: string[];
  tagNames?: string[];
  notes?: string | null;
  customFields: Record<string, unknown>;
  lastContactedAt?: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  mergedIntoId?: string | null;
}

const statusBadgeTone: Record<
  ContactStatus,
  "neutral" | "positive" | "attention" | "critical" | "info" | "outline"
> = {
  LEAD: "outline",
  PROSPECT: "attention",
  CUSTOMER: "positive",
  INACTIVE: "critical",
};

export default function ContactDetailPage() {
  const params = useParams();
  const _router = useRouter();
  const contactId = params.id as string;
  const [contact, setContact] = useState<Contact | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const fetchContact = async () => {
      try {
        const res = await fetch(`/api/v1/crm/contacts/${contactId}`);
        if (!res.ok) {
          if (res.status === 404) {
            _router.push("/crm/contacts");
            return;
          }
          throw new Error("Failed to fetch contact");
        }
        const data = await res.json();
        setContact(data.data);
      } catch (err) {
        toast.error("Failed to load contact");
        _router.push("/crm/contacts");
      } finally {
        setLoading(false);
      }
    };
    fetchContact();
  }, [contactId, _router]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/crm/contacts/${contactId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete contact");
      toast.success("Contact deleted");
      _router.push("/crm/contacts");
      _router.refresh();
    } catch (err) {
      toast.error("Failed to delete contact");
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

  if (!contact) return null;

  const formatDate = (date: string | Date | null | undefined) => {
    if (!date) return "—";
    return format(new Date(date), "MMM d, yyyy");
  };

  const formatDateTime = (date: string | Date | null | undefined) => {
    if (!date) return "—";
    return format(new Date(date), "MMM d, yyyy h:mm a");
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/crm/contacts">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-ink-900">
              {contact.salutation ? `${contact.salutation} ` : ""}
              {contact.firstName} {contact.lastName}
            </h1>
            <div className="flex items-center gap-3 mt-1">
              <Badge tone={statusBadgeTone[contact.status]}>
                {contact.status}
              </Badge>
              {contact.companyName && (
                <span className="text-sm text-ink-500 flex items-center gap-1">
                  <Building2 className="h-3 w-3" />
                  {contact.companyName}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/crm/contacts/${contactId}/edit`}>
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
                    <AlertDialogTitle>Delete Contact</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure you want to delete this contact? This action
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

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Contact Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {contact.jobTitle && (
                <div className="flex items-center gap-2 text-ink-600">
                  <span className="font-medium">{contact.jobTitle}</span>
                </div>
              )}
              <div className="flex flex-wrap gap-4 text-sm text-ink-600">
                {contact.primaryEmail && (
                  <a
                    href={`mailto:${contact.primaryEmail}`}
                    className="flex items-center gap-1 hover:underline"
                  >
                    <Mail className="h-4 w-4" />
                    {contact.primaryEmail}
                  </a>
                )}
                {contact.phones[0]?.value && (
                  <a
                    href={`tel:${contact.phones[0].value}`}
                    className="flex items-center gap-1 hover:underline"
                  >
                    <Phone className="h-4 w-4" />
                    {contact.phones[0].value}
                  </a>
                )}
              </div>

              {contact.emails.length > 1 && (
                <div className="space-y-2 pt-4 border-t">
                  <h4 className="font-medium text-sm text-ink-700">
                    All Email Addresses
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {contact.emails.map((email) => (
                      <span
                        key={email.value}
                        className="text-sm flex items-center gap-1"
                      >
                        <span className="text-ink-400">{email.label}:</span>
                        <a
                          href={`mailto:${email.value}`}
                          className="hover:underline ml-1"
                        >
                          {email.value}
                        </a>
                        {email.isPrimary && (
                          <span className="ml-1 text-xs">(Primary)</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {contact.phones.length > 1 && (
                <div className="space-y-2 pt-4 border-t">
                  <h4 className="font-medium text-sm text-ink-700">
                    All Phone Numbers
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {contact.phones.map((phone) => (
                      <span
                        key={phone.value}
                        className="text-sm flex items-center gap-1"
                      >
                        <span className="text-ink-400">{phone.label}:</span>
                        <a
                          href={`tel:${phone.value}`}
                          className="hover:underline ml-1"
                        >
                          {phone.value}
                        </a>
                        {phone.isPrimary && (
                          <span className="ml-1 text-xs">(Primary)</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {contact.notes && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-ink-600">
                  {contact.notes}
                </p>
              </CardContent>
            </Card>
          )}

          {Object.keys(contact.customFields).length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Custom Fields</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {Object.entries(contact.customFields).map(([key, value]) => (
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
                    <span>{contact.ownerName || contact.ownerId}</span>
                  </dd>
                </div>
                {contact.companyId && (
                  <div>
                    <dt className="text-sm text-ink-500">Company</dt>
                    <dd className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-ink-400" />
                      <span>{contact.companyName || contact.companyId}</span>
                    </dd>
                  </div>
                )}
                <div>
                  <dt className="text-sm text-ink-500">Tags</dt>
                  <dd className="flex flex-wrap gap-1">
                    {contact.tagNames && contact.tagNames.length > 0 ? (
                      contact.tagNames.map((tag) => (
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
                  <dt className="text-sm text-ink-500">Last Contacted</dt>
                  <dd className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-ink-400" />
                    <span>{formatDate(contact.lastContactedAt)}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-ink-500">Created</dt>
                  <dd className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-ink-400" />
                    <span>{formatDateTime(contact.createdAt)}</span>
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-ink-500">Updated</dt>
                  <dd className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-ink-400" />
                    <span>{formatDateTime(contact.updatedAt)}</span>
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {contact.mergedIntoId && (
            <Card className="border-warning bg-warning/10">
              <CardContent className="flex items-center gap-2 p-3">
                <span className="text-sm text-warning">
                  This contact has been merged into another contact.
                </span>
                <Link href={`/crm/contacts/${contact.mergedIntoId}`}>
                  <Button variant="ghost" size="sm">
                    View Target
                  </Button>
                </Link>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
