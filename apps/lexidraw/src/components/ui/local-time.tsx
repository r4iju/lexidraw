"use client";
// React calls `subscribe` outside render and the formatters run inside
// `getSnapshot`, so none of them may hold a compiler cache. With
// `compilationMode: "all"`, a dev build gives every function in the module
// one (`_c()`, for the hot-reload reset) even when nothing is memoized: the
// page fails with "Invalid hook call", or the formatters clash with
// LocalTime's own cache.
"use no memo";

import { format as formatDate } from "date-fns";
import { useSyncExternalStore } from "react";

/**
 * Each format pairs the reader's local form with a UTC form of the same
 * shape, which is all the server can render: it knows neither the reader's
 * zone nor locale.
 */
const FORMATS = {
  locale: {
    local: (date: Date) => date.toLocaleString(),
    utc: (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`,
  },
  date: {
    local: (date: Date) => formatDate(date, "yyyy-MM-dd"),
    utc: (iso: string) => iso.slice(0, 10),
  },
  datetime: {
    local: (date: Date) => formatDate(date, "yyyy-MM-dd HH:mm:ss"),
    utc: (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`,
  },
} as const;

/** Nothing to subscribe to: the reader's locale and zone hold still. */
function subscribe() {
  return () => {};
}

/**
 * A timestamp in the reader's own zone and locale. The server renders the
 * UTC form and the browser swaps in the local one after hydration, so the two
 * never disagree mid-hydration (React #418). A value that isn't a date
 * renders nothing.
 */
export function LocalTime({
  value,
  format = "locale",
}: {
  value: string | number | Date;
  format?: keyof typeof FORMATS;
}) {
  const date = new Date(value);
  const iso = Number.isNaN(date.getTime()) ? null : date.toISOString();
  const local = useSyncExternalStore(
    subscribe,
    () => (iso === null ? null : FORMATS[format].local(new Date(iso))),
    () => null,
  );
  if (iso === null) return null;
  return <time dateTime={iso}>{local ?? FORMATS[format].utc(iso)}</time>;
}
