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
