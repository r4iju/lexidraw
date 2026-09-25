import type { NaturalSize } from "@packages/lexical-nodes";
import type * as React from "react";
import { BlockLoading } from "../common/BlockLoading";

type Dimension = number | "inherit";
export type DrawingBox = {
  width: Dimension;
  height: Dimension;
  natural: NaturalSize | undefined;
};

/**
 * Where a drawing sits: the width it was given, or a quarter wider than it
 * exports at, and never past the column.
 */
export function drawingStyle({
  width,
  height,
  natural,
}: DrawingBox): React.CSSProperties {
  return {
    width:
      typeof width === "number"
        ? width
        : natural
          ? natural.width * 1.25
          : undefined,
    height: "auto",
    maxWidth: "100%",
    maxHeight: typeof height === "number" ? height : undefined,
    objectFit: "contain",
  };
}

/** The frame a drawing is shown in. */
export const DRAWING_FRAME = "group/node relative inline-block max-w-full";

/**
 * A drawing while it is exported, in the box it will fill: the size it was
 * exported at last time, or 16:9 before then.
 */
export function DrawingLoading(box: DrawingBox) {
  return <BlockLoading size={box.natural} style={drawingStyle(box)} />;
}
