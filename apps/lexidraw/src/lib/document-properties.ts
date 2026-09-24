/** A piece of a header property's value, as the header shows it. */
export type PropertyPart =
  | { kind: "text"; text: string }
  | { kind: "status"; text: string }
  | { kind: "mention"; name: string }
  | { kind: "link"; href: string; text: string }
  | { kind: "date"; iso: string; date: Date; withTime: boolean };

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const WEB_ADDRESS = /^https?:\/\/[^\s]+$/;
const MENTION = /(^|[^\w@])@([\w][\w.-]*[\w]|[\w])/g;

function dateOf(value: string): PropertyPart | null {
  const day = DATE_ONLY.exec(value);
  if (day) {
    const [year, month, date] = day.slice(1).map(Number) as [
      number,
      number,
      number,
    ];
    // A date without a time is a day on the reader's calendar; read as UTC
    // it would show as the day before west of Greenwich.
    const local = new Date(year, month - 1, date);
    return local.getMonth() === month - 1 && local.getDate() === date
      ? { kind: "date", iso: value, date: local, withTime: false }
      : null;
  }
  if (DATE_TIME.test(value)) {
    const instant = new Date(value);
    return Number.isNaN(instant.getTime())
      ? null
      : { kind: "date", iso: value, date: instant, withTime: true };
  }
  return null;
}

function mentionsIn(value: string): PropertyPart[] {
  const parts: PropertyPart[] = [];
  let cursor = 0;
  for (const match of value.matchAll(MENTION)) {
    const start = match.index + (match[1]?.length ?? 0);
    if (start > cursor)
      parts.push({ kind: "text", text: value.slice(cursor, start) });
    parts.push({ kind: "mention", name: match[2] ?? "" });
    cursor = start + 1 + (match[2]?.length ?? 0);
  }
  if (cursor < value.length)
    parts.push({ kind: "text", text: value.slice(cursor) });
  return parts;
}

/**
 * How a property's value reads: a `status` as a pill, `@name` as a mention,
 * an ISO date on the reader's calendar, a web address as a link, and the
 * rest as the text it is.
 */
export function propertyValueParts(key: string, value: string): PropertyPart[] {
  const text = value.trim();
  if (key.trim().toLowerCase() === "status" && text)
    return [{ kind: "status", text }];
  const date = dateOf(text);
  if (date) return [date];
  if (WEB_ADDRESS.test(text)) {
    try {
      const url = new URL(text);
      return [
        {
          kind: "link",
          href: text,
          text: `${url.host}${url.pathname === "/" ? "" : url.pathname}${url.search}${url.hash}`,
        },
      ];
    } catch {
      return [{ kind: "text", text }];
    }
  }
  return mentionsIn(text);
}
