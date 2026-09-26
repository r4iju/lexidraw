import {
  $getFigure,
  TweetNode as HeadlessTweetNode,
} from "@packages/lexical-nodes";
import type { EditorConfig, LexicalEditor } from "lexical";
import type * as React from "react";
import TweetComponent from "./TweetComponent";
import { FigureFrame } from "./common/Figure";

export type { SerializedTweetNode } from "@packages/lexical-nodes";

/** React half of the package's TweetNode; see ImageNode. */
export class TweetNode extends HeadlessTweetNode {
  $config() {
    return this.config("tweet", { extends: HeadlessTweetNode });
  }

  decorate(_editor: LexicalEditor, config: EditorConfig): React.JSX.Element {
    const embedBlockTheme = config.theme.embedBlock || {};
    const className = {
      base: embedBlockTheme.base || "",
      focus: embedBlockTheme.focus || "",
    };
    return (
      <FigureFrame nodeKey={this.getKey()} figure={$getFigure(this)}>
        <TweetComponent
          className={className}
          format={this.__format}
          loadingComponent="Loading..."
          nodeKey={this.getKey()}
          tweetID={this.__id}
        />
      </FigureFrame>
    );
  }
}
