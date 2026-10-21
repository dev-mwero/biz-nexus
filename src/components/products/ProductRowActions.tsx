"use client";

import { Archive, ArchiveRestore, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui";
import type { ProductRecord } from "./types";

interface ProductRowActionsProps {
  product: ProductRecord;
  canUpdate: boolean;
  canDelete: boolean;
  /** Called after any successful write so the list can refetch. */
  onChanged: () => void;
}

/**
 * The actions menu for one product.
 *
 * Every write is guarded by `confirm` first, because archive changes what the
 * catalogue offers and delete removes the row from it, and neither is something
 * a mis-clicked menu item should do. The permission props decide which items
 * exist at all; the API is the gate, but an item that leads to a 403 is an
 * affordance that lies.
 */
export function ProductRowActions({
  product,
  canUpdate,
  canDelete,
  onChanged,
}: ProductRowActionsProps) {
  const [busy, setBusy] = useState(false);

  const isArchived = product.status === "ARCHIVED";

  async function write(
    body: Record<string, unknown>,
    successMessage: string,
  ): Promise<boolean> {
    setBusy(true);
    try {
      const res = await fetch(`/api/v1/products/${product._id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(
          payload?.error?.message ?? "Could not update the product.",
        );
      }
      toast.success(successMessage);
      onChanged();
      return true;
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update the product.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function handleArchiveToggle() {
    const nextStatus = isArchived ? "ACTIVE" : "ARCHIVED";
    const confirmed = window.confirm(
      isArchived
        ? `Restore "${product.name}" to the active catalogue?`
        : `Archive "${product.name}"? It leaves the active catalogue but you can restore it later.`,
    );
    if (!confirmed) return;

    await write(
      { status: nextStatus },
      isArchived ? "Product restored" : "Product archived",
    );
  }

  async function handleDelete() {
    const confirmed = window.confirm(
      `Delete "${product.name}"? It disappears from the catalogue; quotes that already reference it keep their copy.`,
    );
    if (!confirmed) return;

    setBusy(true);
    try {
      const res = await fetch(`/api/v1/products/${product._id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(
          payload?.error?.message ?? "Could not delete the product.",
        );
      }
      toast.success("Product deleted");
      onChanged();
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not delete the product.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {canUpdate && (
        <Link href={`/products/${product._id}/edit`}>
          <Button variant="ghost" size="sm" className="w-full justify-start">
            <Pencil className="h-4 w-4 mr-2" /> Edit
          </Button>
        </Link>
      )}
      {canUpdate && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start"
          disabled={busy}
          onClick={handleArchiveToggle}
        >
          {isArchived ? (
            <>
              <ArchiveRestore className="h-4 w-4 mr-2" /> Unarchive
            </>
          ) : (
            <>
              <Archive className="h-4 w-4 mr-2" /> Archive
            </>
          )}
        </Button>
      )}
      {canDelete && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-critical"
          disabled={busy}
          onClick={handleDelete}
        >
          <Trash2 className="h-4 w-4 mr-2" /> Delete
        </Button>
      )}
    </>
  );
}
