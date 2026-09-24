import { afterEach, describe, expect, it } from "bun:test";
import { JSDOM } from "jsdom";
import { act, type ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { LocalTime } from "./local-time";

const VALUE = "2026-09-24T01:50:26.932Z";

describe("LocalTime", () => {
  it("renders the same UTC text on the server whatever the server's zone or locale", () => {
    const html = renderToString(<LocalTime value={VALUE} />);
    expect(html).toBe(`<time dateTime="${VALUE}">2026-09-24 01:50 UTC</time>`);
  });

  it("takes a Date or epoch milliseconds as well as a string", () => {
    const date = new Date("2026-01-02T03:04:05.000Z");
    expect(renderToString(<LocalTime value={date} />)).toContain(
      "2026-01-02 03:04 UTC",
    );
    expect(renderToString(<LocalTime value={date.getTime()} />)).toContain(
      "2026-01-02 03:04 UTC",
    );
  });

  it("renders nothing for a date that doesn't parse", () => {
    expect(renderToString(<LocalTime value="yesterday" />)).toBe("");
  });

  it("renders a UTC date on the server for the date format", () => {
    expect(renderToString(<LocalTime value={VALUE} format="date" />)).toBe(
      `<time dateTime="${VALUE}">2026-09-24</time>`,
    );
  });

  it("renders UTC seconds on the server for the datetime format", () => {
    expect(renderToString(<LocalTime value={VALUE} format="datetime" />)).toBe(
      `<time dateTime="${VALUE}">2026-09-24 01:50:26 UTC</time>`,
    );
  });
});

describe("LocalTime hydration", () => {
  const originalTz = process.env.TZ;
  const globals = globalThis as Record<string, unknown>;
  const shimmed = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"] as const;
  const saved = shimmed.map((key) => [key, globals[key]] as const);

  afterEach(() => {
    process.env.TZ = originalTz;
    for (const [key, value] of saved) globals[key] = value;
  });

  /**
   * Server-renders in UTC, then hydrates in Tokyo, the way a UTC server and a
   * reader in Japan meet. Returns the recoverable errors hydration raised
   * (React #418 lands here) and the text the reader ends up seeing.
   */
  async function hydrateAcrossZones(element: ReactElement) {
    process.env.TZ = "UTC";
    const html = renderToString(element);

    process.env.TZ = "Asia/Tokyo";
    const { window } = new JSDOM("<!doctype html><html><body></body></html>");
    globals.window = window;
    globals.document = window.document;
    globals.IS_REACT_ACT_ENVIRONMENT = true;
    const { hydrateRoot } = await import("react-dom/client");

    const container = window.document.createElement("div");
    container.innerHTML = html;
    window.document.body.append(container);

    const errors: unknown[] = [];
    await act(async () => {
      hydrateRoot(container, element, {
        onRecoverableError: (error) => errors.push(error),
      });
    });
    return { errors, text: container.textContent };
  }

  it("hydrates without a mismatch, then shows the reader's local time", async () => {
    const { errors, text } = await hydrateAcrossZones(
      <LocalTime value={VALUE} />,
    );
    expect(errors).toEqual([]);
    expect(text).toBe(new Date(VALUE).toLocaleString());
    expect(text).toContain("10:50:26");
  });

  it("shows the reader's local date for the date format", async () => {
    const { errors, text } = await hydrateAcrossZones(
      <LocalTime value="2026-09-24T20:00:00.000Z" format="date" />,
    );
    expect(errors).toEqual([]);
    expect(text).toBe("2026-09-25");
  });

  it("shows the reader's local seconds for the datetime format", async () => {
    const { errors, text } = await hydrateAcrossZones(
      <LocalTime value={VALUE} format="datetime" />,
    );
    expect(errors).toEqual([]);
    expect(text).toBe("2026-09-24 10:50:26");
  });
});
