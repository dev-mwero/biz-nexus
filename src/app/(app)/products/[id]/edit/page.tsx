"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ProductForm,
  type ProductFormSubmission,
} from "@/components/products/ProductForm";
import type { ProductRecord } from "@/components/products/types";
import { Button, Spinner } from "@/components/ui";
import { useSession } from "@/shared/auth/session-client";

export default function EditProductPage() {
  const params = useParams();
  const router = useRouter();
  const productId = params.id as string;
  const { data: session } = useSession();

  const [product, setProduct] = useState<ProductRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canUpdate = session?.permissions.includes("products.update") ?? false;

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const res = await fetch(`/api/v1/products/${productId}`);
        if (res.status === 404) {
          router.push("/products");
          return;
        }
        if (!res.ok) throw new Error("Could not load the product");
        const body = await res.json();
        if (active) setProduct(body.data as ProductRecord);
      } catch {
        if (active) setLoadError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [productId, router]);

  async function handleSubmit(values: ProductFormSubmission) {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/v1/products/${productId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: values.name,
          sku: values.sku,
          description: values.description,
          type: values.type,
          status: values.status,
          unitPriceMinor: values.unitPriceMinor,
          unitLabel: values.unitLabel,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(
          body?.error?.message ?? "Could not update the product.",
        );
      }
      toast.success("Product updated");
      router.push("/products");
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not update the product.",
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
          <h1 className="text-2xl font-semibold text-ink-900">Edit product</h1>
          <p className="text-sm text-ink-500">Update this catalogue item</p>
        </div>
      </div>

      {!canUpdate ? (
        <p role="alert" className="text-sm text-critical">
          You do not have permission to edit products.
        </p>
      ) : loading ? (
        <div className="flex justify-center p-8">
          <Spinner size="lg" />
        </div>
      ) : loadError || !product ? (
        <p role="alert" className="text-sm text-critical">
          Could not load the product. Try again.
        </p>
      ) : (
        <ProductForm
          mode="edit"
          currency={product.currency}
          initial={{
            name: product.name,
            sku: product.sku ?? "",
            description: product.description ?? "",
            type: product.type,
            unitPriceMinor: product.unitPriceMinor,
            unitLabel: product.unitLabel ?? "",
            status: product.status,
          }}
          onSubmit={handleSubmit}
          submitting={submitting}
          formError={error}
          cancelHref="/products"
        />
      )}
    </div>
  );
}
