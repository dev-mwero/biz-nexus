"use client";

import { ArrowLeft, Mail, Phone, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
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

const CONTACT_STATUSES = ["LEAD", "PROSPECT", "CUSTOMER", "INACTIVE"] as const;

/**
 * Email/phone rows as held in form state. `rowKey` is client-only identity for
 * React: a row has no id until it is saved, and every field on it is editable,
 * so neither the array index nor the row's own content can key it. It is
 * stripped from the request payload.
 */
interface EmailInput {
  rowKey: string;
  label: string;
  value: string;
  isPrimary: boolean;
}

interface PhoneInput {
  rowKey: string;
  label: string;
  value: string;
  isPrimary: boolean;
}

/** Payload shape: form bookkeeping (`rowKey`) is not part of the request. */
function toEmailPayload({ label, value, isPrimary }: EmailInput) {
  return { label, value, isPrimary };
}

function toPhonePayload({ label, value, isPrimary }: PhoneInput) {
  return { label, value, isPrimary };
}

export default function NewContactPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState<{
    firstName: string;
    lastName: string;
    salutation: string;
    jobTitle: string;
    companyId: string;
    ownerId: string;
    status: (typeof CONTACT_STATUSES)[number];
    tags: string[];
    notes: string;
    customFields: Record<string, unknown>;
  }>({
    firstName: "",
    lastName: "",
    salutation: "",
    jobTitle: "",
    companyId: "",
    ownerId: "",
    status: "LEAD",
    tags: [],
    notes: "",
    customFields: {},
  });
  const rowCounter = useRef(0);
  const nextRowKey = () => `row-${rowCounter.current++}`;
  const [emails, setEmails] = useState<EmailInput[]>([
    { rowKey: "row-0", label: "Work", value: "", isPrimary: true },
  ]);
  const [phones, setPhones] = useState<PhoneInput[]>([
    { rowKey: "row-0", label: "Mobile", value: "", isPrimary: true },
  ]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const validEmails = emails.filter((e) => e.value.trim());
    const validPhones = phones.filter((p) => p.value.trim());

    if (validEmails.length > 0 && !validEmails.some((e) => e.isPrimary)) {
      validEmails[0].isPrimary = true;
    }
    if (validPhones.length > 0 && !validPhones.some((p) => p.isPrimary)) {
      validPhones[0].isPrimary = true;
    }

    try {
      const res = await fetch("/api/v1/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          emails: validEmails.map(toEmailPayload),
          phones: validPhones.map(toPhonePayload),
          companyId: formData.companyId || null,
          ownerId: formData.ownerId,
          tags: formData.tags,
          status: formData.status,
          notes: formData.notes || null,
          customFields: formData.customFields,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to create contact");
      }

      const data = await res.json();
      toast.success("Contact created");
      router.push(`/crm/contacts/${data.data._id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create contact");
    } finally {
      setSubmitting(false);
    }
  };

  const addEmail = () => {
    setEmails([
      ...emails,
      { rowKey: nextRowKey(), label: "Work", value: "", isPrimary: false },
    ]);
  };

  const removeEmail = (index: number) => {
    setEmails(emails.filter((_, i) => i !== index));
  };

  const updateEmail = (
    index: number,
    field: keyof EmailInput,
    value: string | boolean,
  ) => {
    setEmails(
      emails.map((e, i) =>
        i === index
          ? { ...e, [field]: value }
          : {
              ...e,
              isPrimary: field === "isPrimary" && value ? false : e.isPrimary,
            },
      ),
    );
    if (field === "isPrimary" && value === true) {
      setEmails(
        emails.map((e, i) =>
          i === index ? { ...e, isPrimary: true } : { ...e, isPrimary: false },
        ),
      );
    }
  };

  const addPhone = () => {
    setPhones([
      ...phones,
      { rowKey: nextRowKey(), label: "Mobile", value: "", isPrimary: false },
    ]);
  };

  const removePhone = (index: number) => {
    setPhones(phones.filter((_, i) => i !== index));
  };

  const updatePhone = (
    index: number,
    field: keyof PhoneInput,
    value: string | boolean,
  ) => {
    setPhones(
      phones.map((p, i) =>
        i === index
          ? { ...p, [field]: value }
          : {
              ...p,
              isPrimary: field === "isPrimary" && value ? false : p.isPrimary,
            },
      ),
    );
    if (field === "isPrimary" && value === true) {
      setPhones(
        phones.map((p, i) =>
          i === index ? { ...p, isPrimary: true } : { ...p, isPrimary: false },
        ),
      );
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/crm/contacts">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">New Contact</h1>
          <p className="text-sm text-ink-500">Add a new contact to your CRM</p>
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
            <CardTitle className="text-lg">Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="firstName">First Name *</FieldLabel>
                <Input
                  id="firstName"
                  value={formData.firstName}
                  onChange={(e) =>
                    setFormData({ ...formData, firstName: e.target.value })
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
                  value={formData.lastName}
                  onChange={(e) =>
                    setFormData({ ...formData, lastName: e.target.value })
                  }
                  placeholder="Doe"
                  required
                  maxLength={80}
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field>
                <FieldLabel htmlFor="salutation">Salutation</FieldLabel>
                <Select
                  value={formData.salutation || ""}
                  onValueChange={(v) =>
                    setFormData({ ...formData, salutation: v || "" })
                  }
                >
                  <SelectTrigger id="salutation">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">None</SelectItem>
                    <SelectItem value="Mr.">Mr.</SelectItem>
                    <SelectItem value="Ms.">Ms.</SelectItem>
                    <SelectItem value="Mrs.">Mrs.</SelectItem>
                    <SelectItem value="Dr.">Dr.</SelectItem>
                    <SelectItem value="Prof.">Prof.</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="jobTitle">Job Title</FieldLabel>
                <Input
                  id="jobTitle"
                  value={formData.jobTitle}
                  onChange={(e) =>
                    setFormData({ ...formData, jobTitle: e.target.value })
                  }
                  placeholder="Software Engineer"
                  maxLength={100}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="companyId">Company</FieldLabel>
                <Input
                  id="companyId"
                  value={formData.companyId}
                  onChange={(e) =>
                    setFormData({ ...formData, companyId: e.target.value })
                  }
                  placeholder="Company ID (optional)"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                <FieldLabel htmlFor="status">Status</FieldLabel>
                <Select
                  value={formData.status}
                  onValueChange={(v) =>
                    setFormData({
                      ...formData,
                      status: v as (typeof CONTACT_STATUSES)[number],
                    })
                  }
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTACT_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

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
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Email Addresses</CardTitle>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addEmail}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Email
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {emails.map((email, index) => (
              <div
                key={email.rowKey}
                className="flex flex-col sm:flex-row gap-3 items-start"
              >
                <div className="flex-1 space-y-1.5">
                  <Field>
                    <FieldLabel htmlFor={`email-label-${index}`}>
                      Label
                    </FieldLabel>
                    <Input
                      id={`email-label-${index}`}
                      value={email.label}
                      onChange={(e) =>
                        updateEmail(index, "label", e.target.value)
                      }
                      placeholder="Work"
                      maxLength={40}
                    />
                  </Field>
                </div>
                <div className="flex-1 space-y-1.5">
                  <Field>
                    <FieldLabel htmlFor={`email-value-${index}`}>
                      Email Address *
                    </FieldLabel>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                      <Input
                        id={`email-value-${index}`}
                        value={email.value}
                        onChange={(e) =>
                          updateEmail(index, "value", e.target.value)
                        }
                        placeholder="john@example.com"
                        type="email"
                        className="pl-10"
                      />
                    </div>
                  </Field>
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={email.isPrimary}
                      onChange={(e) =>
                        updateEmail(index, "isPrimary", e.target.checked)
                      }
                      className="h-4 w-4"
                    />
                    <span className="text-sm">Primary</span>
                  </label>
                  {emails.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removeEmail(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-lg">Phone Numbers</CardTitle>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={addPhone}
            >
              <Plus className="h-4 w-4 mr-1" />
              Add Phone
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {phones.map((phone, index) => (
              <div
                key={phone.rowKey}
                className="flex flex-col sm:flex-row gap-3 items-start"
              >
                <div className="flex-1 space-y-1.5">
                  <Field>
                    <FieldLabel htmlFor={`phone-label-${index}`}>
                      Label
                    </FieldLabel>
                    <Input
                      id={`phone-label-${index}`}
                      value={phone.label}
                      onChange={(e) =>
                        updatePhone(index, "label", e.target.value)
                      }
                      placeholder="Mobile"
                      maxLength={40}
                    />
                  </Field>
                </div>
                <div className="flex-1 space-y-1.5">
                  <Field>
                    <FieldLabel htmlFor={`phone-value-${index}`}>
                      Phone Number *
                    </FieldLabel>
                    <div className="relative">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                      <Input
                        id={`phone-value-${index}`}
                        value={phone.value}
                        onChange={(e) =>
                          updatePhone(index, "value", e.target.value)
                        }
                        placeholder="+1 (555) 123-4567"
                        className="pl-10"
                        maxLength={50}
                      />
                    </div>
                  </Field>
                </div>
                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={phone.isPrimary}
                      onChange={(e) =>
                        updatePhone(index, "isPrimary", e.target.checked)
                      }
                      className="h-4 w-4"
                    />
                    <span className="text-sm">Primary</span>
                  </label>
                  {phones.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => removePhone(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Link href="/crm/contacts">
            <Button type="button" variant="secondary">
              Cancel
            </Button>
          </Link>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating..." : "Create Contact"}
          </Button>
        </div>
      </form>
    </div>
  );
}
