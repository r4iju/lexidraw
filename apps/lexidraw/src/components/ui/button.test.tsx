import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./button";

describe("a button", () => {
  test("that wraps a link cannot be pending, as a link cannot be held", () => {
    const html = renderToStaticMarkup(
      // @ts-expect-error a wrapped link has no pending state
      <Button asChild pending>
        <a href="/dashboard">Home</a>
      </Button>,
    );
    expect(html).toStartWith("<a ");
    expect(html).not.toContain("aria-busy");
  });
});
