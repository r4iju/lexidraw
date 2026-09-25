import type { NaturalSize } from "@packages/lexical-nodes";
import type * as React from "react";
import { BlockLoading } from "../common/BlockLoading";

export type ImageBox = {
  width: "inherit" | number;
  height: "inherit" | number;
  /** Placed at a figure width, the image fills it whatever size it was dragged to. */
  fill: boolean;
};

/** Where an image sits, whether its pixels have arrived or not. */
export function imageBoxStyle({
  width,
  height,
  fill,
}: ImageBox): React.CSSProperties {
  return {
    width: fill ? "100%" : undefined,
    maxWidth:
      typeof width === "number" && !fill ? `min(100%, ${width}px)` : "100%",
    maxHeight:
      typeof height === "number" && !fill
        ? `min(80vh, ${height}px)`
        : undefined,
  };
}

/**
 * An image while it loads, in the box it will fill: sized from the pixels it
 * had the first time it was drawn, or 16:9 before then.
 */
export function ImageLoading({
  altText,
  natural,
  ...box
}: ImageBox & { altText: string; natural: NaturalSize | undefined }) {
  return (
    <BlockLoading
      role="img"
      aria-label={altText}
      size={natural}
      className="document-image"
      style={imageBoxStyle(box)}
    />
  );
}
