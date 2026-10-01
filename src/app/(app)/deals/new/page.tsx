import { Kanban } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "New deal" };

/**
 * Placeholder for the deal creation flow, so the "New deal" actions on the
 * deals list and in the command palette resolve. The real form is a later task.
 */
export default function NewDealPage() {
  return (
    <EmptyState
      icon={Kanban}
      title="New deal"
      description="Deal creation is coming soon."
      action={{ label: "Back to deals", href: "/deals" }}
    />
  );
}
