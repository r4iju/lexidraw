/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { propertyValueParts } from "./document-properties";

describe("propertyValueParts", () => {
  test("a status is one pill", () => {
    expect(propertyValueParts("Status", "In review")).toEqual([
      { kind: "status", text: "In review" },
    ]);
  });

  test("people named with @ are mentions, among other text", () => {
    expect(propertyValueParts("owners", "@ada, @grace.h and a guest")).toEqual([
      { kind: "mention", name: "ada" },
      { kind: "text", text: ", " },
      { kind: "mention", name: "grace.h" },
      { kind: "text", text: " and a guest" },
    ]);
  });

  test("an ISO date is a date on the reader's calendar, not shifted by time zone", () => {
    const [part] = propertyValueParts("due", "2026-10-01");
    expect(part).toMatchObject({ kind: "date", iso: "2026-10-01" });
    const date = part?.kind === "date" ? part.date : null;
    expect([date?.getFullYear(), date?.getMonth(), date?.getDate()]).toEqual([
      2026, 9, 1,
    ]);
  });

  test("an ISO date and time keeps its instant", () => {
    const [part] = propertyValueParts("published", "2026-10-01T09:30:00Z");
    expect(part).toMatchObject({ kind: "date", withTime: true });
    expect(part?.kind === "date" && part.date.toISOString()).toBe(
      "2026-10-01T09:30:00.000Z",
    );
  });

  test("a web address is a link", () => {
    expect(propertyValueParts("source", "https://example.com/a?b=1")).toEqual([
      {
        kind: "link",
        href: "https://example.com/a?b=1",
        text: "example.com/a?b=1",
      },
    ]);
  });

  test("anything else is text, including a date that does not exist", () => {
    expect(propertyValueParts("due", "2026-02-30")).toEqual([
      { kind: "text", text: "2026-02-30" },
    ]);
    expect(propertyValueParts("note", "javascript:alert(1)")).toEqual([
      { kind: "text", text: "javascript:alert(1)" },
    ]);
  });
});
