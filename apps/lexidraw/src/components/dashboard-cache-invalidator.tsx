"use client";

import { useDashboardCacheInvalidation } from "~/hooks/use-dashboard-cache-invalidation";

/**
 * Component that invalidates dashboard cache when navigating to dashboard/directory pages.
 * Works for both browser back button and programmatic navigation.
 * Should be placed in the root layout to monitor all routes globally.
 */
export function DashboardCacheInvalidator() {
  useDashboardCacheInvalidation();
  return null;
}
