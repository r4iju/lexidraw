"use client";
import mermaid from "mermaid";
import { useEffect, useState } from "react";
import { cn } from "~/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";

type Dimension = number | "inherit";

interface Props {
  schema: string;
  width: Dimension;
  height: Dimension;
  className?: string;
}

export default function MermaidImage({
  schema,
  width,
  height,
  className,
}: Props) {
  /** The rendered diagram's URL; undefined while rendering, null if it failed. */
  const [src, setSrc] = useState<string | null | undefined>(undefined);
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const [naturalWidth, setNaturalWidth] = useState<number>();

  // Mermaid owns SVG rendering; release its browser URL on replacement.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    setSrc(undefined);
    (async () => {
      try {
        mermaid.initialize({ startOnLoad: false, theme: "default" });

        const { svg } = await mermaid.render(
          `m${Math.random().toString(36).slice(2)}`,
          schema,
        );

        const document = new DOMParser().parseFromString(svg, "image/svg+xml");
        const element = document.documentElement;
        const viewBox = element
          .getAttribute("viewBox")
          ?.trim()
          .split(/\s+/)
          .map(Number);
        if (viewBox?.length !== 4 || !viewBox[2] || !viewBox[3])
          throw new Error("Diagram has no dimensions");
        element.setAttribute("width", String(viewBox[2]));
        element.setAttribute("height", String(viewBox[3]));
        const fixedSvg = new XMLSerializer().serializeToString(element);

        if (cancelled) return;
        const url = URL.createObjectURL(
          new Blob([fixedSvg], { type: "image/svg+xml" }),
        );

        objectUrl = url;
        setSrc(url);
      } catch {
        if (!cancelled) setSrc(null);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [schema]);

  if (src === undefined) {
    return (
      <div
        aria-busy="true"
        className="inline-block bg-muted/20 text-muted-foreground text-xs p-2 rounded"
      >
        rendering diagram…
      </div>
    );
  }

  if (src === null) {
    return (
      <div className="inline-block bg-muted/20 text-muted-foreground text-xs p-2 rounded">
        failed to render diagram
      </div>
    );
  }

  return (
    <>
      <img
        src={src}
        alt="Mermaid diagram"
        onLoad={(event) => setNaturalWidth(event.currentTarget.naturalWidth)}
        draggable={false}
        className={cn(
          "select-none object-contain block document-diagram",
          className,
        )}
        style={{
          width:
            typeof width === "number"
              ? width
              : naturalWidth
                ? naturalWidth * 1.25
                : "auto",
          height: "auto",
          maxWidth: "100%",
          maxHeight: typeof height === "number" ? height : undefined,
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setIsLightboxOpen(true);
        }}
      />
      <Dialog open={isLightboxOpen} onOpenChange={setIsLightboxOpen}>
        <DialogContent className="w-auto h-auto min-w-0 min-h-0 max-w-none! !md:max-w-none bg-transparent border-none shadow-none p-0 focus:outline-none flex justify-center items-center">
          <DialogTitle className="sr-only">Mermaid Lightbox</DialogTitle>
          <img
            src={src}
            alt="Mermaid diagram"
            className="max-w-[95vw] max-h-[95vh] object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
