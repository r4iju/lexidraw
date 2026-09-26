import { ArticleNode as HeadlessArticleNode } from "@packages/lexical-nodes";
import type { EditorConfig, LexicalEditor } from "lexical";
import type * as React from "react";
import { ArticleBlock } from "./ArticleBlock";

export type { SerializedArticleNode } from "@packages/lexical-nodes";

/** React half of the package's ArticleNode; see ImageNode. */
export class ArticleNode extends HeadlessArticleNode {
  $config() {
    return this.config("article", { extends: HeadlessArticleNode });
  }

  decorate(_editor: LexicalEditor, config: EditorConfig): React.JSX.Element {
    const embedBlockTheme = config.theme.embedBlock || {};
    const className = {
      base: embedBlockTheme.base || "",
      focus: embedBlockTheme.focus || "",
    };
    return (
      <ArticleBlock
        className={className}
        nodeKey={this.getKey()}
        data={this.__data}
      />
    );
  }
}
