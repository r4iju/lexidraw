"use client";
import mermaid from "mermaid";
import { RefObject, useEffect, useState } from "react";
import { cn } from "~/lib/utils";

type Dimension = number | "inherit";

interface Props {
  schema: string;
  width: Dimension;
  height: Dimension;
  /** this ref is passed straight to ImageResizer */
  containerRef: RefObject<HTMLDivElement>;
  className?: string;
}

export default function MermaidImage({
  schema,
  width,
  height,
  containerRef,
  className,
}: Props) {
  const [src, setSrc] = useState<string | null>(null);

  /* ─── render Mermaid → SVG ─── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        mermaid.initialize({ startOnLoad: false });
        const { svg } = await mermaid.render(
          "m" + Math.random().toString(36).slice(2),
          schema,
        );
        if (cancelled) return;
        setSrc(
          "data:image/svg+xml;base64," +
            btoa(unescape(encodeURIComponent(svg))),
        );
      } catch {
        if (!cancelled) setSrc(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schema]);

  if (!src) {
    return (
      <div className="inline-block bg-muted/20 text-muted-foreground text-xs p-2 rounded">
        failed to render diagram
      </div>
    );
  }

  /* eslint-disable @next/next/no-img-element */
  return (
    <div
      ref={containerRef}
      className={cn("relative inline-block", className)}
      style={{
        width: width === "inherit" ? "auto" : `${width}px`,
        height: height === "inherit" ? "auto" : `${height}px`,
      }}
    >
      <img
        src={src}
        alt="Mermaid diagram"
        className="w-full h-full object-contain select-none"
        draggable={false}
      />
    </div>
  );
}
