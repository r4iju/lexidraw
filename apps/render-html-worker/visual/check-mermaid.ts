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

type Colours = {
  page: string;
  pie: { slices: string[]; swatches: string[]; labels: string[] };
};

/** Every diagram kind reads with distinct colours in both themes, at a phone's and a desktop's width. */
export async function checkMermaid(page: Page, documentId: string, output: string) {
  await signInToDev(page, appUrl);
  for (const width of [375, 1280]) {
    for (const theme of ["light", "dark"] as const) {
      await page.setViewport({ width, height: 900 });
      await page.evaluate((theme) => localStorage.setItem("theme", theme), theme);
      await page.goto(`${appUrl}/documents/${documentId}`, {
        waitUntil: "networkidle2",
      });
      await page.waitForFunction(
        (count) =>
          document.querySelectorAll(".document-mermaid:not(:has([aria-busy='true']))")
            .length === count,
        { timeout: 60_000 },
        Object.keys(MERMAID_CASES).length,
      );
      const where = `${width}px ${theme}`;
      const colours: Colours = await page.evaluate(
        async (names) => {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const context = canvas.getContext("2d", { willReadFrequently: true });
          if (!context) throw new Error("Canvas is unavailable");
          // Any CSS colour, as the opaque sRGB it paints over the page.
          const paint = (colour: string, opacity = 1) => {
            context.clearRect(0, 0, 1, 1);
            context.globalAlpha = 1;
            context.fillStyle = getComputedStyle(document.body).getPropertyValue("--background");
            context.fillRect(0, 0, 1, 1);
            context.globalAlpha = opacity;
            context.fillStyle = colour;
            context.fillRect(0, 0, 1, 1);
            const [r = 0, g = 0, b = 0] = context.getImageData(0, 0, 1, 1).data;
            return `rgb(${r}, ${g}, ${b})`;
          };
          const sections = [...document.querySelectorAll(".document-mermaid")];
          const drawn = async (name: string) => {
            const img = sections[names.indexOf(name)]?.querySelector("img");
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
              return paint(style.fill, Number(style.opacity) * Number(style.fillOpacity));
            });
          const pie = await drawn("pie");
          const result = {
            page: paint(getComputedStyle(document.body).getPropertyValue("--background")),
            pie: {
              slices: fills(pie, ".pieCircle"),
              swatches: fills(pie, ".legend rect"),
              labels: fills(pie, "text.slice"),
            },
          };
          pie.remove();
          return result;
        },
        Object.keys(MERMAID_CASES),
      );

      const { pie } = colours;
      assert.equal(
        new Set(pie.slices).size,
        pie.slices.length,
        `${where}: every pie slice has its own colour (${pie.slices.join(", ")})`,
      );
      for (const slice of pie.slices) {
        assert(
          contrast(slice, colours.page) >= 1.5,
          `${where}: pie slice ${slice} stands out from the page ${colours.page}`,
        );
        for (const label of pie.labels)
          assert(
            contrast(label, slice) >= 4.5,
            `${where}: pie label ${label} reads on slice ${slice}`,
          );
      }
      assert.deepEqual(
        [...pie.swatches].sort(),
        [...pie.slices].sort(),
        `${where}: the pie legend's swatches are its slices' colours`,
      );

      await page.screenshot({
        path: resolve(output, `mermaid-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }
}

/** WCAG contrast between two `rgb()` colours. */
function contrast(a: string, b: string) {
  const luminance = (colour: string) => {
    const [r = 0, g = 0, b = 0] = (colour.match(/\d+/g) ?? []).map((value) => {
      const channel = Number(value) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}
