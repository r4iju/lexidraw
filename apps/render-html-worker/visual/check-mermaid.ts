import assert from "node:assert/strict";
import { resolve } from "node:path";
import type { Page } from "puppeteer";
import { signInToDev } from "@packages/dev-stack";
import { appUrl } from "./app-url";

/** One diagram of each kind the editor offers, in document order. */
export const MERMAID_CASES = {
  flowchart:
    "flowchart TD\n A[Start] --> B{Decide}\n B -->|yes| C[Do]\n B -->|no| D[Skip]\n C --> E((End))\n D --> E",
  sequence:
    "sequenceDiagram\n participant U as User\n participant A as App\n U->>A: Open doc\n A-->>U: Render",
  class:
    "classDiagram\n class Node { +key: string\n +getType() }\n Node <|-- ElementNode\n Node <|-- TextNode",
  state:
    "stateDiagram-v2\n [*] --> Closed\n Closed --> Open: click\n Open --> Closed: click",
  er: "erDiagram\n USER ||--o{ ENTITY : owns\n ENTITY ||--o{ SHARE : has",
  gantt:
    "gantt\n title Release\n dateFormat YYYY-MM-DD\n section Design\n Spec :done, a1, 2026-09-01, 10d\n Review :crit, active, a2, after a1, 5d\n section Build\n Web :active, b1, after a2, 20d\n iOS :b2, after a2, 25d",
  pie: 'pie title Seven\n "A" : 30\n "B" : 20\n "C" : 15\n "D" : 12\n "E" : 10\n "F" : 8\n "G" : 5',
  mindmap:
    "mindmap\n root((Editor))\n  Blocks\n   Toggle\n   Callout\n  Media\n   Image\n  Data\n   Chart",
  invalid: "flowchart LR\n A -->",
} as const;

/** The document's children: each case, alone in a paragraph-separated row. */
export function mermaidBlocks() {
  return Object.values(MERMAID_CASES).flatMap((schema) => [
    {
      type: "mermaid",
      version: 1,
      schema,
      width: "inherit",
      height: "inherit",
    },
    {
      type: "paragraph",
      version: 1,
      children: [],
      direction: null,
      format: "",
      indent: 0,
    },
  ]);
}

type Drawn = {
  page: string;
  /** Mermaid diagrams drawn on the page itself rather than in a block's picture. */
  leaked: number;
  invalid: string;
  pie: {
    slices: string[];
    swatches: string[];
    labels: string[];
    /** The legend's names that lie past the block's visible edge. */
    hiddenNames: string[];
  };
  gantt: {
    bars: string[];
    inside: string[];
    outside: string[];
    /** Each axis label's left and right edge, in drawing units. */
    ticks: [number, number][];
  };
  mindmap: { nodes: string[]; labels: string[] };
  /** Each block that scrolls sideways, and the mask that fades its cut edge. */
  scrolls: { name: string; mask: string }[];
  ganttScrolls: boolean;
};

/**
 * Every diagram kind reads with distinct colours in both themes, at a
 * phone's and a desktop's width; a gantt fits the desktop column and keeps
 * its axis legible on a phone; a block that scrolls shows that it does; and
 * an invalid diagram shows Mermaid's message in its block, leaving nothing
 * on the page.
 */
export async function checkMermaid(
  page: Page,
  documentId: string,
  output: string,
) {
  await signInToDev(page, appUrl);
  for (const width of [375, 1280]) {
    for (const theme of ["light", "dark"] as const) {
      await page.setViewport({ width, height: 900 });
      await page.evaluate(
        (theme) => localStorage.setItem("theme", theme),
        theme,
      );
      await page.goto(`${appUrl}/documents/${documentId}`, {
        waitUntil: "networkidle2",
      });
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll(
            ".document-mermaid:not(:has([aria-busy='true']))",
          ).length === count,
        { timeout: 60_000 },
        Object.keys(MERMAID_CASES).length,
      );
      const where = `${width}px ${theme}`;
      const drawn: Drawn = await page.evaluate(async (names) => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) throw new Error("Canvas is unavailable");
        // Any CSS colour, as the opaque sRGB it paints over the page.
        const paint = (colour: string, opacity = 1) => {
          context.clearRect(0, 0, 1, 1);
          context.globalAlpha = 1;
          context.fillStyle = getComputedStyle(document.body).getPropertyValue(
            "--background",
          );
          context.fillRect(0, 0, 1, 1);
          context.globalAlpha = opacity;
          context.fillStyle = colour;
          context.fillRect(0, 0, 1, 1);
          const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
          return `rgb(${r}, ${g}, ${b})`;
        };
        const leaked = document.querySelectorAll(
          "svg[aria-roledescription]",
        ).length;
        const sections = [
          ...document.querySelectorAll<HTMLElement>(".document-mermaid"),
        ];
        const section = (name: string) => {
          const found = sections[names.indexOf(name)];
          if (!found) throw new Error(`No ${name} block`);
          return found;
        };
        const drawn = async (name: string) => {
          const img = section(name).querySelector("img");
          if (!img) throw new Error(`The ${name} diagram did not draw`);
          const host = document.createElement("div");
          host.style.cssText = "position:absolute;left:-10000px;top:0";
          host.innerHTML = await (await fetch(img.src)).text();
          document.body.append(host);
          return host;
        };
        const fills = (host: Element, selector: string) =>
          [...host.querySelectorAll(selector)].map((element) => {
            const style = getComputedStyle(element);
            return paint(
              style.fill,
              Number(style.opacity) * Number(style.fillOpacity),
            );
          });
        // Labels are SVG text, or HTML in a foreignObject.
        const inks = (host: Element, selector: string) =>
          [...host.querySelectorAll(selector)].map((element) => {
            const style = getComputedStyle(element);
            return paint(
              element instanceof SVGElement ? style.fill : style.color,
            );
          });
        const pie = await drawn("pie");
        const gantt = await drawn("gantt");
        const mindmap = await drawn("mindmap");
        const result = {
          page: paint(
            getComputedStyle(document.body).getPropertyValue("--background"),
          ),
          leaked,
          invalid: section("invalid").textContent ?? "",
          pie: {
            slices: fills(pie, ".pieCircle"),
            swatches: fills(pie, ".legend rect"),
            labels: fills(pie, "text.slice"),
            hiddenNames: (() => {
              const block = section("pie");
              const shown = block.querySelector("img")?.getBoundingClientRect();
              const drawing = pie.querySelector("svg")?.getBoundingClientRect();
              if (!shown || !drawing) throw new Error("The pie did not draw");
              const scale = shown.width / drawing.width;
              const edge =
                block.getBoundingClientRect().left + block.clientWidth + 1;
              return [...pie.querySelectorAll(".legend text")]
                .filter(
                  (name) =>
                    shown.left +
                      (name.getBoundingClientRect().right - drawing.left) *
                        scale >
                    edge,
                )
                .map((name) => name.textContent ?? "");
            })(),
          },
          gantt: {
            bars: fills(
              gantt,
              "rect[class*='task'], rect[class*='active'], rect[class*='done'], rect[class*='crit']",
            ),
            inside: fills(
              gantt,
              "text[class*='taskText']:not([class*='Outside'])",
            ),
            outside: fills(gantt, "text[class*='taskTextOutside']"),
            ticks: [
              ...gantt.querySelectorAll<SVGGraphicsElement>(".grid .tick text"),
            ].map((text) => {
              const box = text.getBBox();
              const at = text.parentElement?.getAttribute("transform") ?? "";
              const x = Number(/translate\(\s*([-\d.]+)/.exec(at)?.[1]);
              return [x + box.x, x + box.x + box.width] as [number, number];
            }),
          },
          mindmap: {
            nodes: fills(
              mindmap,
              ".mindmap-node > :is(rect, path, circle, polygon)",
            ),
            labels: inks(mindmap, ".mindmap-node :is(text, .nodeLabel)"),
          },
          scrolls: sections
            .filter((block) => block.scrollWidth > block.clientWidth + 1)
            .map((block) => ({
              name: names[sections.indexOf(block)] ?? "",
              mask: getComputedStyle(block).maskImage,
            })),
          ganttScrolls:
            section("gantt").scrollWidth > section("gantt").clientWidth + 1,
        };
        for (const host of [pie, gantt, mindmap]) host.remove();
        return result;
      }, Object.keys(MERMAID_CASES));

      assert.equal(
        drawn.leaked,
        0,
        `${where}: no diagram is drawn outside its block`,
      );
      assert.match(
        drawn.invalid,
        /Parse error on line/,
        `${where}: the invalid diagram's block shows Mermaid's message`,
      );

      const { pie, gantt, mindmap } = drawn;
      assert.equal(
        new Set(pie.slices).size,
        pie.slices.length,
        `${where}: every pie slice has its own colour (${pie.slices.join(", ")})`,
      );
      readsOn(where, "pie slice", pie.slices, pie.labels, drawn.page);
      assert.deepEqual(
        pie.hiddenNames,
        [],
        `${where}: every name in the pie's legend is in view`,
      );
      assert.deepEqual(
        [...pie.swatches].sort(),
        [...pie.slices].sort(),
        `${where}: the pie legend's swatches are its slices' colours`,
      );

      // The fixture has a done, an active and a plain task (and an active critical one).
      assert(
        new Set(gantt.bars).size >= 3,
        `${where}: gantt bars of each kind have their own colour (${gantt.bars.join(", ")})`,
      );
      readsOn(where, "gantt bar", gantt.bars, gantt.inside, drawn.page);
      for (const label of gantt.outside)
        assert(
          contrast(label, drawn.page) >= 4.5,
          `${where}: gantt label ${label} beside its bar reads on the page`,
        );
      const ticks = [...gantt.ticks].sort((a, b) => a[0] - b[0]);
      ticks.slice(1).forEach(([left], i) => {
        const before = ticks[i]?.[1] ?? 0;
        assert(
          left > before,
          `${where}: gantt axis labels do not overlap (${before} > ${left})`,
        );
      });
      if (width >= 1280)
        assert(!drawn.ganttScrolls, `${where}: the gantt fits its column`);

      assert(
        new Set(mindmap.nodes).size >= 4,
        `${where}: the mindmap's root and branches have their own colours (${mindmap.nodes.join(", ")})`,
      );
      readsOn(where, "mindmap node", mindmap.nodes, mindmap.labels, drawn.page);

      for (const { name, mask } of drawn.scrolls)
        assert.notEqual(
          mask,
          "none",
          `${where}: the ${name} block shows that it scrolls`,
        );

      await page.screenshot({
        path: resolve(output, `mermaid-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
  await checkNativeRender(page, output);
}

/**
 * iOS shows a diagram as the picture the render worker takes of
 * /native-render, which cannot scroll: every kind fits a phone's column
 * there, whole and unfaded, and an invalid one shows Mermaid's message.
 */
async function checkNativeRender(page: Page, output: string) {
  for (const theme of ["light", "dark"] as const) {
    for (const [name, schema] of Object.entries(MERMAID_CASES)) {
      const where = `native ${theme} ${name}`;
      await page.goto(`${appUrl}/native-render`, { waitUntil: "networkidle2" });
      await page.waitForFunction(
        () => typeof window.renderNativeEmbed === "function",
        {
          timeout: 30_000,
        },
      );
      await page.evaluate((request) => window.renderNativeEmbed?.(request), {
        node: { type: "mermaid", schema, width: "inherit", height: "inherit" },
        theme,
        width: 343,
        fontFamily: "system-ui, sans-serif",
        fontSize: 17,
      });
      await page.waitForFunction(
        () =>
          window.nativeEmbedReady?.() === true &&
          document.querySelector(
            "#native-embed .document-mermaid :is(img, pre)",
          ),
        { timeout: 30_000 },
      );
      const embed = await page.evaluate(() => {
        const block = document.querySelector<HTMLElement>(
          "#native-embed .document-mermaid",
        );
        if (!block) throw new Error("No diagram block");
        return {
          fits: block.scrollWidth <= block.clientWidth + 1,
          mask: getComputedStyle(block).maskImage,
          text: block.textContent ?? "",
        };
      });
      assert(embed.fits, `${where}: the diagram fits the embed's width`);
      assert.equal(
        embed.mask,
        "none",
        `${where}: the picture has no faded edge`,
      );
      if (name === "invalid")
        assert.match(
          embed.text,
          /Parse error on line/,
          `${where}: shows Mermaid's message`,
        );
      await (await page.$("#native-embed"))?.screenshot({
        path: resolve(output, `mermaid-native-${theme}-${name}.png`),
      });
    }
  }
}

/** Each fill stands out from the page, and every label reads on every fill. */
function readsOn(
  where: string,
  what: string,
  fills: string[],
  labels: string[],
  page: string,
) {
  assert(fills.length > 0, `${where}: the ${what}s were drawn`);
  for (const fill of fills) {
    assert(
      contrast(fill, page) >= 1.5,
      `${where}: ${what} ${fill} stands out from the page ${page}`,
    );
    for (const label of labels)
      assert(
        contrast(label, fill) >= 4.5,
        `${where}: label ${label} reads on ${what} ${fill}`,
      );
  }
}

/** WCAG contrast between two `rgb()` colours. */
function contrast(a: string, b: string) {
  const luminance = (colour: string) => {
    const [r = 0, g = 0, b = 0] = (colour.match(/\d+/g) ?? []).map((value) => {
      const channel = Number(value) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

declare global {
  interface Window {
    renderNativeEmbed?: (input: unknown) => void;
    nativeEmbedReady?: () => boolean;
  }
}
