"use client";

import { format } from "date-fns";
import { Database, Edit2, Trash2, Type } from "lucide-react";
import Link from "next/link";
import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";
import { ListPage } from "../ListPage";

export default function CustomFieldsPage() {
  const [entityType, setEntityType] = useState("CONTACT");

  const columns = [
    {
      key: "key",
      header: "Key",
      sortable: true,
      render: (row: any) => (
        <code className="text-sm bg-muted px-1.5 py-0.5 rounded">
          {row.key}
        </code>
      ),
    },
    { key: "label", header: "Label", sortable: true },
    {
      key: "type",
      header: "Type",
      sortable: true,
      render: (row: any) => (
        <span className="badge-outline capitalize">
          {row.type.toLowerCase().replace("_", " ")}
        </span>
      ),
    },
    {
      key: "required",
      header: "Required",
      sortable: true,
      render: (row: any) => (
        <span className={row.required ? "badge-success" : "badge-outline"}>
          {row.required ? "Yes" : "No"}
        </span>
      ),
    },
    {
      key: "options",
      header: "Options",
      sortable: false,
      render: (row: any) =>
        row.options && row.options.length > 0 ? (
          <span className="text-ink-500 text-sm">{row.options.join(", ")}</span>
        ) : (
          "—"
        ),
    },
    { key: "order", header: "Order", sortable: true },
    {
      key: "createdAt",
      header: "Created",
      sortable: true,
      render: (row: any) => format(new Date(row.createdAt), "MMM d, yyyy"),
    },
  ];

  const fetchData = async (params: URLSearchParams) => {
    params.set("entityType", entityType);
    const res = await fetch(`/api/v1/crm/custom-fields?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch custom fields");
    return res.json();
  };

  const rowActions = (row: any) => (
    <>
      <Link href={`/crm/custom-fields/${row._id}/edit`}>
        <Button variant="ghost" size="sm" className="w-full justify-start">
          <Edit2 className="h-4 w-4 mr-2" /> Edit
        </Button>
      </Link>
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
            <SelectItem value="CONTACT">Contact</SelectItem>
            <SelectItem value="COMPANY">Company</SelectItem>
            <SelectItem value="LEAD">Lead</SelectItem>
            <SelectItem value="DEAL">Deal</SelectItem>
            <SelectItem value="TASK">Task</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <ListPage
        title={`Custom Fields — ${entityType.charAt(0) + entityType.slice(1).toLowerCase()}s`}
        description="Define custom fields for your records"
        columns={columns}
        fetchData={fetchData}
        createUrl={`/crm/custom-fields/new?entityType=${entityType}`}
        rowActions={rowActions}
        defaultSort="order"
        searchPlaceholder="Search custom fields..."
      />
    </div>
  );
}
