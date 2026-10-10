"use client";
import { useSession } from "next-auth/react";
import { useEffect } from "react";
import { browserByok, clearBrowserByok } from "~/lib/byok/browser-session";

export function ByokSessionLifecycle() {
  const { data, status } = useSession();
  // NextAuth session identity and expiration own the device credential lifetime.
  useEffect(() => {
    if (status === "unauthenticated") {
      clearBrowserByok();
      return;
    }
    if (status !== "authenticated") return;
    browserByok(data.user.id);
    const remaining = new Date(data.expires).getTime() - Date.now();
    if (remaining <= 0) {
      clearBrowserByok();
      return;
    }
    const timer = window.setTimeout(
      clearBrowserByok,
      Math.min(remaining, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [status, data?.user.id, data?.expires]);
  return null;
}
