"use client";

import { exportToSvg } from "@excalidraw/excalidraw";
import type { AppState, BinaryFiles } from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  NonDeleted,
} from "@excalidraw/excalidraw/element/types";
import { type JSX, useEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";

type ImageType = "svg" | "canvas";

type Props = {
  /**
   * Configures the export setting for SVG/Canvas
   */
  appState: AppState;
  /**
   * The css class applied to image to be rendered
   */
  className?: string;
  /**
   * The Excalidraw elements to be rendered as an image
   */
  elements: NonDeleted<ExcalidrawElement>[];
  /**
   * The Excalidraw elements to be rendered as an image
   */
  files: BinaryFiles;
  /**
   * The height of the image to be rendered
   */
  height?: number | null;
  /**
   * The ref object to be used to render the image
   */
  imageContainerRef: { current: null | HTMLDivElement };
  /**
   * The type of image to be rendered
   */
  imageType?: ImageType;
  /**
   * The css class applied to the root element of this component
   */
  rootClassName?: string | null;
  /**
   * The width of the image to be rendered
   */
  width?: number | null;
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
  rootClassName = null,
}: Props): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const setContent = async () => {
      const svg: SVGElement = await exportToSvg({
        data: {
          appState,
          elements,
          files,
        },
      });

      svg.setAttribute("width", "100%");
      svg.setAttribute("height", "100%");
      svg.setAttribute("display", "block");

      const url = URL.createObjectURL(
        new Blob([svg.outerHTML], { type: "image/svg+xml" }),
      );
      console.log("url", url);
      setUrl(url);

      const image = new Image();
      image.src = url;
      image.alt = "Excalidraw";
      image.style.width = "100%";
      image.style.height = "100%";
      image.style.objectFit = "contain";
      imageRef.current = image;
      console.log("imageRef.current", imageRef.current);
    };

    setContent();
  }, [elements, files, appState]);

  return (
    <div className={`relative inline-block cursor-move`} draggable={true}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url ?? ""}
        alt="Excalidraw"
        style={{
          width: "200px",
          height: "200px",
          objectFit: "contain",
        }}
        draggable={true}
        className={cn("rounded-xs", rootClassName)}
        ref={imageContainerRef as React.RefObject<HTMLImageElement>}
      />
    </div>
  );
}
