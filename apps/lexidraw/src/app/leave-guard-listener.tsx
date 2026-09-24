"use client";

import { useRouter } from "next/navigation";
import { useLayoutEffect } from "react";
import { installLeaveGuard } from "~/lib/leave-guard";

/**
 * Installs the app-wide leave guard. Rendered in the root layout outside any
 * Suspense boundary, so it commits with the app router and its layout effect
 * runs before the router adds its own popstate listener.
 */
export default function LeaveGuardListener() {
  const router = useRouter();

  // External system: the window's navigation events.
  useLayoutEffect(
    () => installLeaveGuard(window, (href) => router.push(href)),
    [router],
  );

  return null;
}
