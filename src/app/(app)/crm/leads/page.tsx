"use client";

import { format } from "date-fns";
import {
  AlertCircle,
  Building2,
  Mail,
  Phone,
  Target,
  TrendingUp,
  Users,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { ListPage } from "../ListPage";

export default function LeadsPage() {
  const columns = [
    {
      key: "title",
      header: "Title",
      sortable: true,
      render: (row: any) => (
        <div>
          <p className="font-medium">{row.title}</p>
          <p className="text-xs text-ink-500 flex items-center gap-1">
            <Mail className="h-3 w-3" />
            {row.contactSnapshot?.email || "—"}
          </p>
          {row.contactSnapshot?.companyName && (
            <p className="text-xs text-ink-400 flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              {row.contactSnapshot.companyName}
            </p>
          )}
        </div>
      ),
    },
    { key: "source", header: "Source", sortable: true },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row: any) => {
        const config: Record<
          string,
          { variant: "default" | "success" | "warning" | "danger" | "outline" }
        > = {
          NEW: { variant: "outline" },
          CONTACTED: { variant: "default" },
          QUALIFIED: { variant: "success" },
          UNQUALIFIED: { variant: "danger" },
          CONVERTED: { variant: "success" },
        };
        return (
          <span className={`badge-${config[row.status]?.variant || "outline"}`}>
            {row.status}
          </span>
        );
      },
    },
    {
      key: "score",
      header: "Score",
      sortable: true,
      render: (row: any) => (
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-ink-400" />
          <span>{row.score}</span>
        </div>
      ),
    },
    {
      key: "ownerId",
      header: "Owner",
      sortable: true,
      render: (row: any) => (
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-ink-400" />
          <span>{row.ownerName || "—"}</span>
        </div>
      ),
    },
    {
      key: "contactSnapshot.phone",
      header: "Phone",
      sortable: false,
      render: (row: any) =>
        row.contactSnapshot?.phone ? (
          <a
            href={`tel:${row.contactSnapshot.phone}`}
            className="text-ink-600 hover:underline flex items-center gap-1"
          >
            <Phone className="h-3 w-3" />
            {row.contactSnapshot.phone}
          </a>
        ) : (
          "—"
        ),
    },
    {
      key: "createdAt",
      header: "Created",
      sortable: true,
      render: (row: any) => format(new Date(row.createdAt), "MMM d, yyyy"),
    },
    {
      key: "convertedAt",
      header: "Converted",
      sortable: true,
      render: (row: any) =>
        row.convertedAt
          ? format(new Date(row.convertedAt), "MMM d, yyyy")
          : "—",
    },
  ];

  const fetchData = async (params: URLSearchParams) => {
    const res = await fetch(`/api/v1/crm/leads?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch leads");
    return res.json();
  };

  const statusBadgeConfig = {
    NEW: { tone: "outline" as const },
    CONTACTED: { tone: "neutral" as const },
    QUALIFIED: { tone: "positive" as const },
    UNQUALIFIED: { tone: "critical" as const },
    CONVERTED: { tone: "positive" as const },
  };

  const rowActions = (row: any) => (
    <>
      <Link href={`/crm/leads/${row._id}`}>
        <Button variant="ghost" size="sm" className="w-full justify-start">
          <Target className="h-4 w-4 mr-2" /> View
        </Button>
      </Link>
      {row.status !== "CONVERTED" && (
        <Link href={`/crm/leads/${row._id}/convert`}>
          <Button variant="ghost" size="sm" className="w-full justify-start">
            <AlertCircle className="h-4 w-4 mr-2" /> Convert
          </Button>
        </Link>
      )}
      <Link href={`/crm/leads/${row._id}/edit`}>
        <Button variant="ghost" size="sm" className="w-full justify-start">
          Edit
        </Button>
      </Link>
    </>
  );

  return (
    <ListPage
      title="Leads"
      description="Track and convert your leads"
      columns={columns}
      fetchData={fetchData}
      createUrl="/crm/leads/new"
      rowActions={rowActions}
      defaultSort="-createdAt"
      filterOptions={[
        {
          key: "status",
          label: "Status",
          options: [
            { value: "", label: "All" },
            { value: "NEW", label: "New" },
            { value: "CONTACTED", label: "Contacted" },
            { value: "QUALIFIED", label: "Qualified" },
            { value: "UNQUALIFIED", label: "Unqualified" },
            { value: "CONVERTED", label: "Converted" },
          ],
        },
      ]}
      statusBadgeConfig={statusBadgeConfig}
      searchPlaceholder="Search leads..."
    />
  );
}
