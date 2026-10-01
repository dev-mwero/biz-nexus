"use client";

import { format } from "date-fns";
import { Building2, Mail, Phone, Tag, Users } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui";
import { ListPage } from "../ListPage";

export default function ContactsPage() {
  const columns = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row: any) => (
        <div>
          <p className="font-medium">
            {row.firstName} {row.lastName}
          </p>
          {row.jobTitle && (
            <p className="text-xs text-ink-500">{row.jobTitle}</p>
          )}
          {row.companyName && (
            <p className="text-xs text-ink-400 flex items-center gap-1">
              <Building2 className="h-3 w-3" />
              {row.companyName}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "email",
      header: "Email",
      sortable: false,
      render: (row: any) =>
        row.primaryEmail ? (
          <a
            href={`mailto:${row.primaryEmail}`}
            className="text-blue-600 hover:underline flex items-center gap-1"
          >
            <Mail className="h-3 w-3" />
            {row.primaryEmail}
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
        row.phones?.[0]?.value ? (
          <a
            href={`tel:${row.phones[0].value}`}
            className="text-ink-600 hover:underline flex items-center gap-1"
          >
            <Phone className="h-3 w-3" />
            {row.phones[0].value}
          </a>
        ) : (
          "—"
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
          LEAD: { variant: "outline" },
          PROSPECT: { variant: "warning" },
          CUSTOMER: { variant: "success" },
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
      key: "tags",
      header: "Tags",
      sortable: false,
      render: (row: any) => (
        <div className="flex flex-wrap gap-1">
          {row.tagNames?.slice(0, 3).map((tag: string) => (
            <span key={tag} className="badge-outline text-xs">
              {tag}
            </span>
          ))}
          {row.tagNames && row.tagNames.length > 3 && (
            <span className="badge-outline text-xs">
              +{row.tagNames.length - 3}
            </span>
          )}
          {!row.tagNames || row.tagNames.length === 0 ? (
            <span className="text-ink-400 text-xs">—</span>
          ) : null}
        </div>
      ),
    },
    {
      key: "lastContactedAt",
      header: "Last Contact",
      sortable: true,
      render: (row: any) =>
        row.lastContactedAt
          ? format(new Date(row.lastContactedAt), "MMM d, yyyy")
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
    const res = await fetch(`/api/v1/crm/contacts?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch contacts");
    return res.json();
  };

  const statusBadgeConfig = {
    LEAD: { variant: "outline" as const },
    PROSPECT: { variant: "warning" as const },
    CUSTOMER: { variant: "success" as const },
    INACTIVE: { variant: "danger" as const },
  };

  const rowActions = (row: any) => (
    <>
      <Link href={`/crm/contacts/${row._id}`}>
        <Button variant="ghost" size="sm" className="w-full justify-start">
          <Users className="h-4 w-4 mr-2" /> View
        </Button>
      </Link>
      <Link href={`/crm/contacts/${row._id}/edit`}>
        <Button variant="ghost" size="sm" className="w-full justify-start">
          Edit
        </Button>
      </Link>
    </>
  );

  return (
    <ListPage
      title="Contacts"
      description="Manage your contacts and relationships"
      columns={columns}
      fetchData={fetchData}
      createUrl="/crm/contacts/new"
      rowActions={rowActions}
      defaultSort="lastName,firstName"
      filterOptions={[
        {
          key: "status",
          label: "Status",
          options: [
            { value: "", label: "All" },
            { value: "LEAD", label: "Lead" },
            { value: "PROSPECT", label: "Prospect" },
            { value: "CUSTOMER", label: "Customer" },
            { value: "INACTIVE", label: "Inactive" },
          ],
        },
        {
          key: "hasEmail",
          label: "Has Email",
          options: [
            { value: "", label: "All" },
            { value: "true", label: "Yes" },
            { value: "false", label: "No" },
          ],
        },
      ]}
      statusBadgeConfig={statusBadgeConfig}
      searchPlaceholder="Search contacts..."
    />
  );
}
