import { ArticleNode as HeadlessArticleNode } from "@packages/lexical-nodes";
import type { EditorConfig, LexicalEditor } from "lexical";
import * as React from "react";
import { Suspense } from "react";
import { BlockLoading } from "../common/BlockLoading";

export type { SerializedArticleNode } from "@packages/lexical-nodes";

const ArticleBlock = React.lazy(() =>
  import("./ArticleBlock").then((mod) => ({ default: mod.ArticleBlock })),
);

/** React half of the package's ArticleNode; see ImageNode. */
export class ArticleNode extends HeadlessArticleNode {
  static getType = HeadlessArticleNode.getType;
  static clone = HeadlessArticleNode.clone;
  static importJSON = HeadlessArticleNode.importJSON;

  decorate(_editor: LexicalEditor, config: EditorConfig): React.JSX.Element {
    const embedBlockTheme = config.theme.embedBlock || {};
    const className = {
      base: embedBlockTheme.base || "",
      focus: embedBlockTheme.focus || "",
    };
    return (
      <Suspense fallback={<BlockLoading />}>
        <ArticleBlock
          className={className}
          nodeKey={this.getKey()}
          data={this.__data}
        />
      </Suspense>
    );
  }
}
