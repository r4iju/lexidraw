import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DocumentTypography } from "./document-typography";

function render(text: string, settings = {}) {
  return renderToStaticMarkup(
    <DocumentTypography
      entity={{
        elements: JSON.stringify({ root: { children: [{ text }] } }),
        appState: JSON.stringify(settings),
      }}
    >
      Content
    </DocumentTypography>,
  );
}

describe("document reading settings in the first render", () => {
  test("detects Japanese from document text, not serialized metadata", () => {
    expect(render("京都の秋をゆっくり歩きましょう。Enjoy Kyoto.")).toContain(
      'lang="ja"',
    );
    expect(render("An English document.")).toContain('lang="en"');
    expect(render("한국어 문서를 읽어 보세요")).toContain('lang="ko"');
    expect(render("中文文档内容，阅读和书写。")).toContain('lang="zh-Hans"');
  });
  test("honours stored language and applies serif before hydration", () => {
    const html = render("京都の秋", {
      lang: "zh-Hant",
      defaultFontFamily: "serif",
    });
    expect(html).toContain('lang="zh-Hant"');
    expect(html).toContain("--doc-font-serif");
    expect(html).not.toContain("fonts.googleapis.com");
  });
  test("maps a bundled face without requesting Google Fonts again", () => {
    const html = render("A document", { defaultFontFamily: "Noto Sans JP" });
    expect(html).toContain("var(--font-noto)");
    expect(html).not.toContain("/api/fonts");
    expect(html).not.toContain("fonts.googleapis.com");
  });
  test("loads custom multi-word fonts in the first render", () => {
    const html = render("A document", { defaultFontFamily: "Open Sans" });
    expect(html).toContain("/api/fonts?family=Open%20Sans");
    expect(html).toContain("&quot;Open Sans&quot;");
  });
});
