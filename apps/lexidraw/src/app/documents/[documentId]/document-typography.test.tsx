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
  test("loads only the requested document face", () => {
    const html = render("A document", { defaultFontFamily: "Noto Sans JP" });
    expect(html).toContain("Noto Sans JP");
    expect(html).toContain("/api/fonts?family=Noto%20Sans%20JP");
    expect(html).not.toContain("Noto%20Sans%20SC");
    expect(html).not.toContain("fonts.googleapis.com");
  });
  test("loads custom multi-word fonts in the first render", () => {
    const html = render("A document", { defaultFontFamily: "Open Sans" });
    expect(html).toContain("/api/fonts?family=Open%20Sans");
    expect(html).toContain("&quot;Open Sans&quot;");
  });
});

test("detects Traditional Chinese and leaves ambiguous Han to the locale", () => {
  expect(render("我們這裡說繁體中文，會閱讀書籍。")).toContain(
    'lang="zh-Hant"',
  );
  expect(render("中文山水")).not.toContain('lang="zh-Hans"');
});

test("system English requests no document webfonts, Japanese requests only JP", () => {
  expect(render("English text")).not.toContain("/api/fonts");
  const html = render("日本語の文章です。");
  expect(html).toContain("/api/fonts?family=Noto%20Sans%20JP");
  expect(html).not.toContain("Noto%20Sans%20SC");
  expect(html).not.toContain("Noto%20Serif");
});
