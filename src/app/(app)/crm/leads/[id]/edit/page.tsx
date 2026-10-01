"use client";

import { AlertCircle, ArrowLeft, Building2, Mail, Phone } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
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

const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "UNQUALIFIED",
  "CONVERTED",
  "LOST",
] as const;

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

export default function EditLeadPage() {
  const params = useParams();
  const router = useRouter();
  const leadId = params.id as string;
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState<{
    title: string;
    contactSnapshot: {
      firstName: string;
      lastName: string;
      email: string;
      phone: string;
      companyName: string;
    };
    companyId: string;
    source: string;
    status: (typeof LEAD_STATUSES)[number];
    score: number;
    ownerId: string;
    tags: string[];
    notes: string;
    customFields: Record<string, unknown>;
  }>({
    title: "",
    contactSnapshot: {
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      companyName: "",
    },
    companyId: "",
    source: "",
    status: "NEW",
    score: 0,
    ownerId: "",
    tags: [],
    notes: "",
    customFields: {},
  });

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
        const l = data.data;
        setLead(l);
        setFormData({
          title: l.title,
          contactSnapshot: {
            firstName: l.contactSnapshot.firstName,
            lastName: l.contactSnapshot.lastName,
            email: l.contactSnapshot.email,
            phone: l.contactSnapshot.phone || "",
            companyName: l.contactSnapshot.companyName || "",
          },
          companyId: l.companyId || "",
          source: l.source,
          status: l.status,
          score: l.score,
          ownerId: l.ownerId,
          tags: l.tags || [],
          notes: l.notes || "",
          customFields: l.customFields || {},
        });
      } catch (_err) {
        toast.error("Failed to load lead");
        router.push("/crm/leads");
      } finally {
        setLoading(false);
      }
    };
    fetchLead();
  }, [leadId, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead) return;
    if (lead.status === "CONVERTED") {
      setError("Cannot edit a converted lead");
      return;
    }
    setError("");
    setSubmitting(true);

    try {
      const res = await fetch(`/api/v1/crm/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: formData.title,
          contactSnapshot: formData.contactSnapshot,
          companyId: formData.companyId || null,
          source: formData.source,
          status: formData.status,
          score: formData.score,
          ownerId: formData.ownerId,
          tags: formData.tags,
          notes: formData.notes || null,
          customFields: formData.customFields,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to update lead");
      }

      toast.success("Lead updated");
      router.push(`/crm/leads/${leadId}`);
      router.refresh();
    } catch (_err) {
      setError(_err instanceof Error ? _err.message : "Failed to update lead");
    } finally {
      setSubmitting(false);
    }
  };

  const updateContactSnapshot = (
    field: keyof typeof formData.contactSnapshot,
    value: string,
  ) => {
    setFormData({
      ...formData,
      contactSnapshot: { ...formData.contactSnapshot, [field]: value },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!lead) return null;

  if (lead.status === "CONVERTED") {
    return (
      <div className="max-w-3xl mx-auto space-y-6 text-center py-12">
        <div className="rounded-full bg-critical/10 p-4 w-fit mx-auto mb-4">
          <AlertCircle className="h-8 w-8 text-critical" />
        </div>
        <h1 className="text-2xl font-semibold text-ink-900">
          Cannot Edit Converted Lead
        </h1>
        <p className="text-ink-500 mt-2">
          This lead has been converted and cannot be modified.
        </p>
        <Link href={`/crm/leads/${leadId}`} className="mt-4 inline-block">
          <Button variant="secondary">View Lead</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/crm/leads/${leadId}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Edit Lead</h1>
          <p className="text-sm text-ink-500">Update lead information</p>
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
            <CardTitle className="text-lg">Lead Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field>
              <FieldLabel htmlFor="title">Lead Title *</FieldLabel>
              <Input
                id="title"
                value={formData.title}
                onChange={(e) =>
                  setFormData({ ...formData, title: e.target.value })
                }
                placeholder="Website Inquiry - Acme Corp"
                required
                maxLength={200}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="source">Source *</FieldLabel>
              <Input
                id="source"
                value={formData.source}
                onChange={(e) =>
                  setFormData({ ...formData, source: e.target.value })
                }
                placeholder="Website, Referral, Cold Call, etc."
                required
                maxLength={100}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="status">Status</FieldLabel>
                <Select
                  value={formData.status}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      status: v as (typeof LEAD_STATUSES)[number],
                    })
                  }
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="score">Score (0-100)</FieldLabel>
                <Input
                  id="score"
                  type="number"
                  value={formData.score.toString()}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      score: parseInt(e.target.value, 10) || 0,
                    })
                  }
                  placeholder="0"
                  min="0"
                  max="100"
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="ownerId">Owner *</FieldLabel>
              <Input
                id="ownerId"
                value={formData.ownerId}
                onChange={(e) =>
                  setFormData({ ...formData, ownerId: e.target.value })
                }
                placeholder="Owner User ID"
                required
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="tags">Tags</FieldLabel>
              <Input
                id="tags"
                value={formData.tags.join(", ")}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    tags: e.target.value
                      .split(",")
                      .map((t) => t.trim())
                      .filter(Boolean),
                  })
                }
                placeholder="tag1, tag2, tag3 (comma-separated tag IDs)"
              />
              <p className="text-xs text-ink-500">
                Enter tag IDs separated by commas
              </p>
            </Field>

            <Field>
              <FieldLabel htmlFor="notes">Notes</FieldLabel>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) =>
                  setFormData({ ...formData, notes: e.target.value })
                }
                placeholder="Additional notes..."
                rows={3}
                maxLength={2000}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-ink-500">
              Contact details captured at lead creation (stored as snapshot)
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="firstName">First Name *</FieldLabel>
                <Input
                  id="firstName"
                  value={formData.contactSnapshot.firstName}
                  onChange={(e) =>
                    updateContactSnapshot("firstName", e.target.value)
                  }
                  placeholder="John"
                  required
                  maxLength={80}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="lastName">Last Name *</FieldLabel>
                <Input
                  id="lastName"
                  value={formData.contactSnapshot.lastName}
                  onChange={(e) =>
                    updateContactSnapshot("lastName", e.target.value)
                  }
                  placeholder="Doe"
                  required
                  maxLength={80}
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="email">Email *</FieldLabel>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                <Input
                  id="email"
                  value={formData.contactSnapshot.email}
                  onChange={(e) =>
                    updateContactSnapshot("email", e.target.value.toLowerCase())
                  }
                  placeholder="john@example.com"
                  type="email"
                  className="pl-10"
                  required
                  maxLength={255}
                />
              </div>
            </Field>

            <Field>
              <FieldLabel htmlFor="phone">Phone</FieldLabel>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                <Input
                  id="phone"
                  value={formData.contactSnapshot.phone}
                  onChange={(e) =>
                    updateContactSnapshot("phone", e.target.value)
                  }
                  placeholder="+1 (555) 123-4567"
                  className="pl-10"
                  maxLength={50}
                />
              </div>
            </Field>

            <Field>
              <FieldLabel htmlFor="companyName">Company Name</FieldLabel>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                <Input
                  id="companyName"
                  value={formData.contactSnapshot.companyName}
                  onChange={(e) =>
                    updateContactSnapshot("companyName", e.target.value)
                  }
                  placeholder="Acme Corporation"
                  className="pl-10"
                  maxLength={160}
                />
              </div>
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              Company Association (Optional)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field>
              <FieldLabel htmlFor="companyId">Existing Company</FieldLabel>
              <Input
                id="companyId"
                value={formData.companyId}
                onChange={(e) =>
                  setFormData({ ...formData, companyId: e.target.value })
                }
                placeholder="Existing Company ID (optional)"
              />
              <p className="text-xs text-ink-500">
                If this lead is associated with an existing company in the CRM
              </p>
            </Field>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Link href={`/crm/leads/${leadId}`}>
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
