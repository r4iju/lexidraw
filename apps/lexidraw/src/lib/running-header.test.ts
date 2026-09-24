/// <reference types="bun" />
import { describe, expect, test } from "bun:test";
import { runningHeaderCss } from "./running-header";

describe("the running header of a printed document", () => {
  test("names the document on every sheet but the first", () => {
    const css = runningHeaderCss("Kyoto in Autumn");
    expect(css).toContain('@top-left{content:"Kyoto in Autumn"}');
    expect(css).toContain("@page :first{@top-left{content:none}}");
  });

  test("keeps a title's quotes, backslashes and line breaks as text", () => {
    const css = runningHeaderCss('Say "hi" \\ bye\nnow');
    expect(css).toContain('content:"Say \\"hi\\" \\\\ bye now"');
  });

  test("a title cannot close the style it sits in", () => {
    const css = runningHeaderCss("</style><script>alert(1)</script>");
    expect(css).not.toContain("<");
    expect(css).toContain("\\3c /style>");
  });
});
