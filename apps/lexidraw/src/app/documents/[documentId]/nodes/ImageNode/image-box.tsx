import type { NaturalSize } from "@packages/lexical-nodes";
import type * as React from "react";
import { BlockLoading } from "../common/BlockLoading";

export type ImageBox = {
  width: "inherit" | number;
  height: "inherit" | number;
  /** Placed at a figure width, the image fills it whatever size it was dragged to. */
  fill: boolean;
};

/**
 * Where an image sits, whether its pixels have arrived or not: no wider than
 * it was given, in the shape it was given, so that the document's height cap
 * for an image placed at no width still applies.
 */
export function imageBoxStyle({
  width,
  height,
  fill,
}: ImageBox): React.CSSProperties {
  if (fill) return { width: "100%", maxWidth: "100%" };
  return {
    maxWidth: typeof width === "number" ? `min(100%, ${width}px)` : "100%",
    aspectRatio:
      typeof width === "number" && typeof height === "number"
        ? `${width} / ${height}`
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
