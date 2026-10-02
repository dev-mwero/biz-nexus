"use client";

import { format } from "date-fns";
import { Edit, Eye, GripVertical, Plus, Target, Trash2 } from "lucide-react";
import Link from "next/link";
import { ListPage } from "@/app/(app)/crm/ListPage";
import { Button } from "@/components/ui";

export default function PipelinesPage() {
  const columns = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row: any) => (
        <div>
          <p className="font-medium">{row.name}</p>
          {row.description && (
            <p className="text-xs text-ink-500">{row.description}</p>
          )}
          <div className="flex items-center gap-2 mt-1">
            {row.isDefault && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800">
                Default
              </span>
            )}
            <span className="text-xs text-ink-400 flex items-center gap-1">
              <Target className="h-3 w-3" />
              {row.stages?.length || 0} stages
            </span>
          </div>
        </div>
      ),
    },
    { key: "order", header: "Order", sortable: true, width: "80px" },
    {
      key: "createdAt",
      header: "Created",
      sortable: true,
      width: "140px",
      render: (row: any) => format(new Date(row.createdAt), "MMM d, yyyy"),
    },
  ];

  const fetchData = async (params: URLSearchParams) => {
    const res = await fetch(`/api/v1/pipelines?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch pipelines");
    return res.json();
  };

  const rowActions = (row: any) => (
    <>
      <Link href={`/pipelines/${row._id}`}>
        <Button variant="ghost" size="sm" className="w-full justify-start">
          <Eye className="h-4 w-4 mr-2" /> View
        </Button>
      </Link>
      <Link href={`/pipelines/${row._id}/edit`}>
        <Button variant="ghost" size="sm" className="w-full justify-start">
          <Edit className="h-4 w-4 mr-2" /> Edit
        </Button>
      </Link>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start text-critical"
        onClick={() => handleDelete(row._id, row.name)}
      >
        <Trash2 className="h-4 w-4 mr-2" /> Delete
      </Button>
    </>
  );

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/v1/pipelines/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || "Failed to delete pipeline");
      }
      // Trigger re-fetch by updating a dummy state
      window.location.reload();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to delete pipeline");
    }
  };

  return (
    <ListPage
      title="Pipelines"
      description="Manage your sales pipelines and stages"
      columns={columns}
      fetchData={fetchData}
      createUrl="/pipelines/new"
      rowActions={rowActions}
      defaultSort="order"
      searchPlaceholder="Search pipelines..."
    />
  );
}
