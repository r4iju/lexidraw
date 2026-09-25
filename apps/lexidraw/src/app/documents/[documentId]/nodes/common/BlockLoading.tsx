import type { NaturalSize } from "@packages/lexical-nodes";
import type * as React from "react";
import { cn } from "~/lib/utils";

/** What a block of unknown size reserves: the shape of a screen, full width. */
export const WIDESCREEN: NaturalSize = { width: 1600, height: 900 };

/**
 * Stands in for a block while it loads, in the box it will fill: a canvas
 * takes its size and ratio from its attributes at once, as an image does
 * from its pixels once they arrive, so the page lays out the same around
 * either (a canvas nobody draws on holds no pixels). Marked busy, so a print
 * or screenshot waits for the block instead of capturing the gap it leaves.
 */
export function BlockLoading({
  size = WIDESCREEN,
  className,
  ...props
}: { size?: NaturalSize } & React.ComponentProps<"canvas">) {
  return (
    <canvas
      aria-busy="true"
      width={Math.round(size.width)}
      height={Math.round(size.height)}
      className={cn(
        "mx-auto block h-auto max-w-full animate-skeleton rounded-md bg-foreground/6",
        className,
      )}
      {...props}
    />
  );
}
