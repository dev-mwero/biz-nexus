"use client";

import { format } from "date-fns";
import { Edit2, Eye, Filter, Share2, Trash2, User, Users } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { ListPage } from "../ListPage";

export default function SavedViewsPage() {
  const [entityType, setEntityType] = useState("CONTACT");

  const columns = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row: any) => (
        <div className="flex items-center gap-2">
          {row.isShared ? (
            <Users className="h-4 w-4 text-blue-600" title="Shared" />
          ) : (
            <User className="h-4 w-4 text-ink-400" title="Personal" />
          )}
          <span className="font-medium">{row.name}</span>
        </div>
      ),
    },
    {
      key: "isShared",
      header: "Shared",
      sortable: true,
      render: (row: any) => (
        <span className={row.isShared ? "badge-success" : "badge-outline"}>
          {row.isShared ? "Yes" : "No"}
        </span>
      ),
    },
    {
      key: "filters",
      header: "Filters",
      sortable: false,
      render: (row: any) => {
        const filterKeys = Object.keys(row.filters || {});
        return filterKeys.length > 0 ? (
          <span className="badge-outline text-xs">{filterKeys.join(", ")}</span>
        ) : (
          "—"
        );
      },
    },
    {
      key: "sort",
      header: "Sort",
      sortable: false,
      render: (row: any) =>
        row.sort ? <code className="text-sm">{row.sort}</code> : "—",
    },
    {
      key: "columns",
      header: "Columns",
      sortable: false,
      render: (row: any) =>
        row.columns && row.columns.length > 0 ? (
          <span className="badge-outline text-xs">
            {row.columns.map((c: any) => c.key).join(", ")}
          </span>
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
  ];

  const fetchData = async (params: URLSearchParams) => {
    params.set("entityType", entityType);
    const res = await fetch(`/api/v1/crm/saved-views?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch saved views");
    return res.json();
  };

  const rowActions = (row: any) => (
    <>
      <Link href={`/crm/saved-views/${row._id}`}>
        <Button variant="ghost" size="sm" className="w-full justify-start">
          <Eye className="h-4 w-4 mr-2" /> View
        </Button>
      </Link>
      <Link href={`/crm/saved-views/${row._id}/edit`}>
        <Button variant="ghost" size="sm" className="w-full justify-start">
          <Edit2 className="h-4 w-4 mr-2" /> Edit
        </Button>
      </Link>
      {!row.isShared && (
        <Button variant="ghost" size="sm" className="w-full justify-start">
          <Share2 className="h-4 w-4 mr-2" /> Share
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start text-red-600"
        onClick={() => {}}
      >
        <Trash2 className="h-4 w-4 mr-2" /> Delete
      </Button>
    </>
  );

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Entity Type Selector */}
      <div className="flex items-center gap-4">
        <Select value={entityType} onValueChange={setEntityType}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Entity Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="CONTACT">Contacts</SelectItem>
            <SelectItem value="COMPANY">Companies</SelectItem>
            <SelectItem value="LEAD">Leads</SelectItem>
            <SelectItem value="DEAL">Deals</SelectItem>
            <SelectItem value="TASK">Tasks</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ListPage
        title={`Saved Views — ${entityType.charAt(0) + entityType.slice(1).toLowerCase()}s`}
        description="Save and reuse filter, sort, and column configurations"
        columns={columns}
        fetchData={fetchData}
        createUrl={`/crm/saved-views/new?entityType=${entityType}`}
        rowActions={rowActions}
        defaultSort="-createdAt"
        searchPlaceholder="Search saved views..."
      />
    </div>
  );
}
