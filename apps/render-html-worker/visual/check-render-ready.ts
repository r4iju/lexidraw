import assert from "node:assert/strict";
import type { Page } from "puppeteer";
import { appUrl } from "./app-url";

/** How late a chunk arrives that is asked for once the document shows. */
const LATE_MS = 3000;

type Block = {
  type?: string;
  language?: string;
  text?: string;
  children?: Block[];
};

/**
 * What each block loads for itself, and how its print shows it has drawn.
 * Each is printed alone, so no slower block keeps the page busy for it.
 */
const LAZY = {
  code: {
    is: (block: Block) =>
      block.type === "code" && block.language === "typescript",
    drawn: "code[data-language='typescript'] span[style*='--shiki-light']",
  },
  equation: {
    is: (block: Block) => block.type === "equation",
    drawn: ".katex",
  },
  diagram: {
    is: (block: Block) => block.type === "mermaid",
    drawn: "img[data-mermaid]",
  },
  chart: {
    is: (block: Block) => block.type === "chart",
    drawn: ".recharts-surface",
  },
  drawing: {
    is: (block: Block) => block.type === "excalidraw",
    drawn: "img.excalidraw-embed",
  },
} as const;

export type LazyBlock = keyof typeof LAZY;

const holds = (block: Block, is: (block: Block) => boolean): boolean =>
  is(block) || (block.children ?? []).some((child) => holds(child, is));

/**
 * A code block as the API writes one: plain text, not yet split into the
 * highlighted tokens a browser saves.
 */
const unhighlighted = (block: Block): Block => ({
  ...block,
  children: (block.children ?? [])
    .map((child) => (child.type === "linebreak" ? "\n" : (child.text ?? "")))
    .join("")
    .split("\n")
    .flatMap((line, index) => [
      ...(index ? [{ type: "linebreak", version: 1 }] : []),
      ...(line
        ? [
            {
              type: "text",
              text: line,
              detail: 0,
              format: 0,
              mode: "normal",
              style: "",
              version: 1,
            },
          ]
        : []),
    ]),
});

/**
 * One document per block that loads its code as it is drawn, each holding a
 * paragraph and the first of the fixture's blocks that holds one.
 */
export function lazyBlockDocuments(root: Block & { children: Block[] }) {
  const paragraph = root.children.find(
    (child) => child.type === "paragraph" && child.children?.length,
  );
  return Object.entries(LAZY).map(([name, { is }]) => {
    const found = root.children.find((child) => holds(child, is));
    assert.ok(found, `the fixture has a ${name} block`);
    const block = name === "code" ? unhighlighted(found) : found;
    return {
      name: name as LazyBlock,
      elements: JSON.stringify({
        root: { ...root, children: [paragraph, block].filter(Boolean) },
      }),
    };
  });
}

/**
 * A page renderer captures a document only once all of it has drawn: when
 * the code a block loads for itself arrives well after the document shows,
 * as on a slow link, the print page still says it is ready only once that
 * block has drawn, and nothing is loading.
 */
export async function checkRenderReady(
  page: Page,
  documents: { name: LazyBlock; id: string }[],
) {
  for (const { name, id } of documents) {
    const tab = await page.browser().newPage();
    await tab.bringToFront();
    let shown = false;
    await tab.exposeFunction("documentShown", () => {
      shown = true;
    });
    await tab.evaluateOnNewDocument(() => {
      const watch = new MutationObserver(() => {
        if (!document.querySelector("[id^='lexical-content-']")) return;
        watch.disconnect();
        void (
          window as unknown as { documentShown: () => void }
        ).documentShown();
      });
      watch.observe(document, { childList: true, subtree: true });
    });
    await tab.setRequestInterception(true);
    tab.on("request", (request) => {
      if (shown && request.url().includes("/_next/static/chunks/"))
        setTimeout(() => void request.continue(), LATE_MS);
      else void request.continue();
    });
    try {
      // A PDF is printed, and the print page lays out only for print.
      await tab.emulateMediaType("print");
      await tab.goto(`${appUrl}/documents/${id}/print`, {
        waitUntil: "domcontentloaded",
      });
      await tab.waitForFunction(() => window.__readyForPdf__ === true, {
        timeout: 60_000,
        polling: 50,
      });
      const drawn = await tab.evaluate(
        (selector) =>
          [
            ...(document
              .querySelector(".document-content")
              ?.querySelectorAll(selector) ?? []),
          ].map((element) =>
            element instanceof HTMLImageElement
              ? element.complete && element.naturalWidth > 0
              : true,
          ),
        LAZY[name].drawn,
      );
      assert.ok(
        drawn.length > 0 && drawn.every(Boolean),
        `a print waits for its ${name} to draw: ${JSON.stringify(drawn)}`,
      );
      assert.equal(
        await tab.evaluate(
          () => document.querySelectorAll("[aria-busy='true']").length,
        ),
        0,
        `nothing is loading once the ${name}'s print is ready`,
      );
    } finally {
      await tab.close();
    }
  }
  await page.bringToFront();
  console.log(
    "Render ready: a print waits for late code, equations, diagrams, charts and drawings to draw",
  );
}

declare global {
  interface Window {
    __readyForPdf__?: boolean;
  }
}
