import type { NaturalSize } from "@packages/lexical-nodes";
import type * as React from "react";
import { BlockLoading } from "../common/BlockLoading";

type Dimension = number | "inherit";
export type DiagramBox = {
  width: Dimension;
  height: Dimension;
  natural: NaturalSize | undefined;
};

/**
 * Where a diagram sits: the width it was given or drawn at, never below four
 * fifths of it (a smaller one scrolls instead), and never past the column.
 */
export function diagramStyle({
  width,
  height,
  natural,
}: DiagramBox): React.CSSProperties {
  return {
    width: typeof width === "number" ? width : natural?.width,
    minWidth: natural && natural.width * 0.8,
    height: "auto",
    maxWidth: "100%",
    maxHeight: typeof height === "number" ? height : undefined,
  };
}

/** The frame a diagram is drawn in. */
export const DIAGRAM_FRAME = "group/node relative inline-block max-w-full";

/**
 * A diagram while it is drawn, in the box it will fill: the size it was
 * drawn at last time, or 16:9 before then.
 */
export function DiagramLoading(box: DiagramBox) {
  return (
    <BlockLoading
      size={box.natural}
      className="document-diagram"
      style={diagramStyle(box)}
    />
  );
}
