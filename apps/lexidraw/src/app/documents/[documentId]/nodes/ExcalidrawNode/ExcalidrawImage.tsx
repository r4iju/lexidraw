"use client";

import { exportToSvg } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  NonDeleted,
} from "@excalidraw/excalidraw/element/types";
import { type JSX, type RefObject, useEffect, useState } from "react";
import { cn } from "~/lib/utils";
import { Theme } from "@packages/types/enums";
import { useIsDarkTheme } from "~/components/theme/theme-provider";

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

  const isDarkTheme = useIsDarkTheme();

  useEffect(() => {
    const setContent = async () => {
      const svg = await exportToSvg({
        elements,
        appState: {
          ...appState,
          theme: isDarkTheme ? Theme.DARK : Theme.LIGHT,
          exportWithDarkMode: isDarkTheme,
        },
        files,
        config: {
          padding: 10,
          renderEmbeddables: true,
        },
      });

      const svgString = new XMLSerializer().serializeToString(svg);
      const blob = new Blob([svgString], { type: "image/svg+xml" });

      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      svg.setAttribute("display", "block");

      const tempUrl = URL.createObjectURL(blob);
      setUrl(tempUrl);
    };

    setContent();
  }, [elements, appState, isDarkTheme, files]);

  return (
    <div className={`relative inline-block`}>
      <img
        src={url}
        alt="Excalidraw"
        style={{
          width: width === "inherit" ? "inherit" : `${width}px`,
          height: height === "inherit" ? "inherit" : `${height}px`,
          objectFit: "fill",
        }}
        className={cn("rounded-xs", rootClassName)}
        ref={imageContainerRef as RefObject<HTMLImageElement>}
      />
      {children}
    </div>
  );
}
