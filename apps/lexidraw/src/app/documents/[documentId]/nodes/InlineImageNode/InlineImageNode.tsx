import { InlineImageNode as HeadlessInlineImageNode } from "@packages/lexical-nodes";
import * as React from "react";
import { Suspense } from "react";

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
    return (
      <Suspense fallback={null}>
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
