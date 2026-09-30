import { expect, test } from "bun:test";
import { parseHTMLBlockSource, snapshotDocument } from "./html-block";
test("bounds source and keeps saved data/defaults", () => {
  const source = parseHTMLBlockSource({
    html: '<input id="x">',
    javascript: "blockReady()",
    data: { n: 3 },
    defaults: { x: "4" },
    description: "Calculator",
  });
  expect(source.defaults).toEqual({ x: "4" });
  expect(() =>
    parseHTMLBlockSource({ ...source, html: "x".repeat(131073) }),
  ).toThrow();
});
test("snapshot wrapper cannot break CSP through source", () => {
  const page = snapshotDocument(
    "<p>Safe</p>",
    "</style><script>bad()</script>",
  );
  expect(page).not.toContain("<script>");
  expect(page).toContain("default-src 'none'");
});
