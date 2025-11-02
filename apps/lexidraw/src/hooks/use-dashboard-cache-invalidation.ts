"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useRouter } from "next/navigation";
import { revalidateDashboard } from "~/app/dashboard/server-actions";

/**
 * Hook to invalidate dashboard cache when navigating to dashboard/directory pages.
 * Works for both browser back button and programmatic navigation.
 * Uses throttling to prevent excessive refreshes.
 */
export function useDashboardCacheInvalidation() {
  const pathname = usePathname();
  const router = useRouter();
  const prevPathnameRef = useRef<string | null>(null);
  const lastRefreshRef = useRef<number>(0);

  // Throttle duration: only refresh once per route per 2 seconds
  const THROTTLE_MS = 2000;

  // Check if current path is a dashboard route
  const isDashboardRoute =
    pathname === "/dashboard" || pathname.startsWith("/dashboard/");

  useEffect(() => {
    // Skip on initial mount (no previous pathname yet)
    if (prevPathnameRef.current === null) {
      prevPathnameRef.current = pathname;
      return;
    }

    // Only trigger if we're navigating TO a dashboard route
    // (not when navigating away from it)
    if (!isDashboardRoute) {
      prevPathnameRef.current = pathname;
      return;
    }

    // Check if we actually navigated (pathname changed)
    if (prevPathnameRef.current === pathname) {
      return;
    }

    // Throttle: prevent excessive refreshes
    const now = Date.now();
    const timeSinceLastRefresh = now - lastRefreshRef.current;

    if (timeSinceLastRefresh < THROTTLE_MS) {
      prevPathnameRef.current = pathname;
      return;
    }

    // Trigger background cache invalidation
    const invalidateCache = async () => {
      // Update throttle timestamp
      lastRefreshRef.current = now;

      // Server-side cache invalidation (non-blocking)
      revalidateDashboard().catch((error) => {
        console.error("Failed to revalidate dashboard cache:", error);
      });

      // Client-side cache refresh (non-blocking)
      router.refresh();
    };

    invalidateCache();

    // Update previous pathname
    prevPathnameRef.current = pathname;
  }, [pathname, router, isDashboardRoute]);
}
