"use client";

import { format } from "date-fns";
import { useCallback, useState } from "react";
import { ListPage } from "@/components/records/ListPage";
import { Badge } from "@/components/ui";
import { useSession } from "@/shared/auth/session-client";
import { formatCurrency } from "@/shared/lib/format";
import { fromMinorUnits } from "@/shared/lib/money";
import { ProductRowActions } from "./ProductRowActions";
import type { ProductRecord } from "./types";

/**
 * The product catalogue.
 *
 * Built on the shared `ListPage`, which owns the search, filter, sort and
 * pagination mechanics. This component supplies the columns, the request, and
 * the permission-gated actions.
 */
export function ProductList() {
  const { data: session } = useSession();
  const [refreshKey, setRefreshKey] = useState(0);

  const canCreate = session?.permissions.includes("products.create") ?? false;
  const canUpdate = session?.permissions.includes("products.update") ?? false;
  const canDelete = session?.permissions.includes("products.delete") ?? false;

  // A write does not mutate the list in place; bumping the key remounts
  // `ListPage`, which refetches. Resetting to the first page is the honest
  // outcome after a row leaves the current view.
  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  const columns = [
    {
      key: "name",
      header: "Name",
      sortable: true,
      render: (row: ProductRecord) => (
        <div>
          <p className="font-medium">{row.name}</p>
          {row.sku && (
            <p className="text-xs text-ink-500 font-mono">{row.sku}</p>
          )}
        </div>
      ),
    },
    {
      key: "type",
      header: "Type",
      sortable: false,
      render: (row: ProductRecord) => (
        <Badge tone="outline">
          {row.type === "PRODUCT" ? "Product" : "Service"}
        </Badge>
      ),
    },
    {
      key: "unitPriceMinor",
      header: "Unit price",
      sortable: true,
      render: (row: ProductRecord) => (
        <span>
          {formatCurrency(
            fromMinorUnits(row.unitPriceMinor, row.currency),
            row.currency,
          )}
          {row.unitLabel ? (
            <span className="text-ink-500 text-xs"> / {row.unitLabel}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sortable: false,
      render: (row: ProductRecord) => (
        <Badge tone={row.status === "ACTIVE" ? "positive" : "neutral"} dot>
          {row.status === "ACTIVE" ? "Active" : "Archived"}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      sortable: true,
      render: (row: ProductRecord) =>
        format(new Date(row.createdAt), "MMM d, yyyy"),
    },
  ];

  const fetchData = async (params: URLSearchParams) => {
    const res = await fetch(`/api/v1/products?${params.toString()}`);
    if (!res.ok) throw new Error("Failed to fetch products");
    return res.json();
  };

  return (
    <ListPage
      key={refreshKey}
      title="Products"
      description="Manage the products and services you sell"
      columns={columns}
      fetchData={fetchData}
      createUrl={canCreate ? "/products/new" : undefined}
      rowActions={
        canUpdate || canDelete
          ? (row: ProductRecord) => (
              <ProductRowActions
                product={row}
                canUpdate={canUpdate}
                canDelete={canDelete}
                onChanged={refresh}
              />
            )
          : undefined
      }
      defaultSort="-createdAt"
      filterOptions={[
        {
          key: "status",
          label: "Status",
          options: [
            { value: "ACTIVE", label: "Active" },
            { value: "ARCHIVED", label: "Archived" },
          ],
        },
        {
          key: "type",
          label: "Type",
          options: [
            { value: "PRODUCT", label: "Product" },
            { value: "SERVICE", label: "Service" },
          ],
        },
      ]}
      searchPlaceholder="Search products..."
    />
  );
}
