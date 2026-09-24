import { describe, expect, it } from "bun:test";
import { renderToString } from "react-dom/server";
import { LocalTime } from "./local-time";

describe("LocalTime", () => {
  it("renders the same UTC text on the server whatever the server's zone or locale", () => {
    const html = renderToString(<LocalTime value="2026-09-24T01:50:26.932Z" />);
    expect(html).toBe(
      '<time dateTime="2026-09-24T01:50:26.932Z">2026-09-24 01:50 UTC</time>',
    );
  });

  it("takes a Date as well as a string", () => {
    const html = renderToString(
      <LocalTime value={new Date("2026-01-02T03:04:05.000Z")} />,
    );
    expect(html).toContain("2026-01-02 03:04 UTC");
  });
});
