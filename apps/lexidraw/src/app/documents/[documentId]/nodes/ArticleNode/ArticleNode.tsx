import type {
  DOMExportOutput,
  EditorConfig,
  ElementFormatType,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  Spread,
} from "lexical";
import {
  DecoratorBlockNode,
  type SerializedDecoratorBlockNode,
} from "@lexical/react/LexicalDecoratorBlockNode";
import type * as React from "react";
import { ArticleBlock } from "./ArticleBlock";
import type { ArticleNodeData } from "@packages/types";

export type SerializedArticleNode = Spread<
  {
    data: ArticleNodeData;
  },
  SerializedDecoratorBlockNode
>;

export class ArticleNode extends DecoratorBlockNode {
  __data: ArticleNodeData;

  static getType(): string {
    return "article";
  }

  static clone(node: ArticleNode): ArticleNode {
    return new ArticleNode(node.__data, node.__format, node.__key);
  }

  constructor(
    data: ArticleNodeData,
    format?: ElementFormatType,
    key?: NodeKey,
  ) {
    super(format, key);
    this.__data = data;
  }

  static importJSON(serializedNode: SerializedArticleNode): ArticleNode {
    const { data, format } = serializedNode as SerializedArticleNode;
    return new ArticleNode(data, format);
  }

  exportJSON(): SerializedArticleNode {
    return {
      ...super.exportJSON(),
      type: ArticleNode.getType(),
      version: 1,
      data: this.__data,
    } as SerializedArticleNode;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("div");
    element.setAttribute("data-lexical-article", "true");
    try {
      element.setAttribute("data-article", JSON.stringify(this.__data));
    } catch {
      // ignore
    }
    return { element };
  }

  static $createArticleNode(data: ArticleNodeData): ArticleNode {
    return new ArticleNode(data);
  }

  static $isArticleNode(
    node: ArticleNode | LexicalNode | null | undefined,
  ): node is ArticleNode {
    return node instanceof ArticleNode;
  }

  getData(): ArticleNodeData {
    return this.__data;
  }

  setData(next: ArticleNodeData): void {
    const w = this.getWritable();
    w.__data = next;
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
