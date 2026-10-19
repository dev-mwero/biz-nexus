"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@/components/ui";
import {
  fromMinorUnits,
  MAX_UNIT_PRICE_MINOR,
  toMinorUnits,
} from "@/shared/lib/money";
import {
  PRODUCT_STATUS_OPTIONS,
  PRODUCT_TYPE_OPTIONS,
  type ProductStatus,
  type ProductType,
} from "./types";

/**
 * What the form hands back once the input is valid.
 *
 * `unitPriceMinor` is an integer number of minor units, parsed by the form from
 * the human's decimal string and never a float. `sku`, `description` and
 * `unitLabel` are `null` when blank, which is the instruction to clear the
 * field, distinct from an omitted key.
 */
export interface ProductFormSubmission {
  name: string;
  sku: string | null;
  description: string | null;
  type: ProductType;
  unitPriceMinor: number;
  unitLabel: string | null;
  status: ProductStatus;
}

export interface ProductFormInitial {
  name?: string;
  sku?: string | null;
  description?: string | null;
  type?: ProductType;
  unitPriceMinor?: number;
  unitLabel?: string | null;
  status?: ProductStatus;
}

interface ProductFormProps {
  mode: "create" | "edit";
  /**
   * The currency the price is denominated in. The organisation's for a new
   * product; the product's own for an edit. `toMinorUnits` needs it to know how
   * many decimal places the price may have, and `fromMinorUnits` needs it to
   * render the current value.
   */
  currency: string;
  initial?: ProductFormInitial;
  onSubmit: (values: ProductFormSubmission) => void | Promise<void>;
  submitting?: boolean;
  /** A message from the server, shown above the form. */
  formError?: string | null;
  cancelHref: string;
}

export function ProductForm({
  mode,
  currency,
  initial,
  onSubmit,
  submitting = false,
  formError = null,
  cancelHref,
}: ProductFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [sku, setSku] = useState(initial?.sku ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [type, setType] = useState<ProductType>(initial?.type ?? "PRODUCT");
  const [unitLabel, setUnitLabel] = useState(initial?.unitLabel ?? "");
  const [status, setStatus] = useState<ProductStatus>(
    initial?.status ?? "ACTIVE",
  );
  const [price, setPrice] = useState(
    initial?.unitPriceMinor === undefined
      ? ""
      : String(fromMinorUnits(initial.unitPriceMinor, currency)),
  );
  const [validationError, setValidationError] = useState<string | null>(null);

  const error = validationError ?? formError;

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setValidationError(null);

    const trimmedName = name.trim();
    if (!trimmedName) {
      setValidationError("A product needs a name.");
      return;
    }

    const priceText = price.trim();
    if (!priceText) {
      setValidationError("Enter a unit price.");
      return;
    }

    let unitPriceMinor: number;
    try {
      unitPriceMinor = toMinorUnits(priceText, currency);
    } catch (parseError) {
      setValidationError(
        parseError instanceof Error
          ? parseError.message
          : "Enter a valid price.",
      );
      return;
    }

    if (unitPriceMinor < 0) {
      setValidationError("A price cannot be negative.");
      return;
    }
    if (unitPriceMinor > MAX_UNIT_PRICE_MINOR) {
      setValidationError(
        `A price cannot exceed ${fromMinorUnits(MAX_UNIT_PRICE_MINOR, currency)} ${currency}.`,
      );
      return;
    }

    await onSubmit({
      name: trimmedName,
      sku: sku.trim() || null,
      description: description.trim() || null,
      type,
      unitPriceMinor,
      unitLabel: unitLabel.trim() || null,
      status,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div
          className="rounded-md border border-critical bg-critical/10 p-4 text-sm text-critical"
          role="alert"
        >
          {error}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Catalogue item</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field>
            <FieldLabel htmlFor="name">Name *</FieldLabel>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Consulting hour"
              maxLength={160}
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="sku">SKU</FieldLabel>
              <Input
                id="sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                placeholder="CONS-IV"
                maxLength={64}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="type">Type</FieldLabel>
              <Select
                value={type}
                onValueChange={(value) => setType(value as ProductType)}
              >
                <SelectTrigger id="type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === "PRODUCT" ? "Product" : "Service"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="unitPrice">Unit price *</FieldLabel>
              <Input
                id="unitPrice"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                aria-describedby="unitPrice-currency"
              />
              <p id="unitPrice-currency" className="text-xs text-ink-500">
                Amount in {currency}.
              </p>
            </Field>
            <Field>
              <FieldLabel htmlFor="unitLabel">Unit label</FieldLabel>
              <Input
                id="unitLabel"
                value={unitLabel}
                onChange={(e) => setUnitLabel(e.target.value)}
                placeholder="hour, each, month"
                maxLength={32}
              />
            </Field>
          </div>

          {mode === "edit" && (
            <Field>
              <FieldLabel htmlFor="status">Status</FieldLabel>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as ProductStatus)}
              >
                <SelectTrigger id="status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRODUCT_STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option === "ACTIVE" ? "Active" : "Archived"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field>
            <FieldLabel htmlFor="description">Description</FieldLabel>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this item is and when it applies."
              rows={4}
              maxLength={5000}
            />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-3 pt-4 border-t border-line">
        <Link href={cancelHref}>
          <Button type="button" variant="secondary">
            Cancel
          </Button>
        </Link>
        <Button type="submit" disabled={submitting}>
          {mode === "create"
            ? submitting
              ? "Creating..."
              : "Create product"
            : submitting
              ? "Saving..."
              : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
