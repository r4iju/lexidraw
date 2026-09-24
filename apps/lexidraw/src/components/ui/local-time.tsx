"use client";

import { useSyncExternalStore } from "react";

/**
 * Nothing to subscribe to: the reader's locale and zone hold still. Kept out
 * of the compiler ("all" mode), which would memoize the returned function
 * with a hook, and React calls `subscribe` outside render.
 */
function subscribe() {
  "use no memo";
  return () => {};
}

/**
 * A timestamp in the reader's own locale and time zone. The server knows
 * neither, so it renders a fixed UTC form and the browser swaps in the local
 * one after hydration, rather than the two disagreeing mid-hydration.
 */
export function LocalTime({ value }: { value: string | Date }) {
  const iso = new Date(value).toISOString();
  const local = useSyncExternalStore(
    subscribe,
    () => new Date(iso).toLocaleString(),
    () => null,
  );
  return (
    <time dateTime={iso}>
      {local ?? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`}
    </time>
  );
}
