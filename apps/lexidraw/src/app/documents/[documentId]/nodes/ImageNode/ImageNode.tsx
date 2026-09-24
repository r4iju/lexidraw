import {
  $getFigure,
  ImageNode as HeadlessImageNode,
} from "@packages/lexical-nodes";
import * as React from "react";
import { Suspense } from "react";
import { BlockLoading } from "../common/BlockLoading";

export type {
  ImagePayload,
  SerializedImageNode,
  UpdateImagePayload,
} from "@packages/lexical-nodes";

const ImageComponent = React.lazy(() => import("./ImageComponent"));

/**
 * Registered after the package's ImageNode so that "image" resolves to this
 * class everywhere the editor constructs one; the package class owns the
 * serialization and this one only adds the React component.
 */
export class ImageNode extends HeadlessImageNode {
  static getType = HeadlessImageNode.getType;
  static clone = HeadlessImageNode.clone;
  static importJSON = HeadlessImageNode.importJSON;

  decorate(): React.JSX.Element {
    return (
      <Suspense fallback={<BlockLoading />}>
        <ImageComponent
          src={this.__src}
          altText={this.__altText}
          width={this.__width}
          height={this.__height}
          maxWidth={this.__maxWidth}
          nodeKey={this.getKey()}
          showCaption={this.__showCaption}
          caption={this.__caption}
          captionsEnabled={this.__captionsEnabled}
          figureWidth={$getFigure(this).width}
          resizable={true}
        />
      </Suspense>
    );
  }
}
