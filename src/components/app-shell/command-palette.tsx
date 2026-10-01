"use client";

import { ChevronRight, Command, Loader2, Search, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/shared/lib/cn";

interface CommandItem {
  id: string;
  title: string;
  description?: string;
  shortcut?: string;
  icon?: React.ReactNode;
  action: () => void;
  keywords: string[];
}

interface SearchResult {
  id: string;
  title: string;
  subtitle?: string;
  entityType: "contact" | "company" | "deal" | "task";
  url: string;
}

const COMMANDS: CommandItem[] = [
  {
    id: "new-contact",
    title: "New Contact",
    description: "Create a new contact",
    shortcut: "C",
    icon: <Search className="size-4" />,
    action: () => (window.location.href = "/app/contacts/new"),
    keywords: ["new", "create", "contact", "person", "add"],
  },
  {
    id: "new-company",
    title: "New Company",
    description: "Create a new company",
    shortcut: "O",
    icon: <Search className="size-4" />,
    action: () => (window.location.href = "/app/companies/new"),
    keywords: ["new", "create", "company", "organization", "account", "add"],
  },
  {
    id: "new-lead",
    title: "New Lead",
    description: "Create a new lead",
    shortcut: "L",
    icon: <Search className="size-4" />,
    action: () => (window.location.href = "/app/leads/new"),
    keywords: ["new", "create", "lead", "prospect", "add"],
  },
  {
    id: "new-deal",
    title: "New Deal",
    description: "Create a new deal",
    shortcut: "D",
    icon: <Search className="size-4" />,
    action: () => (window.location.href = "/app/deals/new"),
    keywords: ["new", "create", "deal", "opportunity", "add"],
  },
  {
    id: "new-task",
    title: "New Task",
    description: "Create a new task",
    shortcut: "T",
    icon: <Search className="size-4" />,
    action: () => (window.location.href = "/app/tasks/new"),
    keywords: ["new", "create", "task", "todo", "add"],
  },
  {
    id: "dashboard",
    title: "Go to Dashboard",
    description: "Navigate to dashboard",
    shortcut: "H",
    icon: <Search className="size-4" />,
    action: () => (window.location.href = "/app/dashboard"),
    keywords: ["dashboard", "home", "overview", "go"],
  },
  {
    id: "settings",
    title: "Settings",
    description: "Open settings",
    shortcut: ",",
    icon: <Search className="size-4" />,
    action: () => (window.location.href = "/app/settings"),
    keywords: ["settings", "preferences", "configuration", "options"],
  },
];

export function CommandPalette() {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Filter commands based on query
  const filteredCommands = COMMANDS.filter((cmd) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      cmd.title.toLowerCase().includes(q) ||
      cmd.description?.toLowerCase().includes(q) ||
      cmd.keywords.some((k) => k.includes(q))
    );
  });

  const open = useCallback(() => {
    setIsOpen(true);
    setQuery("");
    setSelectedIndex(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setQuery("");
    setSelectedIndex(0);
    setSearchResults([]);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const totalItems = filteredCommands.length + searchResults.length;
      if (totalItems === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % totalItems);
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
          break;
        case "Enter":
          e.preventDefault();
          if (selectedIndex < filteredCommands.length) {
            filteredCommands[selectedIndex].action();
            close();
          } else {
            const result =
              searchResults[selectedIndex - filteredCommands.length];
            if (result) {
              window.location.href = result.url;
              close();
            }
          }
          break;
        case "Escape":
          close();
          break;
      }
    },
    [filteredCommands, searchResults, selectedIndex, close],
  );

  // Global keyboard shortcut: Cmd+K / Ctrl+K
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (isOpen) {
          close();
        } else {
          open();
        }
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => window.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isOpen, open, close]);

  // Debounced search
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (query.length >= 2) {
      setSearchLoading(true);
      searchTimeoutRef.current = setTimeout(async () => {
        try {
          const response = await fetch(
            `/api/v1/search?q=${encodeURIComponent(query)}`,
          );
          if (response.ok) {
            const data = await response.json();
            setSearchResults(data.data ?? []);
          }
        } catch {
          setSearchResults([]);
        } finally {
          setSearchLoading(false);
        }
      }, 150);
    } else {
      setSearchResults([]);
      setSearchLoading(false);
    }

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [query]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="fixed inset-0 bg-ink-900/50 backdrop-blur-sm"
        onClick={close}
        aria-hidden="true"
      />

      <div className="fixed top-1/4 left-1/2 -translate-x-1/2 w-full max-w-2xl animate-in fade-in-0 zoom-in-95">
        <div className="bg-surface-raised border border-line rounded-lg shadow-lg overflow-hidden">
          {/* Search Input */}
          <div className="p-4 border-b border-line">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-ink-400"
                aria-hidden="true"
              />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a command or search..."
                className="w-full pl-10 pr-10 py-3 bg-surface border border-line rounded-lg text-base text-ink-900 dark:text-ink-50 placeholder-ink-400 focus:outline-none focus:ring-2 focus:ring-info"
                aria-label="Command palette search"
                autoComplete="off"
                aria-controls="command-palette-results"
                aria-activedescendant={
                  selectedIndex >= 0
                    ? selectedIndex < filteredCommands.length
                      ? `command-${filteredCommands[selectedIndex]?.id}`
                      : `result-${searchResults[selectedIndex - filteredCommands.length]?.id}`
                    : undefined
                }
              />
              {query && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                >
                  <X className="size-4" />
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2 mt-2 text-xs text-ink-500 dark:text-ink-400">
              <kbd className="px-1.5 py-0.5 bg-surface-sunken dark:bg-surface-raised rounded text-ink-600 dark:text-ink-400 font-mono">
                ⌘K
              </kbd>
              <span>to open</span>
              <span aria-hidden="true">•</span>
              <kbd className="px-1.5 py-0.5 bg-surface-sunken dark:bg-surface-raised rounded text-ink-600 dark:text-ink-400 font-mono">
                ↑↓
              </kbd>
              <span>to navigate</span>
              <span aria-hidden="true">•</span>
              <kbd className="px-1.5 py-0.5 bg-surface-sunken dark:bg-surface-raised rounded text-ink-600 dark:text-ink-400 font-mono">
                Enter
              </kbd>
              <span>to select</span>
              <span aria-hidden="true">•</span>
              <kbd className="px-1.5 py-0.5 bg-surface-sunken dark:bg-surface-raised rounded text-ink-600 dark:text-ink-400 font-mono">
                Esc
              </kbd>
              <span>to close</span>
            </div>
          </div>

          {/* Results */}
          <div
            id="command-palette-results"
            className="max-h-[500px] overflow-y-auto"
            // biome-ignore lint/a11y/useSemanticElements: a rich listbox has no HTML equivalent
            role="listbox"
            aria-label="Commands and search results"
          >
            {/* Commands */}
            {filteredCommands.length > 0 && (
              // biome-ignore lint/a11y/useSemanticElements: a listbox group is not a form-control group
              <div role="group" aria-label="Commands">
                <div
                  className="px-4 py-2 text-xs font-semibold tracking-[0.06em] uppercase text-ink-500 dark:text-ink-400 border-b border-line"
                  id="commands-heading"
                >
                  Commands
                </div>
                {filteredCommands.map((cmd, index) => (
                  <button
                    key={cmd.id}
                    id={`command-${cmd.id}`}
                    type="button"
                    role="option"
                    onClick={() => {
                      cmd.action();
                      close();
                    }}
                    className={cn(
                      "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                      index === selectedIndex && searchResults.length === 0
                        ? "bg-surface-hover"
                        : "hover:bg-surface-hover",
                    )}
                    aria-selected={
                      index === selectedIndex && searchResults.length === 0
                    }
                    aria-labelledby={`command-${cmd.id}`}
                  >
                    <span
                      className="flex size-8 items-center justify-center text-ink-400 dark:text-ink-500"
                      aria-hidden="true"
                    >
                      {cmd.icon}
                    </span>
                    <div className="flex-1 text-left">
                      <p className="font-medium text-ink-900 dark:text-ink-50">
                        {cmd.title}
                      </p>
                      {cmd.description && (
                        <p className="text-xs text-ink-500 dark:text-ink-400">
                          {cmd.description}
                        </p>
                      )}
                    </div>
                    {cmd.shortcut && (
                      <kbd className="px-2 py-0.5 text-xs font-mono text-ink-400 dark:text-ink-500 bg-surface-sunken dark:bg-surface-raised rounded">
                        {cmd.shortcut}
                      </kbd>
                    )}
                    {index === selectedIndex && searchResults.length === 0 && (
                      <ChevronRight
                        className="size-4 text-info flex-shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* Search Results */}
            {searchResults.length > 0 && (
              // biome-ignore lint/a11y/useSemanticElements: a listbox group is not a form-control group
              <div role="group" aria-label="Search results">
                <div
                  className="px-4 py-2 text-xs font-semibold tracking-[0.06em] uppercase text-ink-500 dark:text-ink-400 border-b border-line flex items-center gap-2"
                  id="results-heading"
                >
                  Search Results
                  {searchLoading && (
                    <Loader2
                      className="size-3 animate-spin"
                      aria-hidden="true"
                      aria-label="Loading search results"
                    />
                  )}
                </div>
                {searchResults.map((result, index) => {
                  const globalIndex = filteredCommands.length + index;
                  return (
                    <button
                      key={result.id}
                      id={`result-${result.id}`}
                      type="button"
                      role="option"
                      onClick={() => {
                        window.location.href = result.url;
                        close();
                      }}
                      className={cn(
                        "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                        globalIndex === selectedIndex
                          ? "bg-surface-hover"
                          : "hover:bg-surface-hover",
                      )}
                      aria-selected={globalIndex === selectedIndex}
                      aria-labelledby={`result-${result.id}`}
                    >
                      <span
                        className="flex size-8 items-center justify-center text-ink-400 dark:text-ink-500"
                        aria-hidden="true"
                      >
                        {getEntityIcon(result.entityType)}
                      </span>
                      <div className="flex-1 text-left min-w-0">
                        <p className="font-medium text-ink-900 dark:text-ink-50 truncate">
                          {result.title}
                        </p>
                        {result.subtitle && (
                          <p className="text-xs text-ink-500 dark:text-ink-400 truncate">
                            {result.subtitle}
                          </p>
                        )}
                      </div>
                      <span
                        className="px-2 py-0.5 text-[10px] font-medium uppercase rounded bg-surface-sunken dark:bg-surface-raised text-ink-500"
                        aria-hidden="true"
                      >
                        {result.entityType}
                      </span>
                      {globalIndex === selectedIndex && (
                        <ChevronRight
                          className="size-4 text-info flex-shrink-0"
                          aria-hidden="true"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Empty state */}
            {filteredCommands.length === 0 &&
              searchResults.length === 0 &&
              !searchLoading && (
                <output className="px-4 py-8 block text-center text-ink-500 dark:text-ink-400">
                  No results found
                </output>
              )}
          </div>
        </div>
      </div>
    </div>
  );

  function getEntityIcon(type: string) {
    switch (type) {
      case "contact":
        return <Search className="size-4" />;
      case "company":
        return <Search className="size-4" />;
      case "deal":
        return <Search className="size-4" />;
      case "task":
        return <Search className="size-4" />;
      default:
        return <Search className="size-4" />;
    }
  }
}
