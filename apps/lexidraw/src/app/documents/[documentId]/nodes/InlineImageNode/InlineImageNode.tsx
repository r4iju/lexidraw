import {
  InlineImageNode as HeadlessInlineImageNode,
  parseNaturalSize,
} from "@packages/lexical-nodes";
import * as React from "react";
import { Suspense } from "react";
import { BlockLoading } from "../common/BlockLoading";

export type {
  InlineImagePayload,
  Position,
  SerializedInlineImageNode,
  UpdateInlineImagePayload,
} from "@packages/lexical-nodes";

const InlineImageComponent = React.lazy(() => import("./InlineImageComponent"));

/** React half of the package's InlineImageNode; see ImageNode. */
export class InlineImageNode extends HeadlessInlineImageNode {
  static getType = HeadlessInlineImageNode.getType;
  static clone = HeadlessInlineImageNode.clone;
  static importJSON = HeadlessInlineImageNode.importJSON;

  decorate(): React.JSX.Element {
    const size = parseNaturalSize({
      width: this.__width,
      height: this.__height,
    });
    return (
      <Suspense
        fallback={
          size ? (
            <BlockLoading size={size} className="inline-block align-middle" />
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
