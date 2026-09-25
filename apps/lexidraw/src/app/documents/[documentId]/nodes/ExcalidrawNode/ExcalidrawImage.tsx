"use client";

import { exportToSvg } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  NonDeleted,
} from "@excalidraw/excalidraw/element/types";
import { type JSX, type RefObject, useEffect, useState } from "react";
import { cn } from "~/lib/utils";
import { Dialog, DialogContent, DialogTitle } from "~/components/ui/dialog";
import { Theme } from "@packages/types/enums";

type ImageType = "svg" | "canvas";

type Props = {
  /* Configures the export setting for SVG/Canvas */
  appState: AppState;
  /* The css class applied to image to be rendered */
  className?: string;
  /* The Excalidraw elements to be rendered as an image */
  elements: NonDeleted<ExcalidrawElement>[];
  /* The Excalidraw files to be rendered as an image */
  files: BinaryFiles;
  /* The ref object to be used to render the image */
  imageContainerRef: { current: null | HTMLDivElement };
  /* The type of image to be rendered */
  imageType?: ImageType;
  /* The width of the image to be rendered */
  rootClassName?: string | null;
  /* The width of the image to be rendered */
  width?: number | null | "inherit";
  /* The height of the image to be rendered */
  height?: number | null | "inherit";
  children?: React.ReactNode;
};

/**
 * @explorer-desc
 * A component for rendering Excalidraw elements as a static image
 */
export default function ExcalidrawImage({
  elements,
  files,
  imageContainerRef,
  appState,
  width,
  height,
  rootClassName = null,
  children,
}: Props): JSX.Element {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [naturalWidth, setNaturalWidth] = useState<number>();
  const [isLightboxOpen, setIsLightboxOpen] = useState(false);

  // Excalidraw owns the SVG export; release its browser URL on replacement.
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | undefined;
    const setContent = async () => {
      const svg = await exportToSvg({
        elements,
        appState: {
          ...appState,
          theme: Theme.LIGHT,
          exportWithDarkMode: false,
          exportBackground: false,
        },
        files,
        config: {
          padding: 10,
          renderEmbeddables: true,
        },
      });

      const svgString = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([svgString], { type: "image/svg+xml" });

      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    };

    setContent();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [elements, appState, files]);

  return (
    <div
      className="relative inline-block max-w-full"
      aria-busy={url === undefined}
    >
      <img
        src={url}
        onLoad={(event) => setNaturalWidth(event.currentTarget.naturalWidth)}
        alt="Excalidraw"
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
          objectFit: "contain",
        }}
        className={cn("document-diagram excalidraw-embed", rootClassName)}
        ref={imageContainerRef as RefObject<HTMLImageElement>}
        onDoubleClick={(e) => {
          e.stopPropagation();
          setIsLightboxOpen(!!e.currentTarget);
        }}
      />
      {children}

      <Dialog open={isLightboxOpen} onOpenChange={setIsLightboxOpen}>
        <DialogContent size="full" className="flex items-center justify-center">
          <DialogTitle className="sr-only">Excalidraw Lightbox</DialogTitle>
          <img
            src={url}
            alt="Excalidraw"
            className="max-h-full max-w-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
