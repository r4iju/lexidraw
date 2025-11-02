"use client";

import { useEffect, useEffectEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";

type Canonical = {
  sortBy: "updatedAt" | "createdAt" | "title";
  sortOrder: "asc" | "desc";
  flex: "flex-row" | "flex-col";
  tags?: string;
  includeArchived?: boolean;
  onlyFavorites?: boolean;
};

export function CanonicalizeDashboardURL({
  canonical,
}: {
  canonical: Canonical;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const updateUrlQueryParams = useEffectEvent(() => {
    const current = searchParams.toString();
    const sp = new URLSearchParams(current);

    const maybeSet = (key: string, value?: string | boolean) => {
      if (sp.has(key) || value === undefined || value === null) return;
      sp.set(key, typeof value === "boolean" ? String(value) : value);
    };

    maybeSet("sortBy", canonical.sortBy);
    maybeSet("sortOrder", canonical.sortOrder);
    maybeSet("flex", canonical.flex);
    maybeSet("tags", canonical.tags);
    maybeSet("includeArchived", canonical.includeArchived);
    maybeSet("onlyFavorites", canonical.onlyFavorites);

    const next = sp.toString();
    if (next !== current) {
      const url = next ? `${pathname}?${next}` : pathname;
      window.history.replaceState(null, "", url);
    }
  });

  useEffect(() => {
    updateUrlQueryParams();
  }, [updateUrlQueryParams]);

  return null;
}
