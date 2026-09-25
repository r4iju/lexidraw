"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { DASHBOARD_PREFS_COOKIE, readDashboardPrefs } from "./dashboard-prefs";

const TRACKED = ["sortBy", "sortOrder", "flex", "tags", "view"] as const;

/**
 * Mirrors dashboard query params into a cookie so the server can
 * seed missing params on first load without a client-side flash.
 */
export function PersistDashboardPrefsCookie() {
  const searchParams = useSearchParams();
  const paramsKey = useMemo(() => searchParams.toString(), [searchParams]);

  useEffect(() => {
    const params = new URLSearchParams(paramsKey);
    const chosen = Object.fromEntries(
      TRACKED.filter((key) => params.has(key)).map((key) => [
        key,
        params.get(key),
      ]),
    );
    if (!Object.keys(chosen).length) return;
    const merged = { ...readDashboardPrefs(document.cookie), ...chosen };
    const encoded = encodeURIComponent(JSON.stringify(merged));
    // biome-ignore lint/suspicious/noDocumentCookie: we want to set a cookie
    document.cookie = `${DASHBOARD_PREFS_COOKIE}=${encoded}; path=/; max-age=${180 * 24 * 60 * 60}; samesite=lax`;
  }, [paramsKey]);

  return null;
}
