"use client";

import { format } from "date-fns";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  CheckCircle,
  Loader2,
  Mail,
  Phone,
  Target,
  User,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Field,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
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

interface Pipeline {
  _id: string;
  name: string;
  stages: Array<{
    _id: string;
    name: string;
    order: number;
    probability: number;
    isWon: boolean;
    isLost: boolean;
  }>;
}

export default function ConvertLeadPage() {
  const params = useParams();
  const router = useRouter();
  const leadId = params.id as string;
  const [lead, setLead] = useState<Lead | null>(null);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState<{
    createContact: boolean;
    createCompany: boolean;
    createDeal: boolean;
    dealName: string;
    pipelineId: string;
    stageId: string;
    dealValue: number;
    expectedCloseDate: string;
  }>({
    createContact: true,
    createCompany: true,
    createDeal: false,
    dealName: "",
    pipelineId: "",
    stageId: "",
    dealValue: 0,
    expectedCloseDate: "",
  });

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [leadRes, pipelinesRes] = await Promise.all([
          fetch(`/api/v1/crm/leads/${leadId}`),
          fetch("/api/v1/crm/pipelines"),
        ]);

        if (!leadRes.ok) {
          if (leadRes.status === 404) {
            router.push("/crm/leads");
            return;
          }
          throw new Error("Failed to fetch lead");
        }

        const leadData = await leadRes.json();
        const lead = leadData.data;
        setLead(lead);

        if (pipelinesRes.ok) {
          const pipelinesData = await pipelinesRes.json();
          setPipelines(pipelinesData.data || []);
          // Set default pipeline and stage
          if (pipelinesData.data?.length > 0) {
            const firstPipeline = pipelinesData.data[0];
            const firstStage = firstPipeline.stages?.[0];
            if (firstPipeline && firstStage) {
              setFormData({
                ...formData,
                dealName: lead.title,
                pipelineId: firstPipeline._id,
                stageId: firstStage._id,
              });
            }
          }
        }
      } catch (_err) {
        toast.error("Failed to load data");
        router.push("/crm/leads");
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [leadId, router, formData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead) return;
    if (lead.status === "CONVERTED") {
      setError("This lead has already been converted");
      return;
    }
    setError("");
    setConverting(true);
    setShowConfirm(false);

    try {
      const payload: Record<string, unknown> = {
        createContact: formData.createContact,
        createCompany:
          formData.createCompany && !!lead.contactSnapshot.companyName,
        createDeal: formData.createDeal,
        customFields: lead.customFields,
      };

      if (formData.createDeal) {
        if (!formData.dealName || !formData.pipelineId || !formData.stageId) {
          throw new Error("Deal name, pipeline, and stage are required");
        }
        payload.deal = {
          name: formData.dealName,
          pipelineId: formData.pipelineId,
          stageId: formData.stageId,
          value: formData.dealValue,
          expectedCloseDate: formData.expectedCloseDate
            ? new Date(formData.expectedCloseDate).toISOString()
            : undefined,
        };
      }

      const res = await fetch(`/api/v1/crm/leads/${leadId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to convert lead");
      }

      const data = await res.json();
      toast.success("Lead converted successfully");
      router.push(`/crm/leads/${data.data.lead._id}`);
      router.refresh();
    } catch (_err) {
      setError(_err instanceof Error ? _err.message : "Failed to convert lead");
    } finally {
      setConverting(false);
    }
  };

  const handleConfirmConvert = () => {
    setShowConfirm(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!lead) return null;

  if (lead.status === "CONVERTED") {
    return (
      <div className="max-w-3xl mx-auto space-y-6 text-center py-12">
        <div className="rounded-full bg-primary/10 p-4 w-fit mx-auto mb-4">
          <CheckCircle className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl font-semibold text-ink-900">
          Already Converted
        </h1>
        <p className="text-ink-500 mt-2">
          This lead was converted on{" "}
          {lead.convertedAt
            ? format(new Date(lead.convertedAt), "MMM d, yyyy")
            : "unknown date"}
          .
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <Link href={`/crm/leads/${leadId}`}>
            <Button variant="secondary">View Lead</Button>
          </Link>
          {lead.convertedContactId && (
            <Link href={`/crm/contacts/${lead.convertedContactId}`}>
              <Button variant="outline">View Contact</Button>
            </Link>
          )}
        </div>
      </div>
    );
  }

  const contactWillBeCreated = formData.createContact;
  const companyWillBeCreated =
    formData.createCompany && !!lead.contactSnapshot.companyName;
  const dealWillBeCreated = formData.createDeal;

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
          <h1 className="text-2xl font-semibold text-ink-900">Convert Lead</h1>
          <p className="text-sm text-ink-500">
            Convert "{lead.title}" to Contact, Company, and/or Deal
          </p>
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

      {/* Preview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Contact Preview */}
        <Card
          className={
            contactWillBeCreated
              ? "border-primary/30 bg-primary/5"
              : "opacity-50"
          }
        >
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <User className="h-5 w-5" />
                Contact
              </CardTitle>
              <Checkbox
                checked={formData.createContact}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, createContact: checked })
                }
                disabled={!lead.contactSnapshot.email}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="font-medium">
              {lead.contactSnapshot.firstName} {lead.contactSnapshot.lastName}
            </p>
            <p className="text-sm text-ink-500 flex items-center gap-1">
              <Mail className="h-3 w-3" />
              {lead.contactSnapshot.email || "—"}
            </p>
            {lead.contactSnapshot.phone && (
              <p className="text-sm text-ink-500 flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {lead.contactSnapshot.phone}
              </p>
            )}
            {lead.contactSnapshot.companyName && (
              <p className="text-sm text-ink-500 flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                {lead.contactSnapshot.companyName}
              </p>
            )}
            {!lead.contactSnapshot.email && (
              <p className="text-xs text-critical">
                Email required to create contact
              </p>
            )}
          </CardContent>
        </Card>

        {/* Company Preview */}
        <Card
          className={
            companyWillBeCreated
              ? "border-primary/30 bg-primary/5"
              : "opacity-50"
          }
        >
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Company
              </CardTitle>
              <Checkbox
                checked={formData.createCompany}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, createCompany: checked })
                }
                disabled={!lead.contactSnapshot.companyName}
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {lead.contactSnapshot.companyName ? (
              <>
                <p className="font-medium">
                  {lead.contactSnapshot.companyName}
                </p>
                {lead.contactSnapshot.email && (
                  <p className="text-xs text-ink-500">
                    Domain:{" "}
                    {lead.contactSnapshot.email.split("@")[1]?.toLowerCase()}
                  </p>
                )}
                <p className="text-xs text-ink-500">Status: PROSPECT</p>
              </>
            ) : (
              <p className="text-sm text-ink-500">
                No company name in lead snapshot
              </p>
            )}
          </CardContent>
        </Card>

        {/* Deal Preview */}
        <Card
          className={
            dealWillBeCreated ? "border-primary/30 bg-primary/5" : "opacity-50"
          }
        >
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <Target className="h-5 w-5" />
                Deal
              </CardTitle>
              <Checkbox
                checked={formData.createDeal}
                onCheckedChange={(checked) =>
                  setFormData({ ...formData, createDeal: checked })
                }
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {dealWillBeCreated ? (
              <>
                <p className="font-medium">{formData.dealName || lead.title}</p>
                <p className="text-xs text-ink-500">
                  Pipeline:{" "}
                  {pipelines.find((p) => p._id === formData.pipelineId)?.name ||
                    "Select pipeline"}
                </p>
                <p className="text-xs text-ink-500">
                  Value: ${formData.dealValue.toLocaleString()}
                </p>
              </>
            ) : (
              <p className="text-sm text-ink-500">Enable to create a deal</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Deal Configuration */}
      {dealWillBeCreated && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Deal Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field>
              <FieldLabel htmlFor="dealName">Deal Name *</FieldLabel>
              <Input
                id="dealName"
                value={formData.dealName}
                onChange={(e) =>
                  setFormData({ ...formData, dealName: e.target.value })
                }
                placeholder={lead.title}
                required
                maxLength={160}
              />
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="pipelineId">Pipeline *</FieldLabel>
                <Select
                  value={formData.pipelineId}
                  onValueChange={(v) => {
                    setFormData({ ...formData, pipelineId: v, stageId: "" });
                    const pipeline = pipelines.find((p) => p._id === v);
                    if (pipeline?.stages?.[0]) {
                      setFormData((prev) => ({
                        ...prev,
                        stageId: pipeline.stages[0]._id,
                      }));
                    }
                  }}
                  required
                >
                  <SelectTrigger id="pipelineId">
                    <SelectValue placeholder="Select pipeline" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines.map((pipeline) => (
                      <SelectItem key={pipeline._id} value={pipeline._id}>
                        {pipeline.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="stageId">Stage *</FieldLabel>
                <Select
                  value={formData.stageId}
                  onValueChange={(v) =>
                    setFormData({ ...formData, stageId: v })
                  }
                  required
                >
                  <SelectTrigger id="stageId">
                    <SelectValue placeholder="Select stage" />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelines
                      .find((p) => p._id === formData.pipelineId)
                      ?.stages?.map((stage) => (
                        <SelectItem key={stage._id} value={stage._id}>
                          {stage.name} ({stage.probability}%)
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor="dealValue">Value</FieldLabel>
                <Input
                  id="dealValue"
                  type="number"
                  value={formData.dealValue.toString()}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      dealValue: parseFloat(e.target.value) || 0,
                    })
                  }
                  placeholder="0"
                  min="0"
                  step="0.01"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="expectedCloseDate">
                  Expected Close Date
                </FieldLabel>
                <Input
                  id="expectedCloseDate"
                  type="date"
                  value={formData.expectedCloseDate}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      expectedCloseDate: e.target.value,
                    })
                  }
                />
              </Field>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Lead Tags */}
      {lead.tags.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TagIcon className="h-5 w-5" />
              Tags to Transfer
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
            <p className="text-xs text-ink-500 mt-2">
              These tags will be applied to the created Contact, Company, and
              Deal.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Convert Button */}
      <AlertDialog open={showConfirm} onOpenChange={setShowConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Convert Lead?</AlertDialogTitle>
            <AlertDialogDescription>
              This will create a Contact{" "}
              {companyWillBeCreated ? ", Company" : ""}{" "}
              {dealWillBeCreated ? ", and Deal" : ""} from this lead. The lead
              will be marked as CONVERTED and cannot be edited further. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleSubmit} disabled={converting}>
              {converting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Converting...
                </span>
              ) : (
                <>
                  <ArrowRight className="h-4 w-4 mr-2" />
                  Convert Lead
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="flex justify-end gap-3 pt-4 border-t">
        <Link href={`/crm/leads/${leadId}`}>
          <Button variant="secondary" disabled={converting}>
            Cancel
          </Button>
        </Link>
        <Button onClick={handleConfirmConvert} disabled={converting} size="lg">
          {converting ? (
            <span className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Converting...
            </span>
          ) : (
            <>
              <ArrowRight className="h-4 w-4 mr-2" />
              Convert Lead
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
