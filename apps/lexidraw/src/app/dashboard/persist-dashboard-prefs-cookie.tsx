"use client";

import { useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Mirrors dashboard query params into a cookie so the server can
 * seed missing params on first load without a client-side flash.
 */
export function PersistDashboardPrefsCookie() {
  const searchParams = useSearchParams();
  const paramsKey = useMemo(() => searchParams.toString(), [searchParams]);

  useEffect(() => {
    const sp = new URLSearchParams(paramsKey);
    // Only persist when at least one tracked key is present in the URL.
    const trackedKeys = [
      "sortBy",
      "sortOrder",
      "flex",
      "tags",
      "includeArchived",
      "onlyFavorites",
    ] as const;
    const anyPresent = trackedKeys.some((k) => sp.has(k));
    if (!anyPresent) return;

    // Build a partial update from present keys only, preserving existing cookie values for others
    const partial: Record<string, unknown> = {};
    if (sp.has("sortBy")) partial.sortBy = sp.get("sortBy") ?? undefined;
    if (sp.has("sortOrder"))
      partial.sortOrder = sp.get("sortOrder") ?? undefined;
    if (sp.has("flex")) partial.flex = sp.get("flex") ?? undefined;
    if (sp.has("tags")) partial.tags = sp.get("tags") ?? undefined;
    if (sp.has("includeArchived"))
      partial.includeArchived =
        (sp.get("includeArchived") ?? "false") === "true";
    if (sp.has("onlyFavorites"))
      partial.onlyFavorites = (sp.get("onlyFavorites") ?? "false") === "true";

    try {
      // Merge with existing cookie data to avoid losing previously saved keys
      const existing = (() => {
        try {
          const match = document.cookie
            .split("; ")
            .find((row) => row.startsWith("ld_dash_prefs="));
          if (!match) return {} as Record<string, unknown>;
          const raw = match.split("=")[1] ?? "";
          const parsed = JSON.parse(decodeURIComponent(raw));
          return parsed && typeof parsed === "object"
            ? (parsed as Record<string, unknown>)
            : {};
        } catch {
          return {} as Record<string, unknown>;
        }
      })();

      const merged = { ...existing, ...partial } as Record<string, unknown>;
      const encoded = encodeURIComponent(JSON.stringify(merged));
      // 180 days in seconds ~ 15552000
      // biome-ignore lint/suspicious/noDocumentCookie: we want to set a cookie
      document.cookie = `ld_dash_prefs=${encoded}; path=/; max-age=15552000; samesite=lax`;
    } catch {
      // ignore cookie write errors
    }
  }, [paramsKey]);

  return null;
}
