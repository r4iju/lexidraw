/// <reference types="bun" />
import { afterEach, describe, expect, it } from "bun:test";
import { installServerRuntime } from "~/test/server-runtime";

await installServerRuntime();
const { renderDocument } = await import("./render");

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** What the page renderer is asked to open the page as. */
async function viewportFor(touch?: boolean) {
  let sent: { viewport?: Record<string, unknown> } = {};
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body));
    return new Response(new Uint8Array([1]));
  }) as typeof fetch;
  await renderDocument({
    documentId: "doc-touch",
    userId: "user-touch",
    options: { format: "png", width: 375, theme: "light", touch },
  });
  return sent.viewport;
}

describe("document render", () => {
  it("opens the page on a touch screen when asked", async () => {
    expect(await viewportFor(true)).toMatchObject({
      width: 375,
      hasTouch: true,
      isMobile: true,
    });
  });

  it("opens it with a mouse otherwise", async () => {
    expect(await viewportFor()).toMatchObject({
      hasTouch: false,
      isMobile: false,
    });
  });
});
