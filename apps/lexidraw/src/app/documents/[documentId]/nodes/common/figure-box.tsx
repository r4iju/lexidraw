import type { NaturalSize } from "@packages/lexical-nodes";
import type * as React from "react";
import { BlockLoading } from "./BlockLoading";

export type Dimension = number | "inherit";

/** Where a drawn figure goes: the size it was given, and the one it was last drawn at. */
export type FigureBox = {
  width: Dimension;
  height: Dimension;
  natural: NaturalSize | undefined;
};

/** The frame a drawing or a diagram sits in. */
export const FIGURE_FRAME = "group/node relative inline-block max-w-full";

/**
 * Where a drawing sits: the width it was given, or a quarter wider than it
 * exports at, and never past the column; its shape is known before its
 * picture decodes.
 */
export function drawingStyle({
  width,
  height,
  natural,
}: FigureBox): React.CSSProperties {
  return {
    width:
      typeof width === "number"
        ? width
        : natural
          ? natural.width * 1.25
          : undefined,
    height: "auto",
    aspectRatio: natural && `auto ${natural.width} / ${natural.height}`,
    maxWidth: "100%",
    maxHeight: typeof height === "number" ? height : undefined,
    objectFit: "contain",
  };
}

/**
 * Where a diagram sits: the width it was given or drawn at, never below four
 * fifths of it (a smaller one scrolls instead), and never past the column;
 * its shape is known before its picture decodes.
 */
export function diagramStyle({
  width,
  height,
  natural,
}: FigureBox): React.CSSProperties {
  return {
    width: typeof width === "number" ? width : natural?.width,
    minWidth: natural && natural.width * 0.8,
    height: "auto",
    aspectRatio: natural && `auto ${natural.width} / ${natural.height}`,
    maxWidth: "100%",
    maxHeight: typeof height === "number" ? height : undefined,
  };
}

/**
 * A figure while it is drawn, in the box it will fill: the size it was
 * drawn at last time, or 16:9 before then.
 */
export function FigureLoading({
  place,
  ...box
}: FigureBox & { place: (box: FigureBox) => React.CSSProperties }) {
  return <BlockLoading size={box.natural} style={place(box)} />;
}
