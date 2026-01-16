"use client";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $getNodeByKey } from "lexical";
import mermaid from "mermaid";
import { useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import { MermaidNode } from ".";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";

type Dimension = number | "inherit";

interface Props {
  schema: string;
  width: Dimension;
  height: Dimension;
  nodeKey: string;
  className?: string;
}

export default function MermaidImage({
  schema,
  width,
  height,
  nodeKey,
  className,
}: Props) {
  const [editor] = useLexicalComposerContext();
  const [src, setSrc] = useState<string>("");
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  /* ─── render Mermaid to a blob URL ─── */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        mermaid.initialize({ startOnLoad: false });

        const { svg } = await mermaid.render(
          `m${Math.random().toString(36).slice(2)}`,
          schema,
        );

        const [, w, h] = svg.match(
          /viewBox="[^"]+ (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)/,
        ) as [string, string, string];
        const fixedSvg = svg
          .replace('width="100%"', `width="${w}"`)
          .replace('height="100%"', `height="${h}"`);

        if (cancelled) return;
        const url = URL.createObjectURL(
          new Blob([fixedSvg], { type: "image/svg+xml" }),
        );

        setSrc(url);
      } catch {
        if (!cancelled) setSrc("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [schema]);

  function handleLoad() {
    if (!imgRef.current) {
      throw new Error("imgRef.current is null");
    }

    const { naturalWidth, naturalHeight } = imgRef.current;

    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (!MermaidNode.$isMermaidNode(node)) return;

      // only act while the node still says “inherit”
      if (node.getWidth() !== "inherit" && node.getHeight() !== "inherit")
        return;

      /* ── clamp ──────────────────────────────────────────────── */
      const root = editor.getRootElement();
      const maxW = (root?.clientWidth ?? 600) - 40; // fallback for SSR
      const scale = naturalWidth > maxW ? maxW / naturalWidth : 1;
      const width = Math.round(naturalWidth * scale);
      const height = Math.round(naturalHeight * scale);

      node.setWidthAndHeight({ width, height });
    });
  }

  if (!src) {
    return (
      <div className="inline-block bg-muted/20 text-muted-foreground text-xs p-2 rounded">
        failed to render diagram
      </div>
    );
  }

  return (
    <>
      <img
        ref={imgRef}
        src={src}
        alt="Mermaid diagram"
        onLoad={handleLoad}
        draggable={false}
        className={cn("select-none object-contain block", className)}
        style={{
          width: typeof width === "number" ? `${width}px` : "auto",
          height: typeof height === "number" ? `${height}px` : "auto",
          maxWidth: "100%",
          maxHeight: "100%",
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
