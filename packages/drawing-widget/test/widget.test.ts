/// <reference types="bun" />
/**
 * The widget in a browser, against the SDK's own host half.
 *
 * What is being checked is the round trip nobody else can check: a host
 * delivers a tool result, the editor renders the elements it carried, an edit
 * in the editor comes back as a `put_drawing` call — carrying the edit and the
 * precondition the result was read at — and the widget reports it saved. The
 * server side of the same protocol is checked in the MCP route's tests.
 */
import { afterAll, expect, test } from "bun:test";
import { DRAWING_PREVIEW_HTML } from "@packages/drawing-widget/html";
import { type Browser, chromium, type Page } from "playwright";

import { DRAWING_PREVIEW_META_KEY } from "../src/protocol";

const SCREENSHOT = "/tmp/qa-36-widget.png";

/** Launching a browser and mounting an editor is slower than a unit test. */
const TIMEOUT = 120_000;

/** A canonical element, with the fields the editor does not default. */
function box(id: string, x: number, label: string) {
  return [
    {
      id,
      type: "rectangle",
      x,
      y: 80,
      width: 180,
      height: 100,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "#a5d8ff",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: { type: 3 },
      seed: 1,
      version: 1,
      versionNonce: 1,
      isDeleted: false,
      boundElements: [{ id: `${id}-label`, type: "text" }],
      updated: 1,
      link: null,
      locked: false,
    },
    {
      id: `${id}-label`,
      type: "text",
      x: x + 20,
      y: 115,
      width: 140,
      height: 25,
      angle: 0,
      strokeColor: "#1e1e1e",
      backgroundColor: "transparent",
      fillStyle: "solid",
      strokeWidth: 2,
      strokeStyle: "solid",
      roughness: 1,
      opacity: 100,
      groupIds: [],
      frameId: null,
      roundness: null,
      seed: 2,
      version: 1,
      versionNonce: 2,
      isDeleted: false,
      boundElements: null,
      updated: 1,
      link: null,
      locked: false,
      text: label,
      fontSize: 20,
      fontFamily: 1,
      textAlign: "center",
      verticalAlign: "middle",
      containerId: id,
      originalText: label,
      lineHeight: 1.25,
    },
  ];
}

const payload = {
  id: "drawing-under-test",
  title: "Two boxes",
  updatedAt: "2026-09-23T10:00:00.000Z",
  elements: [...box("one", 60, "one"), ...box("two", 320, "two")],
  canWrite: true,
};

let browser: Browser | null = null;
let server: ReturnType<typeof Bun.serve> | null = null;
let hostPage = "";

/** A host page with the widget in it, connected and waiting for a result. */
async function boot(): Promise<Page> {
  if (!browser) {
    const built = await Bun.build({
      entrypoints: [`${import.meta.dir}/host.ts`],
      target: "browser",
      format: "esm",
    });
    if (!built.success) throw new Error(built.logs.join("\n"));
    const host = await built.outputs[0]?.text();
    if (!host) throw new Error("the host page did not build");
    hostPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>host</title></head><body><script type="module">${host.replaceAll("</script", "<\\/script")}</script></body></html>`;
    server = Bun.serve({
      port: 0,
      fetch(request) {
        const { pathname } = new URL(request.url);
        const body = pathname === "/widget" ? DRAWING_PREVIEW_HTML : hostPage;
        return new Response(body, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    });
    browser = await chromium.launch();
  }
  const page = await browser.newPage({
    viewport: { width: 1000, height: 700 },
  });
  await page.goto(`http://localhost:${server?.port}/`);
  await page.waitForFunction(() => window.host?.initialized === true, null, {
    timeout: 30_000,
  });
  return page;
}

/** The frame the widget runs in, once its editor is on screen. */
async function editor(page: Page) {
  const frame = page.frameLocator("#app");
  await frame.locator(".excalidraw").waitFor({ timeout: 30_000 });
  const widget = page
    .frames()
    .find((candidate) => candidate.url().endsWith("/widget"));
  if (!widget) throw new Error("the widget frame never loaded");
  await widget.waitForFunction(
    () => (window.excalidrawAPI?.getSceneElements().length ?? 0) >= 4,
    null,
    { timeout: 30_000 },
  );
  return { frame, widget };
}

/** What a host sends when a drawing tool answers. */
function deliver(page: Page, drawing: typeof payload) {
  return page.evaluate(
    ([key, value]) =>
      window.host.deliver({
        content: [
          {
            type: "text",
            text: JSON.stringify({
              id: (value as { id: string }).id,
              updatedAt: (value as { updatedAt: string }).updatedAt,
              elementCount: 4,
            }),
          },
        ],
        _meta: { [key as string]: value },
      }),
    [DRAWING_PREVIEW_META_KEY, drawing] as const,
  );
}

afterAll(async () => {
  await browser?.close();
  server?.stop(true);
});

const payloadId = payload.id;

test(
  "renders a tool result and saves the edit back",
  async () => {
    const page = await boot();
    await deliver(page, payload);
    const { frame, widget } = await editor(page);
    await expect(frame.locator(".title").innerText()).resolves.toBe(
      "Two boxes",
    );

    // The edit: a third box, added the way a host or a user's stroke would add
    // one — through the editor, not through the widget's own state.
    await widget.evaluate(
      (element) => {
        const api = window.excalidrawAPI;
        if (!api) throw new Error("no editor");
        api.updateScene({
          elements: [...api.getSceneElements(), element] as never,
        });
      },
      box("three", 580, "three")[0],
    );

    await page.waitForFunction(
      () => window.host.calls.some((call) => call.name === "put_drawing"),
      null,
      { timeout: 30_000 },
    );

    const call = await page.evaluate(() =>
      window.host.calls.find((candidate) => candidate.name === "put_drawing"),
    );
    expect(call?.arguments?.id).toBe(payload.id);
    // The precondition is the revision the widget was handed, not a guess.
    expect(call?.arguments?.ifUnmodifiedSince).toBe(payload.updatedAt);
    const saved = call?.arguments?.elements as { id: string }[];
    expect(saved.map((element) => element.id)).toContain("three");
    expect(saved.length).toBe(5);

    await expect(
      frame.locator('[data-testid="status"]').innerText(),
    ).resolves.toContain("Saved");
    // The model read these elements when the tool answered, so it is told what
    // the user changed rather than left with the version it was given.
    await page.waitForFunction(() => window.host.context.length > 0, null, {
      timeout: 30_000,
    });
    const [told] = await page.evaluate(() => window.host.context);
    expect(told).toContain(payloadId);
    expect(told).toContain("5 elements");
    await page.screenshot({ path: SCREENSHOT });
  },
  TIMEOUT,
);

test(
  "stays read-only on a read-scope connection",
  async () => {
    const page = await boot();
    await deliver(page, { ...payload, canWrite: false });
    const { frame, widget } = await editor(page);
    await expect(
      widget.evaluate(
        () => window.excalidrawAPI?.getAppState().viewModeEnabled,
      ),
    ).resolves.toBe(true);
    await expect(
      frame.locator('[data-testid="status"]').innerText(),
    ).resolves.toContain("Read-only");
  },
  TIMEOUT,
);
