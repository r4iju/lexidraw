import {
  $getFigure,
  VideoNode as HeadlessVideoNode,
} from "@packages/lexical-nodes";
import type { EditorConfig, LexicalEditor } from "lexical";
import * as React from "react";
import { Suspense } from "react";
import { BlockLoading, storedSize } from "../common/BlockLoading";

export type {
  SerializedVideoNode,
  VideoPayload,
} from "@packages/lexical-nodes";

const VideoComponent = React.lazy(() => import("./VideoComponent"));

/** React half of the package's VideoNode; see ImageNode. */
export class VideoNode extends HeadlessVideoNode {
  static getType = HeadlessVideoNode.getType;
  static clone = HeadlessVideoNode.clone;
  static importJSON = HeadlessVideoNode.importJSON;

  decorate(_editor: LexicalEditor, _config: EditorConfig): React.JSX.Element {
    return (
      <Suspense
        fallback={
          <BlockLoading size={storedSize(this.__width, this.__height)} />
        }
      >
        <VideoComponent
          src={this.__src}
          nodeKey={this.getKey()}
          width={this.__width}
          height={this.__height}
          resizable={true} // Assuming always resizable for now
          caption={this.__caption}
          showCaption={this.__showCaption}
          captionsEnabled={this.__captionsEnabled}
          figureWidth={$getFigure(this).width}
        />
      </Suspense>
    );
  }
}
