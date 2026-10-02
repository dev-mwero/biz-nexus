"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string | null;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
}

interface SessionData {
  user: User | null;
  organizations: Organization[];
  activeOrganizationId: string | null;
  role: { id: string; name: string } | null;
  permissions: string[];
}

interface SessionContextType {
  data: SessionData | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSession = async () => {
    try {
      const response = await fetch("/api/v1/auth/me");
      if (response.ok) {
        const result = await response.json();
        setData(result.data);
      } else {
        setData(null);
      }
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  // `fetchSession` is redefined on every render, so it cannot be a dependency
  // without refetching forever. Mount-only is the intent, and the exhaustive
  // deps rule is right that this closes over a stale `setData` — which is safe
  // precisely because React state setters are stable for a component's life.
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only by design
  useEffect(() => {
    fetchSession();
  }, []);

  const refresh = async () => {
    setLoading(true);
    await fetchSession();
  };

  return (
    <SessionContext.Provider value={{ data, loading, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within a SessionProvider");
  }
  return context;
}
