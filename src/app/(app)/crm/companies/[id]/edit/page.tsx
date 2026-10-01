"use client";

import { ArrowLeft, Globe, Mail, Phone } from "lucide-react";
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

const COMPANY_STATUSES = [
  "PROSPECT",
  "CUSTOMER",
  "PARTNER",
  "SUPPLIER",
  "INACTIVE",
] as const;

interface AddressInput {
  line1: string;
  line2: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

interface Company {
  _id: string;
  name: string;
  legalName?: string | null;
  industry?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  billingAddress?: AddressInput | null;
  shippingAddress?: AddressInput | null;
  ownerId: string;
  status: (typeof COMPANY_STATUSES)[number];
  tags: string[];
  notes?: string | null;
  customFields: Record<string, unknown>;
  size?: number | null;
  annualRevenue?: number | null;
  parentId?: string | null;
  domain?: string | null;
}

export default function EditCompanyPage() {
  const params = useParams();
  const router = useRouter();
  const companyId = params.id as string;
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState<{
    name: string;
    legalName: string;
    industry: string;
    website: string;
    email: string;
    phone: string;
    billingAddress: AddressInput;
    shippingAddress: AddressInput;
    ownerId: string;
    status: (typeof COMPANY_STATUSES)[number];
    tags: string[];
    notes: string;
    customFields: Record<string, unknown>;
    size: number | null;
    annualRevenue: number | null;
    parentId: string;
    domain: string;
  }>({
    name: "",
    legalName: "",
    industry: "",
    website: "",
    email: "",
    phone: "",
    billingAddress: {
      line1: "",
      line2: "",
      city: "",
      state: "",
      postalCode: "",
      country: "",
    },
    shippingAddress: {
      line1: "",
      line2: "",
      city: "",
      state: "",
      postalCode: "",
      country: "",
    },
    ownerId: "",
    status: "PROSPECT",
    tags: [],
    notes: "",
    customFields: {},
    size: null,
    annualRevenue: null,
    parentId: "",
    domain: "",
  });

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
        const c = data.data;
        setCompany(c);
        setFormData({
          name: c.name,
          legalName: c.legalName || "",
          industry: c.industry || "",
          website: c.website || "",
          email: c.email || "",
          phone: c.phone || "",
          billingAddress: c.billingAddress || {
            line1: "",
            line2: "",
            city: "",
            state: "",
            postalCode: "",
            country: "",
          },
          shippingAddress: c.shippingAddress || {
            line1: "",
            line2: "",
            city: "",
            state: "",
            postalCode: "",
            country: "",
          },
          ownerId: c.ownerId,
          status: c.status,
          tags: c.tags || [],
          notes: c.notes || "",
          customFields: c.customFields || {},
          size: c.size ?? null,
          annualRevenue: c.annualRevenue ?? null,
          parentId: c.parentId || "",
          domain: c.domain || "",
        });
      } catch (_err) {
        toast.error("Failed to load company");
        router.push("/crm/companies");
      } finally {
        setLoading(false);
      }
    };
    fetchCompany();
  }, [companyId, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!company) return;
    setError("");
    setSubmitting(true);

    try {
      const res = await fetch(`/api/v1/crm/companies/${companyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          billingAddress: formData.billingAddress.line1
            ? formData.billingAddress
            : null,
          shippingAddress: formData.shippingAddress.line1
            ? formData.shippingAddress
            : null,
          ownerId: formData.ownerId,
          tags: formData.tags,
          status: formData.status,
          notes: formData.notes || null,
          customFields: formData.customFields,
          size: formData.size,
          annualRevenue: formData.annualRevenue,
          parentId: formData.parentId || null,
          domain: formData.domain || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to update company");
      }

      toast.success("Company updated");
      router.push(`/crm/companies/${companyId}`);
      router.refresh();
    } catch (_err) {
      setError(
        _err instanceof Error ? _err.message : "Failed to update company",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const updateAddress = (
    type: "billingAddress" | "shippingAddress",
    field: keyof AddressInput,
    value: string,
  ) => {
    setFormData({
      ...formData,
      [type]: { ...formData[type], [field]: value },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!company) return null;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href={`/crm/companies/${companyId}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">Edit Company</h1>
          <p className="text-sm text-ink-500">Update company information</p>
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
            <Field>
              <FieldLabel htmlFor="name">Company Name *</FieldLabel>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                placeholder="Acme Corporation"
                required
                maxLength={160}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="legalName">Legal Name</FieldLabel>
              <Input
                id="legalName"
                value={formData.legalName}
                onChange={(e) =>
                  setFormData({ ...formData, legalName: e.target.value })
                }
                placeholder="Acme Corporation Ltd."
                maxLength={160}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="industry">Industry</FieldLabel>
                <Input
                  id="industry"
                  value={formData.industry}
                  onChange={(e) =>
                    setFormData({ ...formData, industry: e.target.value })
                  }
                  placeholder="Technology"
                  maxLength={100}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="domain">Email Domain</FieldLabel>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                  <Input
                    id="domain"
                    value={formData.domain}
                    onChange={(e) =>
                      setFormData({ ...formData, domain: e.target.value })
                    }
                    placeholder="example.com"
                    className="pl-10"
                    maxLength={255}
                  />
                </div>
                <p className="text-xs text-ink-500 mt-1">
                  Used for automatic contact association
                </p>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="website">Website</FieldLabel>
                <div className="relative">
                  <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                  <Input
                    id="website"
                    value={formData.website}
                    onChange={(e) =>
                      setFormData({ ...formData, website: e.target.value })
                    }
                    placeholder="https://example.com"
                    className="pl-10"
                    maxLength={255}
                  />
                </div>
              </Field>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                  <Input
                    id="email"
                    value={formData.email}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        email: e.target.value.toLowerCase(),
                      })
                    }
                    placeholder="contact@example.com"
                    type="email"
                    className="pl-10"
                    maxLength={255}
                  />
                </div>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="phone">Phone</FieldLabel>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" />
                <Input
                  id="phone"
                  value={formData.phone}
                  onChange={(e) =>
                    setFormData({ ...formData, phone: e.target.value })
                  }
                  placeholder="+1 (555) 123-4567"
                  className="pl-10"
                  maxLength={50}
                />
              </div>
            </Field>

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
                      status: v as (typeof COMPANY_STATUSES)[number],
                    })
                  }
                >
                  <SelectTrigger id="status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPANY_STATUSES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="size">Size (Employees)</FieldLabel>
                <Input
                  id="size"
                  type="number"
                  value={formData.size?.toString() || ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      size: e.target.value
                        ? parseInt(e.target.value, 10)
                        : null,
                    })
                  }
                  placeholder="50"
                  min="1"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="annualRevenue">Annual Revenue</FieldLabel>
                <Input
                  id="annualRevenue"
                  type="number"
                  value={formData.annualRevenue?.toString() || ""}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      annualRevenue: e.target.value
                        ? parseFloat(e.target.value)
                        : null,
                    })
                  }
                  placeholder="1000000"
                  min="0"
                  step="0.01"
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="parentId">Parent Company</FieldLabel>
              <Input
                id="parentId"
                value={formData.parentId}
                onChange={(e) =>
                  setFormData({ ...formData, parentId: e.target.value })
                }
                placeholder="Parent Company ID (optional)"
              />
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
            <CardTitle className="text-lg">Billing Address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="billing-line1">Line 1</FieldLabel>
                <Input
                  id="billing-line1"
                  value={formData.billingAddress.line1}
                  onChange={(e) =>
                    updateAddress("billingAddress", "line1", e.target.value)
                  }
                  placeholder="123 Main St"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="billing-line2">Line 2</FieldLabel>
                <Input
                  id="billing-line2"
                  value={formData.billingAddress.line2}
                  onChange={(e) =>
                    updateAddress("billingAddress", "line2", e.target.value)
                  }
                  placeholder="Suite 100"
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field>
                <FieldLabel htmlFor="billing-city">City</FieldLabel>
                <Input
                  id="billing-city"
                  value={formData.billingAddress.city}
                  onChange={(e) =>
                    updateAddress("billingAddress", "city", e.target.value)
                  }
                  placeholder="San Francisco"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="billing-state">State/Province</FieldLabel>
                <Input
                  id="billing-state"
                  value={formData.billingAddress.state}
                  onChange={(e) =>
                    updateAddress("billingAddress", "state", e.target.value)
                  }
                  placeholder="CA"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="billing-postalCode">
                  Postal Code
                </FieldLabel>
                <Input
                  id="billing-postalCode"
                  value={formData.billingAddress.postalCode}
                  onChange={(e) =>
                    updateAddress(
                      "billingAddress",
                      "postalCode",
                      e.target.value,
                    )
                  }
                  placeholder="94105"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="billing-country">Country</FieldLabel>
              <Input
                id="billing-country"
                value={formData.billingAddress.country}
                onChange={(e) =>
                  updateAddress(
                    "billingAddress",
                    "country",
                    e.target.value.toUpperCase(),
                  )
                }
                placeholder="US"
                maxLength={2}
              />
            </Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Shipping Address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="shipping-line1">Line 1</FieldLabel>
                <Input
                  id="shipping-line1"
                  value={formData.shippingAddress.line1}
                  onChange={(e) =>
                    updateAddress("shippingAddress", "line1", e.target.value)
                  }
                  placeholder="123 Main St"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="shipping-line2">Line 2</FieldLabel>
                <Input
                  id="shipping-line2"
                  value={formData.shippingAddress.line2}
                  onChange={(e) =>
                    updateAddress("shippingAddress", "line2", e.target.value)
                  }
                  placeholder="Suite 100"
                />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field>
                <FieldLabel htmlFor="shipping-city">City</FieldLabel>
                <Input
                  id="shipping-city"
                  value={formData.shippingAddress.city}
                  onChange={(e) =>
                    updateAddress("shippingAddress", "city", e.target.value)
                  }
                  placeholder="San Francisco"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="shipping-state">State/Province</FieldLabel>
                <Input
                  id="shipping-state"
                  value={formData.shippingAddress.state}
                  onChange={(e) =>
                    updateAddress("shippingAddress", "state", e.target.value)
                  }
                  placeholder="CA"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="shipping-postalCode">
                  Postal Code
                </FieldLabel>
                <Input
                  id="shipping-postalCode"
                  value={formData.shippingAddress.postalCode}
                  onChange={(e) =>
                    updateAddress(
                      "shippingAddress",
                      "postalCode",
                      e.target.value,
                    )
                  }
                  placeholder="94105"
                />
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="shipping-country">Country</FieldLabel>
              <Input
                id="shipping-country"
                value={formData.shippingAddress.country}
                onChange={(e) =>
                  updateAddress(
                    "shippingAddress",
                    "country",
                    e.target.value.toUpperCase(),
                  )
                }
                placeholder="US"
                maxLength={2}
              />
            </Field>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Link href={`/crm/companies/${companyId}`}>
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
