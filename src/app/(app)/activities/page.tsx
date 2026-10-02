"use client";

import {
  Briefcase,
  Calendar,
  Check,
  MessageSquare,
  Phone,
  Search,
} from "lucide-react";
import { useEffect, useState } from "react";
import { ActivityTimeline } from "@/components/activities";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import type { ActivityType } from "@/modules/activities/activity.model";
import { useSession } from "@/shared/auth/session-client";

const ACTIVITY_TYPES: Array<{
  value: ActivityType;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: "NOTE", label: "Notes", icon: MessageSquare },
  { value: "TASK", label: "Tasks", icon: Check },
  { value: "CALL", label: "Calls", icon: Phone },
  { value: "MEETING", label: "Meetings", icon: Calendar },
  { value: "STAGE_CHANGE", label: "Stage Changes", icon: Briefcase },
  { value: "EMAIL", label: "Emails", icon: MessageSquare },
  { value: "SMS", label: "SMS", icon: MessageSquare },
  { value: "WHATSAPP", label: "WhatsApp", icon: MessageSquare },
];

/** Sentinel for "no type filter". Not an ActivityType, so it cannot collide. */
const ALL_TYPES = "ALL";

/** Which slice of the organisation feed is on screen. */
type FeedScope = "all" | "mine" | "team";

const SCOPE_TITLES: Record<FeedScope, string> = {
  all: "All activity",
  mine: "My activity",
  team: "Team activity",
};

/**
 * The search term is debounced before it reaches the timeline.
 *
 * The timeline refetches whenever its `search` prop changes, so an undebounced
 * value sends one request per keystroke. 300ms is long enough to coalesce a
 * phrase and short enough that the list feels attached to the keyboard.
 */
const SEARCH_DEBOUNCE_MS = 300;

export default function OrganizationActivityFeed() {
  const { data: session, loading: sessionLoading } = useSession();
  const [typeFilter, setTypeFilter] = useState<ActivityType | typeof ALL_TYPES>(
    ALL_TYPES,
  );
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<FeedScope>("all");

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const organizationId = session?.activeOrganizationId ?? "";
  const currentUserId = session?.user?.id;

  // "My activity" filters the feed to what this member personally performed.
  // Undefined rather than "" so the timeline omits the parameter instead of
  // sending an empty one that would match nothing.
  const actorId = scope === "mine" ? currentUserId : undefined;

  if (sessionLoading) {
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
          <h1 className="text-2xl font-bold">Activity</h1>
          <p className="text-muted-foreground">
            Everything that has happened in this organisation
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="activity-search">Search</Label>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                id="activity-search"
                type="search"
                placeholder="Title or notes"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                className="w-56 pl-9"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="activity-type">Type</Label>
            <Select
              value={typeFilter}
              onValueChange={(value) => {
                if (value === null) return;
                setTypeFilter(value as ActivityType | typeof ALL_TYPES);
              }}
            >
              <SelectTrigger id="activity-type" className="w-44">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_TYPES}>All types</SelectItem>
                {ACTIVITY_TYPES.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {!organizationId ? (
        <EmptyState
          title="No active organisation"
          description="Choose an organisation from the header to see its activity."
        />
      ) : (
        <Tabs
          value={scope}
          onValueChange={(value) => {
            if (value === null) return;
            setScope(value as FeedScope);
          }}
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="mine">Mine</TabsTrigger>
            <TabsTrigger value="team">Team</TabsTrigger>
          </TabsList>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">{SCOPE_TITLES[scope]}</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ActivityTimeline
                key={scope}
                organizationId={organizationId}
                initialPageSize={25}
                showComposer={false}
                allowedTypes={
                  typeFilter === ALL_TYPES ? undefined : [typeFilter]
                }
                actorId={actorId}
                search={search || undefined}
                currentUserId={currentUserId}
              />
            </CardContent>
          </Card>
        </Tabs>
      )}
    </div>
  );
}
