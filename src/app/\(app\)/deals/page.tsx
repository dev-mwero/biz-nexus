"use client";

import { format } from "date-fns";
import {
  ArrowRight,
  Building2,
  Calendar,
  DollarSign,
  Target,
  Users,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { ListPage } from "../../crm/ListPage";

export default function DealsPage() {
  const columns = [
    {
      key: "name",
      header: "Deal",
      sortable: true,
      render: (row: any) => (
        <div>
          <p className="font-medium">{row.name}</p>
          {row.companyName && (
            <p className="text-xs text-ink-500 flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              {row.companyName}
            </p>
          )}
          {row.contactName && (
            <p className="text-xs text-ink-400 flex items-center gap-1">
              <Target className="h-3 w-3" />
              {row.contactName}
            </p>
          )}
        </div>
      ),
    },
    { key: "pipelineName", header: "Pipeline", sortable: true },
    { key: "stageName", header: "Stage", sortable: true },
    {
      key: "value",
      header: "Value",
      sortable: true,
      render: (row: any) => (
        <div className="flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-ink-400" />
          <span>
            {new Intl.NumberFormat("en-US", {
              style: "currency",
              currency: row.currency || "USD",
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            }).format(row.value)}
          </span>
        </div>
      ),
    },
    {
      key: "probability",
      header: "Probability",
      sortable: true,
      render: (row: any) => (
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-ink-400" />
          <span>{row.probability}%</span>
        </div>
      ),
    },
    {
      key: "ownerName",
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
      key: "status",
      header: "Status",
      sortable: true,
      render: (row: any) => {
        const config: Record<
          string,
          { variant: "default" | "success" | "warning" | "danger" | "outline" }
        > = {
          OPEN: { variant: "default" },
          WON: { variant: "success" },
          LOST: { variant: "danger" },
        };
        return (
          <span className={`badge-${config[row.status]?.variant || "outline"}`}>
            {row.status}
          </span>
        );
      },
    },
    {
      key: "expectedCloseDate",
      header: "Expected Close",
      sortable: true,
      render: (row: any) =>
        row.expectedCloseDate
          ? format(new Date(row.expectedCloseDate), "MMM d, yyyy")
          : "—",
    },
    {
      key: "createdAt",
      header: "Created",
      sortable: true,
      render: (row: any) => format(new Date(row.createdAt), "MMM d, yyyy"),
    },
  ];

  const fetchData = async (params: URLSearchParams) => {
    const res = await fetch(`/api/v1/deals?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch deals");
    return res.json();
  };

  const statusBadgeConfig = {
    OPEN: { variant: "default" as const },
    WON: { variant: "success" as const },
    LOST: { variant: "danger" as const },
  };

  const rowActions = (row: any) => (
    <>
      <Link href={`/deals/${row._id}`}>
        <Button variant="ghost" size="sm" className="w-full justify-start">
          <ArrowRight className="h-4 w-4 mr-2" /> View
        </Button>
      </Link>
      {row.status === "OPEN" && (
        <Link href={`/deals/${row._id}/edit`}>
          <Button variant="ghost" size="sm" className="w-full justify-start">
            Edit
          </Button>
        </Link>
      )}
    </>
  );

  return (
    <ListPage
      title="Deals"
      description="Manage your sales pipeline"
      columns={columns}
      fetchData={fetchData}
      createUrl="/deals/new"
      rowActions={rowActions}
      defaultSort="-createdAt"
      filterOptions={[
        {
          key: "status",
          label: "Status",
          options: [
            { value: "", label: "All" },
            { value: "OPEN", label: "Open" },
            { value: "WON", label: "Won" },
            { value: "LOST", label: "Lost" },
          ],
        },
      ]}
      statusBadgeConfig={statusBadgeConfig}
      searchPlaceholder="Search deals..."
    />
  );
}
