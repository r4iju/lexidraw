"use client";

import { format as formatDate, formatDistanceToNow } from "date-fns";
import { useSyncExternalStore } from "react";
import { timeAgo } from "~/lib/time-ago";

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
  /** "3 days ago", with the exact time on hover. */
  relative: {
    local: (date: Date) => formatDistanceToNow(date, { addSuffix: true }),
    utc: (iso: string) => iso.slice(0, 10),
  },
  /**
   * "9 min ago", with the exact time on hover. The server's count can be a
   * minute off the reader's by the time it hydrates, hence the suppressed
   * warning below.
   */
  ago: {
    local: (date: Date) => timeAgo(date),
    utc: (iso: string) => timeAgo(new Date(iso)),
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
  const exact = useSyncExternalStore(
    subscribe,
    () => (iso === null ? null : FORMATS.locale.local(new Date(iso))),
    () => null,
  );
  if (iso === null) return null;
  return (
    <time
      dateTime={iso}
      title={
        format === "relative" || format === "ago"
          ? (exact ?? FORMATS.locale.utc(iso))
          : undefined
      }
      suppressHydrationWarning={format === "ago"}
    >
      {local ?? FORMATS[format].utc(iso)}
    </time>
  );
}
