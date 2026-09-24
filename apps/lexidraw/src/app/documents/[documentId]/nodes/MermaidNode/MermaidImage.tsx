"use client";
import mermaid from "mermaid";
import { useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";

type Dimension = number | "inherit";
interface Props {
  schema: string;
  width: Dimension;
  height: Dimension;
  className?: string;
}
type Diagram =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; src: string; print: string; width: number };
// Mermaid's configuration is global, so initialize and render each diagram together.
let renderQueue: Promise<unknown> = Promise.resolve();

export default function MermaidImage({
  schema,
  width,
  height,
  className,
}: Props) {
  const [diagram, setDiagram] = useState<Diagram>({ status: "loading" });
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const container = useRef<HTMLElement>(null);
  // The document's theme and font are DOM properties; SVG images cannot inherit them.
  useEffect(() => {
    let generation = 0;
    let urls: string[] = [];
    const render = () => {
      const current = ++generation;
      const host = container.current;
      if (!host) return;
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
      const colours = {
        primaryColor: token("--surface-1"),
        primaryTextColor: token("--foreground"),
        primaryBorderColor: token("--border"),
        lineColor: token("--muted-foreground"),
        secondaryColor: token("--surface-2"),
        tertiaryColor: token("--background"),
      };
      const draw = async (print: boolean) => {
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            darkMode: !print && dark,
            fontFamily: font,
            fontSize: "14px",
            ...(print
              ? {
                  primaryColor: token("--diagram-paper-surface"),
                  primaryTextColor: token("--diagram-paper-foreground"),
                  primaryBorderColor: token("--diagram-paper-border"),
                  lineColor: token("--diagram-paper-muted"),
                  secondaryColor: token("--diagram-paper-surface"),
                  tertiaryColor: token("--diagram-paper-background"),
                }
              : colours),
          },
          themeCSS:
            ".node rect, .node polygon, .node circle { filter: none !important; }",
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
          width: box[2],
        };
      };
      renderQueue = renderQueue
        .catch(() => {})
        .then(async () => {
          if (current !== generation) return;
          try {
            const screen = await draw(false);
            const paper = await draw(true);
            if (current !== generation) return;
            const next = [screen, paper].map(({ svg }) =>
              URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })),
            );
            urls.forEach(URL.revokeObjectURL);
            urls = next;
            const [src, print] = next;
            if (src && print)
              setDiagram({ status: "ready", src, print, width: screen.width });
          } catch {
            if (current === generation) setDiagram({ status: "error" });
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
    return () => {
      generation++;
      observer.disconnect();
      urls.forEach(URL.revokeObjectURL);
    };
  }, [schema]);

  return (
    <section
      ref={container}
      className="document-mermaid"
      aria-label="Mermaid diagram"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users scroll wide diagrams in this region
      tabIndex={0}
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
                width: typeof width === "number" ? width : diagram.width,
                minWidth: diagram.width * 0.8,
                height: "auto",
                maxWidth: "100%",
                maxHeight: typeof height === "number" ? height : undefined,
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                setIsLightboxOpen(true);
              }}
            />
          </picture>
          <Dialog open={isLightboxOpen} onOpenChange={setIsLightboxOpen}>
            <DialogContent className="w-auto h-auto max-w-none bg-transparent border-none shadow-none p-0">
              <DialogTitle className="sr-only">Mermaid Lightbox</DialogTitle>
              <img
                src={diagram.src}
                alt="Mermaid diagram"
                className="max-w-[95vw] max-h-[95vh] object-contain"
              />
            </DialogContent>
          </Dialog>
        </>
      ) : (
        <div
          aria-busy={diagram.status === "loading"}
          className="bg-muted/20 text-muted-foreground text-xs p-2 rounded"
        >
          {diagram.status === "loading"
            ? "Rendering diagram…"
            : "Failed to render diagram"}
        </div>
      )}
    </section>
  );
}
