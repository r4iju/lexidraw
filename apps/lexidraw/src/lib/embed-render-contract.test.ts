import { expect, test } from "bun:test";
import { embedRenderRequest } from "./embed-render-contract";

test("renders both persisted article modes with their full HTML payload", () => {
  for (const data of [
    { mode: "url", url: "https://example.test/article", distilled: { title: "Article", contentHtml: "<h2>Heading</h2><p>Body</p>" } },
    { mode: "entity", entityId: "saved", snapshot: { title: "Article", contentHtml: "<h2>Heading</h2><p>Body</p>" } },
  ] as const) {
    const request = { node: { type: "article", version: 1, format: "center", data }, theme: "light", width: 390, fontFamily: "Source Serif 4", fontSize: 16 } as const;
    expect(embedRenderRequest.parse(request)).toEqual(request);
  }
});
