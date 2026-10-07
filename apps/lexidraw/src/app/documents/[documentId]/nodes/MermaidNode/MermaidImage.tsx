"use client";
import mermaid from "mermaid";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import type { NaturalSize } from "@packages/lexical-nodes";
import {
  type Dimension,
  diagramStyle,
  FigureLoading,
} from "../common/figure-box";
import { DIAGRAM_TEXT, leastScale } from "./diagram-scale";
import { ganttWidth } from "./gantt-width";
import { useHiddenEdges } from "./use-hidden-edges";
import {
  type DiagramTokens,
  mermaidThemeCSS,
  mermaidThemeVariables,
} from "./mermaid-theme";

const CHART_TOKENS = [
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
];

interface Props {
  schema: string;
  width: Dimension;
  height: Dimension;
  /** The size it was drawn at last time, which it keeps while it redraws. */
  natural: NaturalSize | undefined;
  onMeasured?: (size: NaturalSize) => void;
  /**
   * What a diagram wider than its block does: shrink as far as its text
   * stays legible and scroll past that, or shrink to fit, as a picture
   * taken of it must (iOS shows the render worker's picture, which cannot
   * scroll).
   */
  overflow?: "scroll" | "shrink";
  className?: string;
}
type Diagram =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      src: string;
      print: string;
      size: NaturalSize;
      /** Mermaid's name for the kind of diagram, e.g. "pie". */
      kind: string;
    };
// Mermaid's configuration is global, so initialize and render each diagram together.
let renderQueue: Promise<unknown> = Promise.resolve();
/** Mermaid's room beside a gantt's timeline, for its section names. */
const GANTT_SIDES = 75 + 75;

/**
 * The block a diagram sits in: its frame shrinks to the picture, so the
 * column is the first ancestor laid out as a block.
 */
function columnOf(host: HTMLElement) {
  let element = host.parentElement;
  while (element && getComputedStyle(element).display.startsWith("inline"))
    element = element.parentElement;
  return element ?? undefined;
}
function contentWidth(element: HTMLElement) {
  const style = getComputedStyle(element);
  return (
    element.clientWidth -
    Number.parseFloat(style.paddingLeft) -
    Number.parseFloat(style.paddingRight)
  );
}

export default function MermaidImage({
  schema,
  width,
  height,
  natural,
  onMeasured,
  overflow = "shrink",
  className,
}: Props) {
  const [diagram, setDiagram] = useState<Diagram>({ status: "loading" });
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const container = useRef<HTMLElement>(null);
  const hidden = useHiddenEdges(container);
  const measured = useEffectEvent((size: NaturalSize) => onMeasured?.(size));
  // The document's theme and font are DOM properties; SVG images cannot inherit them.
  useEffect(() => {
    let generation = 0;
    let urls: string[] = [];
    // The column a gantt was laid out for; only a gantt follows its column.
    let ganttColumn: number | undefined;
    const render = () => {
      const current = ++generation;
      const host = container.current;
      if (!host) return;
      const columnElement = columnOf(host);
      const column = columnElement && Math.round(contentWidth(columnElement));
      // Mermaid lays a gantt out at the width it is given, or else at the
      // width of <body>, where it draws.
      const layoutWidth =
        column && typeof width === "number" ? Math.min(width, column) : column;
      const documentRoot =
        host.closest<HTMLElement>(".document-content") ?? host;
      const font = getComputedStyle(documentRoot).fontFamily;
      const dark = document.documentElement.classList.contains("dark");
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d");
      const token = (name: string) => {
        if (!context) throw new Error("Canvas is unavailable");
        context.fillStyle = getComputedStyle(host)
          .getPropertyValue(name)
          .trim();
        context.fillRect(0, 0, 1, 1);
        return `#${[...context.getImageData(0, 0, 1, 1).data]
          .slice(0, 3)
          .map((value) => value.toString(16).padStart(2, "0"))
          .join("")}`;
      };
      const screen: DiagramTokens = {
        page: token("--background"),
        surface: token("--surface-1"),
        secondarySurface: token("--surface-2"),
        foreground: token("--foreground"),
        border: token("--border"),
        muted: token("--muted-foreground"),
        destructive: token("--destructive"),
        chart: CHART_TOKENS.map(token),
      };
      // Paper keeps the screen's chart hues; the theme sets their lightness.
      const paper: DiagramTokens = {
        ...screen,
        page: token("--diagram-paper-background"),
        surface: token("--diagram-paper-surface"),
        secondarySurface: token("--diagram-paper-surface"),
        foreground: token("--diagram-paper-foreground"),
        border: token("--diagram-paper-border"),
        muted: token("--diagram-paper-muted"),
      };
      const draw = async (print: boolean, useWidth: number | undefined) => {
        const tokens = print ? paper : screen;
        mermaid.initialize({
          gantt: { useWidth: useWidth || undefined },
          startOnLoad: false,
          // Mermaid would otherwise leave its error graphic on <body>.
          suppressErrorRendering: true,
          theme: "base",
          themeVariables: {
            ...mermaidThemeVariables(tokens, { dark: !print && dark }),
            fontFamily: font,
            fontSize: `${DIAGRAM_TEXT}px`,
          },
          themeCSS: mermaidThemeCSS(tokens),
        });
        const { svg } = await mermaid.render(
          `m${Math.random().toString(36).slice(2)}`,
          schema,
        );
        const xml = new DOMParser().parseFromString(svg, "image/svg+xml");
        const element = xml.documentElement;
        const box = element
          .getAttribute("viewBox")
          ?.trim()
          .split(/\s+/)
          .map(Number);
        if (!box?.[2] || !box[3]) throw new Error("Diagram has no dimensions");
        element.setAttribute("width", String(box[2]));
        element.setAttribute("height", String(box[3]));
        return {
          svg: new XMLSerializer().serializeToString(element),
          size: { width: box[2], height: box[3] },
          kind: element.getAttribute("aria-roledescription") ?? "",
          element,
        };
      };
      const labelWidth = (label: string) => {
        if (!context) throw new Error("Canvas is unavailable");
        // Mermaid sets its axis labels at 10px.
        context.font = `10px ${font}`;
        return context.measureText(label).width;
      };
      renderQueue = renderQueue
        .catch(() => {})
        .then(async () => {
          if (current !== generation) return;
          try {
            let screen = await draw(false, layoutWidth);
            let drawnWidth = layoutWidth;
            if (screen.kind === "gantt" && layoutWidth) {
              const needed = ganttWidth(
                screen.element,
                layoutWidth,
                GANTT_SIDES,
                labelWidth,
              );
              if (needed > layoutWidth) {
                drawnWidth = needed;
                screen = await draw(false, needed);
              }
            }
            const paper = await draw(true, drawnWidth);
            if (current !== generation) return;
            ganttColumn = screen.kind === "gantt" ? column : undefined;
            const next = [screen, paper].map(({ svg }) =>
              URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
            );
            urls.forEach(URL.revokeObjectURL);
            urls = next;
            const [src, print] = next;
            if (src && print) {
              setDiagram({
                status: "ready",
                src,
                print,
                size: screen.size,
                kind: screen.kind,
              });
              measured(screen.size);
            }
          } catch (error) {
            if (current === generation)
              setDiagram({
                status: "error",
                message: error instanceof Error ? error.message : String(error),
              });
          }
        });
    };
    render();
    const observer = new MutationObserver(render);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    const root = container.current?.closest(".document-content");
    if (root)
      observer.observe(root, { attributes: true, attributeFilter: ["style"] });
    // A gantt is laid out for its column's width, so it redraws when that changes.
    const columnElement = container.current && columnOf(container.current);
    const resized = new ResizeObserver(() => {
      if (
        columnElement &&
        ganttColumn !== undefined &&
        Math.round(contentWidth(columnElement)) !== ganttColumn
      )
        render();
    });
    if (columnElement) resized.observe(columnElement);
    return () => {
      generation++;
      observer.disconnect();
      resized.disconnect();
      urls.forEach(URL.revokeObjectURL);
    };
  }, [schema, width]);

  return (
    <section
      ref={container}
      className={cn(
        "document-mermaid",
        // A diagram wider than its block scrolls; the cut edge fades out.
        "not-print:data-[hidden=start]:[mask-image:linear-gradient(to_right,transparent,#000_2.5rem)]",
        "not-print:data-[hidden=end]:[mask-image:linear-gradient(to_left,transparent,#000_2.5rem)]",
        "not-print:data-[hidden=both]:[mask-image:linear-gradient(to_right,transparent,#000_2.5rem,#000_calc(100%-2.5rem),transparent)]",
      )}
      data-hidden={overflow === "scroll" ? hidden : undefined}
      aria-label="Mermaid diagram"
      tabIndex={overflow === "scroll" ? 0 : undefined}
    >
      {diagram.status === "ready" ? (
        <>
          <picture>
            <source media="print" srcSet={diagram.print} />
            <img
              src={diagram.src}
              alt="Mermaid diagram"
              data-mermaid
              draggable={false}
              className={cn(
                "select-none object-contain block document-diagram",
                className,
              )}
              style={{
                ...diagramStyle({ width, height, natural: diagram.size }),
                minWidth:
                  overflow === "shrink"
                    ? 0
                    : diagram.size.width * leastScale(diagram.kind),
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                setIsLightboxOpen(true);
              }}
            />
          </picture>
          <Dialog open={isLightboxOpen} onOpenChange={setIsLightboxOpen}>
            <DialogContent
              size="full"
              className="flex items-center justify-center"
            >
              <DialogTitle className="sr-only">Mermaid Lightbox</DialogTitle>
              <img
                src={diagram.src}
                alt="Mermaid diagram"
                className="max-h-full max-w-full object-contain"
              />
            </DialogContent>
          </Dialog>
        </>
      ) : diagram.status === "loading" ? (
        <FigureLoading
          place={diagramStyle}
          width={width}
          height={height}
          natural={natural}
        />
      ) : (
        // As wide as the column: an inline-block frame sizes to its content.
        <div className="w-screen max-w-full rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-left">
          <p className="font-medium text-destructive text-sm">
            Could not draw this diagram
          </p>
          <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-muted-foreground text-xs">
            {diagram.message}
          </pre>
        </div>
      )}
    </section>
  );
}
