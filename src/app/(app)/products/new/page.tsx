"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
  ProductForm,
  type ProductFormSubmission,
} from "@/components/products/ProductForm";
import { useOrganizationCurrency } from "@/components/products/useOrganizationCurrency";
import { Button, Spinner } from "@/components/ui";
import { useSession } from "@/shared/auth/session-client";

export default function NewProductPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { currency, loading, error: currencyError } = useOrganizationCurrency();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreate = session?.permissions.includes("products.create") ?? false;

  async function handleSubmit(values: ProductFormSubmission) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/products", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          sku: values.sku,
          description: values.description,
          type: values.type,
          unitPriceMinor: values.unitPriceMinor,
          unitLabel: values.unitLabel,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error?.message ?? "Could not create the product.",
        );
      }
      toast.success("Product created");
      router.push("/products");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not create the product.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/products">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">New product</h1>
          <p className="text-sm text-ink-500">
            Add a product or service to the catalogue
          </p>
        </div>
      </div>

      {!canCreate ? (
        <p role="alert" className="text-sm text-critical">
          You do not have permission to add products.
        </p>
      ) : loading ? (
        <div className="flex justify-center p-8">
          <Spinner size="lg" />
        </div>
      ) : currencyError || !currency ? (
        <p role="alert" className="text-sm text-critical">
          Could not load the organisation currency. Try again.
        </p>
      ) : (
        <ProductForm
          mode="create"
          currency={currency}
          onSubmit={handleSubmit}
          submitting={submitting}
          formError={error}
          cancelHref="/products"
        />
      )}
    </div>
  );
}
