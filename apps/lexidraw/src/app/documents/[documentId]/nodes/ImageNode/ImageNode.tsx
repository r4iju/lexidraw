import {
  $getFigure,
  $getNaturalSize,
  ImageNode as HeadlessImageNode,
} from "@packages/lexical-nodes";
import * as React from "react";
import { Suspense } from "react";
import { ImageLoading } from "./image-box";

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
  $config() {
    return this.config("image", { extends: HeadlessImageNode });
  }

  decorate(): React.JSX.Element {
    const figureWidth = $getFigure(this).width;
    const natural = $getNaturalSize(this);
    return (
      <Suspense
        fallback={
          <div className="relative inline-block document-figure">
            <ImageLoading
              altText={this.__altText}
              natural={natural}
              width={this.__width}
              height={this.__height}
              fill={figureWidth !== undefined}
            />
          </div>
        }
      >
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
          figureWidth={figureWidth}
          natural={natural}
          resizable={true}
        />
      </Suspense>
    );
  }
}
