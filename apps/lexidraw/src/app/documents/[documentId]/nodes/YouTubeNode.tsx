import {
  $getFigure,
  YouTubeNode as HeadlessYouTubeNode,
} from "@packages/lexical-nodes";
import type { EditorConfig, LexicalEditor } from "lexical";
import * as React from "react";
import { Suspense } from "react";
import { BlockLoading, storedSize } from "./common/BlockLoading";
import { FigureFrame } from "./common/Figure";

export type { SerializedYouTubeNode } from "@packages/lexical-nodes";

const YouTubeComponent = React.lazy(() => import("./YouTubeComponent"));

/** React half of the package's YouTubeNode; see ImageNode. */
export class YouTubeNode extends HeadlessYouTubeNode {
  static getType = HeadlessYouTubeNode.getType;
  static clone = HeadlessYouTubeNode.clone;
  static importJSON = HeadlessYouTubeNode.importJSON;

  decorate(_editor: LexicalEditor, config: EditorConfig): React.JSX.Element {
    const embedBlockTheme = config.theme.embedBlock || {};
    const className = {
      base: embedBlockTheme.base || "",
      focus: embedBlockTheme.focus || "",
    };
    return (
      <FigureFrame nodeKey={this.getKey()} figure={$getFigure(this)}>
        <Suspense
          fallback={
            <BlockLoading size={storedSize(this.__width, this.__height)} />
          }
        >
          <YouTubeComponent
            className={className}
            format={this.__format}
            nodeKey={this.getKey()}
            videoID={this.__id}
            width={this.__width}
            height={this.__height}
          />
        </Suspense>
      </FigureFrame>
    );
  }
}
