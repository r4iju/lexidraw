import {
  $getFigure,
  TweetNode as HeadlessTweetNode,
} from "@packages/lexical-nodes";
import type { EditorConfig, LexicalEditor } from "lexical";
import * as React from "react";
import { Suspense } from "react";
import { BlockLoading } from "./common/BlockLoading";
import { FigureFrame } from "./common/Figure";

export type { SerializedTweetNode } from "@packages/lexical-nodes";

const TweetComponent = React.lazy(() => import("./TweetComponent"));

/** React half of the package's TweetNode; see ImageNode. */
export class TweetNode extends HeadlessTweetNode {
  static getType = HeadlessTweetNode.getType;
  static clone = HeadlessTweetNode.clone;
  static importJSON = HeadlessTweetNode.importJSON;

  decorate(_editor: LexicalEditor, config: EditorConfig): React.JSX.Element {
    const embedBlockTheme = config.theme.embedBlock || {};
    const className = {
      base: embedBlockTheme.base || "",
      focus: embedBlockTheme.focus || "",
    };
    return (
      <FigureFrame nodeKey={this.getKey()} figure={$getFigure(this)}>
        <Suspense fallback={<BlockLoading />}>
          <TweetComponent
            className={className}
            format={this.__format}
            loadingComponent="Loading..."
            nodeKey={this.getKey()}
            tweetID={this.__id}
          />
        </Suspense>
      </FigureFrame>
    );
  }
}
