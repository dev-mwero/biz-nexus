"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui";
import { Spinner } from "@/components/ui/spinner";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The server cannot know the stored preference, so it always renders the
  // neutral icon. Swapping the icon only after mount avoids a hydration
  // mismatch, at the cost of one frame of the wrong glyph on a page that is
  // otherwise server-rendered.
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div className="size-9" aria-hidden="true">
        <Spinner className="size-4 opacity-0" />
      </div>
    );
  }

  const active = OPTIONS.find((option) => option.value === theme) ?? OPTIONS[2];
  const Icon = resolvedTheme === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`Theme: ${active.label}`}
            className="grid size-9 place-items-center rounded-md text-ink-600 transition-colors hover:bg-surface-hover dark:text-ink-300 dark:hover:bg-surface-hover"
          />
        }
      >
        <Icon aria-hidden="true" className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => setTheme(option.value)}
            className="justify-between"
          >
            <span className="flex items-center gap-2">
              <option.icon aria-hidden="true" className="size-3.5" />
              {option.label}
            </span>
            {theme === option.value ? (
              <span
                aria-hidden="true"
                className="size-1.5 rounded-full bg-ink-900"
              />
            ) : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
