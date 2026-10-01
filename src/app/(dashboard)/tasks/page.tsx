"use client";

import { Kanban, List, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { TaskBoard } from "@/components/tasks/TaskBoard";
import { TaskList } from "@/components/tasks/TaskList";
import {
  Button,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import { cn } from "@/shared/lib/cn";

export default function TasksPage() {
  const [view, setView] = useState<"list" | "board">("list");
  const [organizationId] = useState<string>(""); // In real app, from auth context

  // In a real app, this would come from the active organization context
  useEffect(() => {
    const orgId = new URLSearchParams(window.location.search).get("orgId");
    if (orgId) {
      // organizationId would be set via context
    }
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Tasks</h1>
          <p className="text-muted-foreground">
            Manage and track your team's work
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Tabs value={view} onValueChange={setView} className="inline-flex">
            <TabsList className="grid w-auto grid-cols-2">
              <TabsTrigger
                value="list"
                className="data-[state=active]:bg-background"
              >
                <List className="w-4 h-4 mr-2" />
                List
              </TabsTrigger>
              <TabsTrigger
                value="board"
                className="data-[state=active]:bg-background"
              >
                <Kanban className="w-4 h-4 mr-2" />
                Board
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button>
            <Plus className="w-4 h-4 mr-2" />
            New Task
          </Button>
        </div>
      </div>

      {view === "list" ? (
        <TaskList organizationId={organizationId} initialFilters={{}} />
      ) : (
        <TaskBoard organizationId={organizationId} initialFilters={{}} />
      )}
    </div>
  );
}
