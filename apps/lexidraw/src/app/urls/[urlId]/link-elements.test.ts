import { describe, expect, it } from "bun:test";
import { parseLinkElements } from "./link-elements";

describe("parseLinkElements", () => {
  it("reads the url and the distilled article", () => {
    const parsed = parseLinkElements(
      JSON.stringify({
        url: "https://example.com",
        distilled: {
          title: "Title",
          byline: null,
          siteName: "Example",
          wordCount: 120,
          updatedAt: "2026-09-24T01:50:26.932Z",
          contentHtml: "<p>Body</p>",
        },
      }),
    );
    expect(parsed).toEqual({
      url: "https://example.com",
      distilled: {
        title: "Title",
        byline: null,
        siteName: "Example",
        wordCount: 120,
        updatedAt: "2026-09-24T01:50:26.932Z",
        contentHtml: "<p>Body</p>",
      },
    });
  });

  it("drops fields of the wrong shape and keeps the rest", () => {
    const parsed = parseLinkElements(
      JSON.stringify({
        url: 42,
        distilled: {
          title: "Title",
          wordCount: "many",
          updatedAt: "yesterday",
          contentHtml: "<p>Body</p>",
        },
      }),
    );
    expect(parsed.url).toBe("");
    expect(parsed.distilled).toEqual({
      title: "Title",
      wordCount: undefined,
      updatedAt: undefined,
      contentHtml: "<p>Body</p>",
    });
  });

  it("has no article when the elements aren't a link", () => {
    for (const elements of [
      null,
      "",
      "not json",
      "[]",
      "null",
      '{"distilled":7}',
    ]) {
      expect(parseLinkElements(elements)).toEqual({
        url: "",
        distilled: undefined,
      });
    }
  });
});
