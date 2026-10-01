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
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui";
import type { ActivityType } from "@/modules/activities/activity.model";
import { cn } from "@/shared/lib/cn";

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

export default function OrganizationActivityFeed() {
  const [organizationId, setOrganizationId] = useState<string>("");
  const [selectedTypes, setSelectedTypes] = useState<ActivityType[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string>("");

  // In a real app, these would come from auth context
  useEffect(() => {
    // Get organizationId from URL or context
    const orgId = new URLSearchParams(window.location.search).get("orgId");
    if (orgId) setOrganizationId(orgId);

    // Get current user ID from auth context
    // setCurrentUserId(getCurrentUserId());
  }, []);

  const handleTypeChange = (type: ActivityType, checked: boolean) => {
    setSelectedTypes((prev) =>
      checked ? [...prev, type] : prev.filter((t) => t !== type),
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Activity Feed</h1>
          <p className="text-muted-foreground">
            Organization-wide activity timeline
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search activities..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 w-[250px]"
            />
          </div>
          <Select
            value={selectedTypes.join(",")}
            onValueChange={(v) =>
              setSelectedTypes(v.split(",").filter(Boolean) as ActivityType[])
            }
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Filter by type" />
            </SelectTrigger>
            <SelectContent>
              {ACTIVITY_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  <t.icon className="w-4 h-4 mr-2" />
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Tabs defaultValue="feed" className="space-y-4">
        <TabsList>
          <TabsTrigger value="feed">All Activity</TabsTrigger>
          <TabsTrigger value="my-activity">My Activity</TabsTrigger>
          <TabsTrigger value="team">Team Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="feed">
          {organizationId ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Organization Feed</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ActivityTimeline
                  organizationId={organizationId}
                  initialPageSize={25}
                  showComposer={false}
                  allowedTypes={
                    selectedTypes.length > 0 ? selectedTypes : undefined
                  }
                  currentUserId={currentUserId}
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  Select an organization to view the activity feed.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="my-activity">
          {organizationId ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">My Activity</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ActivityTimeline
                  organizationId={organizationId}
                  initialPageSize={25}
                  showComposer={false}
                  allowedTypes={
                    selectedTypes.length > 0 ? selectedTypes : undefined
                  }
                  currentUserId={currentUserId}
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  Select an organization to view your activity.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="team">
          {organizationId ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg">Team Activity</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <ActivityTimeline
                  organizationId={organizationId}
                  initialPageSize={25}
                  showComposer={false}
                  allowedTypes={
                    selectedTypes.length > 0 ? selectedTypes : undefined
                  }
                  currentUserId={currentUserId}
                />
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  Select an organization to view team activity.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
