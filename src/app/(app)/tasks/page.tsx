"use client";

import { Kanban, List } from "lucide-react";
import { useState } from "react";
import { TaskBoard } from "@/components/tasks/TaskBoard";
import { TaskList } from "@/components/tasks/TaskList";
import {
  Button,
  EmptyState,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { useSession } from "@/shared/auth/session-client";

export default function TasksPage() {
  const { data: session, loading } = useSession();
  const [view, setView] = useState<"list" | "board">("list");

  const organizationId = session?.activeOrganizationId ?? "";

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
          <p className="text-muted-foreground">
            Manage and track your team&rsquo;s work
          </p>
        </div>
        <Tabs
          value={view}
          onValueChange={(value) => {
            if (value !== null) setView(value as "list" | "board");
          }}
        >
          <TabsList>
            <TabsTrigger value="list">
              <List aria-hidden="true" className="mr-2 h-4 w-4" />
              List
            </TabsTrigger>
            <TabsTrigger value="board">
              <Kanban aria-hidden="true" className="mr-2 h-4 w-4" />
              Board
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {!organizationId ? (
        <EmptyState
          title="No active organisation"
          description="Choose an organisation from the header to see its tasks."
        />
      ) : view === "list" ? (
        <TaskList organizationId={organizationId} initialFilters={{}} />
      ) : (
        <TaskBoard organizationId={organizationId} initialFilters={{}} />
      )}
    </div>
  );
}
