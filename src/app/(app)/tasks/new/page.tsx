import { CheckSquare } from "lucide-react";
import type { Metadata } from "next";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata: Metadata = { title: "New task" };

/**
 * Placeholder for task creation, so the "New task" actions on the tasks list and
 * in the command palette resolve. The real form is a later task.
 */
export default function NewTaskPage() {
  return (
    <EmptyState
      icon={CheckSquare}
      title="New task"
      description="Task creation is coming soon."
      action={{ label: "Back to tasks", href: "/tasks" }}
    />
  );
}
