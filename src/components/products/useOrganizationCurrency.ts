"use client";

import { useEffect, useState } from "react";

interface OrganizationCurrency {
  currency: string | null;
  loading: boolean;
  error: boolean;
}

/**
 * The active organisation's currency.
 *
 * The session payload does not carry it, so it is read from the organisation
 * endpoint every role may call (`organization.read`). The product form needs it
 * to parse a typed price into minor units and to render the current one, and
 * there is no other client-side source for the denomination.
 */
export function useOrganizationCurrency(): OrganizationCurrency {
  const [currency, setCurrency] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;

    (async () => {
      try {
        const res = await fetch("/api/v1/organizations/current");
        if (!res.ok) throw new Error("Could not load the organisation");
        const body = await res.json();
        if (active) setCurrency(body.data.currency);
      } catch {
        if (active) setError(true);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  return { currency, loading, error };
}
