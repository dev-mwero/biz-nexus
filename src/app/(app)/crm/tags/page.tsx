"use client";

import { format } from "date-fns";
import { Edit2, Palette, Plus, Tag as TagIcon, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui";
import { ListPage } from "../ListPage";

export default function TagsPage() {
  const columns = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row: any) => (
        <div className="flex items-center gap-2">
          <span
            className="w-3 h-3 rounded-full"
            style={{ backgroundColor: `var(--color-${row.color}-500)` }}
          />
          <span className="font-medium">{row.name}</span>
        </div>
      ),
    },
    {
      key: "color",
      header: "Color",
      sortable: false,
      render: (row: any) => (
        <span className="capitalize text-ink-500">{row.color}</span>
      ),
    },
    {
      key: "usageCount",
      header: "Usage",
      sortable: true,
      render: (row: any) => (
        <span className="font-mono text-ink-600">{row.usageCount}</span>
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
    const res = await fetch(`/api/v1/crm/tags?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch tags");
    return res.json();
  };

  const rowActions = (row: any) => (
    <>
      <Link href={`/crm/tags/${row._id}/edit`}>
        <Button variant="ghost" size="sm" className="w-full justify-start">
          <Edit2 className="h-4 w-4 mr-2" /> Edit
        </Button>
      </Link>
      {row.usageCount === 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-red-600"
          onClick={() => {}}
        >
          <Trash2 className="h-4 w-4 mr-2" /> Delete
        </Button>
      )}
    </>
  );

  return (
    <ListPage
      title="Tags"
      description="Organize records with colored tags"
      columns={columns}
      fetchData={fetchData}
      createUrl="/crm/tags/new"
      rowActions={rowActions}
      defaultSort="name"
      searchPlaceholder="Search tags..."
    />
  );
}
