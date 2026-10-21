"use client";

import { useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui";

/**
 * Pick a member of the active organisation, by name.
 *
 * The alternative this replaces was a text field labelled "Assignee (User ID)",
 * which asked the person filling in the form to have an ObjectId to hand. The
 * directory endpoint returns one row per active membership with the name and
 * address already resolved, so the same choice is a select.
 *
 * The value is the membership's `userId`, which is what the task and deal
 * payloads carry. The empty string is "Unassigned" — it is what Base UI uses for
 * a cleared select and it maps to `null` on the way out, matching the payload
 * shape those endpoints already accept.
 *
 * Members whose user row has been deleted never arrive: the endpoint drops them,
 * so this cannot offer a choice that names nothing.
 */

interface MemberOption {
  userId: string;
  name: string;
  email: string;
}

export function MemberSelect({
  value,
  onChange,
  disabled,
  id,
  placeholder = "Unassigned",
}: {
  value: string | null;
  onChange: (userId: string | null) => void;
  disabled?: boolean;
  id?: string;
  placeholder?: string;
}) {
  const [members, setMembers] = useState<MemberOption[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/v1/organizations/current/members");
        if (!res.ok) {
          if (!cancelled) setMembers([]);
          return;
        }
        const body = await res.json();
        if (!cancelled) {
          setMembers(
            (body.data ?? []).map(
              (row: { userId: string; name: string; email: string }) => ({
                userId: row.userId,
                name: row.name,
                email: row.email,
              }),
            ),
          );
        }
      } catch {
        if (!cancelled) setMembers([]);
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Select
      value={value ?? ""}
      onValueChange={(next) => onChange(next ? next : null)}
      disabled={disabled}
    >
      <SelectTrigger id={id}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="">{placeholder}</SelectItem>
        {(members ?? []).map((member) => (
          <SelectItem key={member.userId} value={member.userId}>
            {member.name || member.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
