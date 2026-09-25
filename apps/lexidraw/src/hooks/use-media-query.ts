import { useCallback, useSyncExternalStore } from "react";

/** Whether `query` matches now; false while rendering on the server. */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** A mouse or trackpad: hover works and small targets are fine. */
export const useFinePointer = () => useMediaQuery("(pointer: fine)");

export type LayoutClass = "phone" | "tablet" | "desktop";

/** Phone below 640px, tablet to 1023px, desktop from 1024px: Tailwind's sm and lg. */
export function useLayoutClass(): LayoutClass {
  const tablet = useMediaQuery("(width >= 40rem)");
  const desktop = useMediaQuery("(width >= 64rem)");
  return desktop ? "desktop" : tablet ? "tablet" : "phone";
}

/** A finger: targets grow to 44px and nothing waits for hover. */
export const useCoarsePointer = () => useMediaQuery("(pointer: coarse)");
