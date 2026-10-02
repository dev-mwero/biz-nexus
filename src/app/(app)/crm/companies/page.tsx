"use client";

import { format } from "date-fns";
import { Building2, Mail, MapPin, Phone, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { ListPage } from "../ListPage";

export default function CompaniesPage() {
  const columns = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row: any) => (
        <div>
          <p className="font-medium">{row.name}</p>
          {row.legalName && row.legalName !== row.name && (
            <p className="text-xs text-ink-500">{row.legalName}</p>
          )}
        </div>
      ),
    },
    { key: "industry", header: "Industry", sortable: true },
    {
      key: "status",
      header: "Status",
      sortable: true,
      render: (row: any) => {
        const config: Record<
          string,
          { variant: "default" | "success" | "warning" | "danger" | "outline" }
        > = {
          PROSPECT: { variant: "outline" },
          CUSTOMER: { variant: "success" },
          PARTNER: { variant: "default" },
          SUPPLIER: { variant: "warning" },
          INACTIVE: { variant: "danger" },
        };
        return (
          <span className={`badge-${config[row.status]?.variant || "outline"}`}>
            {row.status}
          </span>
        );
      },
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
      key: "email",
      header: "Email",
      sortable: false,
      render: (row: any) =>
        row.email ? (
          <a
            href={`mailto:${row.email}`}
            className="text-blue-600 hover:underline flex items-center gap-1"
          >
            <Mail className="h-3 w-3" />
            {row.email}
          </a>
        ) : (
          "—"
        ),
    },
    {
      key: "phone",
      header: "Phone",
      sortable: false,
      render: (row: any) =>
        row.phone ? (
          <a
            href={`tel:${row.phone}`}
            className="text-ink-600 hover:underline flex items-center gap-1"
          >
            <Phone className="h-3 w-3" />
            {row.phone}
          </a>
        ) : (
          "—"
        ),
    },
    {
      key: "city",
      header: "Location",
      sortable: false,
      render: (row: any) => {
        const parts = [
          row.billingAddress?.city,
          row.billingAddress?.state,
          row.billingAddress?.country,
        ].filter(Boolean);
        return parts.length > 0 ? (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3 text-ink-400" />
            {parts.join(", ")}
          </span>
        ) : (
          "—"
        );
      },
    },
    {
      key: "createdAt",
      header: "Created",
      sortable: true,
      render: (row: any) => format(new Date(row.createdAt), "MMM d, yyyy"),
    },
  ];

  const fetchData = async (params: URLSearchParams) => {
    const res = await fetch(`/api/v1/crm/companies?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch companies");
    return res.json();
  };

  const statusBadgeConfig = {
    PROSPECT: { tone: "outline" as const },
    CUSTOMER: { tone: "positive" as const },
    PARTNER: { tone: "neutral" as const },
    SUPPLIER: { tone: "attention" as const },
    INACTIVE: { tone: "critical" as const },
  };

  const rowActions = (row: any) => (
    <>
      <Link href={`/crm/companies/${row._id}`}>
        <Button variant="ghost" size="sm" className="w-full justify-start">
          <Building2 className="h-4 w-4 mr-2" /> View
        </Button>
      </Link>
      <Link href={`/crm/companies/${row._id}/edit`}>
        <Button variant="ghost" size="sm" className="w-full justify-start">
          Edit
        </Button>
      </Link>
    </>
  );

  return (
    <ListPage
      title="Companies"
      description="Manage your accounts and prospects"
      columns={columns}
      fetchData={fetchData}
      createUrl="/crm/companies/new"
      rowActions={rowActions}
      defaultSort="-createdAt"
      filterOptions={[
        {
          key: "status",
          label: "Status",
          options: [
            { value: "", label: "All" },
            { value: "PROSPECT", label: "Prospect" },
            { value: "CUSTOMER", label: "Customer" },
            { value: "PARTNER", label: "Partner" },
            { value: "SUPPLIER", label: "Supplier" },
            { value: "INACTIVE", label: "Inactive" },
          ],
        },
      ]}
      statusBadgeConfig={statusBadgeConfig}
      searchPlaceholder="Search companies..."
    />
  );
}
