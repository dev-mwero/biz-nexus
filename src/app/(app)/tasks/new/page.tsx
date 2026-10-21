"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TaskForm } from "@/components/tasks/TaskForm";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui";
import { useSession } from "@/shared/auth/session-client";

/**
 * The dedicated task-creation screen.
 *
 * `TaskForm` already supports create mode: with no `task` prop it resets to a
 * blank form and POSTs to `/api/v1/tasks`. The detail page renders the same
 * component in a dialog for edits; here it is rendered inline (passing `open`
 * makes `TaskForm` skip its own `Dialog` and lay the form out directly, because
 * on a page that exists to hold the form a dialog would be a box inside a box).
 *
 * Per `docs/PLAN.md` §1K this route was a deliberate placeholder so the list's
 * and command palette's "New task" actions resolved. It no longer is.
 */
export default function NewTaskPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const organizationId = session?.activeOrganizationId ?? "";

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-4">
        <Link
          href="/tasks"
          className="inline-flex size-9 items-center justify-center rounded-md text-ink-700 transition-colors hover:bg-surface-hover dark:text-ink-200"
          aria-label="Back to tasks"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-[-0.01em] text-ink-900 dark:text-ink-50">
            New Task
          </h1>
          <p className="text-sm text-ink-500 dark:text-ink-400">
            Create a task and assign it to a teammate.
          </p>
        </div>
      </div>

      <Card variant="outlined">
        <CardHeader>
          <CardTitle className="text-lg">Task details</CardTitle>
        </CardHeader>
        <CardContent>
          <TaskForm
            organizationId={organizationId}
            open={true}
            onSuccess={() => router.push("/tasks")}
            onClose={() => router.push("/tasks")}
          />
        </CardContent>
      </Card>
    </div>
  );
}
