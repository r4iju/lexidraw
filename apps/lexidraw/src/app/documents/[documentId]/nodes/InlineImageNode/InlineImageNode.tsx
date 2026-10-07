import {
  InlineImageNode as HeadlessInlineImageNode,
  parseNaturalSize,
  type Position,
} from "@packages/lexical-nodes";
import * as React from "react";
import { Suspense } from "react";
import { cn } from "~/lib/utils";
import { BlockLoading } from "../common/BlockLoading";

export type {
  InlineImagePayload,
  Position,
  SerializedInlineImageNode,
  UpdateInlineImagePayload,
} from "@packages/lexical-nodes";

/**
 * Where an inline image sits in its paragraph. Left and right float at most
 * half the column wide with the text wrapping beside them, and the paragraph
 * grows to hold them so the next block starts below; full is a block the
 * column's width. Unplaced, it sits on the line with its caption below it.
 */
export function inlineImagePlacement(position: Position) {
  return cn(
    "group/node",
    position === "left" && "float-left mr-4 mb-2 flex max-w-1/2 flex-col",
    position === "right" && "float-right ml-4 mb-2 flex max-w-1/2 flex-col",
    (position === "left" || position === "right") && "[p:has(&)]:flow-root",
    position === "full" && "my-2 flex w-full flex-col",
    position === undefined && "inline-flex max-w-full flex-col align-baseline",
  );
}

const InlineImageComponent = React.lazy(() => import("./InlineImageComponent"));

/** React half of the package's InlineImageNode; see ImageNode. */
export class InlineImageNode extends HeadlessInlineImageNode {
  $config() {
    return this.config("inline-image", { extends: HeadlessInlineImageNode });
  }

  decorate(): React.JSX.Element {
    const size = parseNaturalSize({
      width: this.__width,
      height: this.__height,
    });
    return (
      <Suspense
        fallback={
          size ? (
            <div
              data-position={this.__position}
              className={inlineImagePlacement(this.__position)}
            >
              <BlockLoading
                size={size}
                className="m-0 group-data-[position=full]/node:w-full"
                style={{ width: size.width }}
              />
            </div>
          ) : (
            <span aria-busy="true" />
          )
        }
      >
        <InlineImageComponent
          src={this.__src}
          altText={this.__altText}
          width={this.__width}
          height={this.__height}
          nodeKey={this.getKey()}
          showCaption={this.__showCaption}
          caption={this.__caption}
          position={this.__position}
          captionsEnabled={this.__captionsEnabled}
        />
      </Suspense>
    );
  }
}
