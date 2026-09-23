import {
  DecoratorBlockNode,
  type SerializedDecoratorBlockNode,
} from "@lexical/react/LexicalDecoratorBlockNode";
import type { ArticleNodeData } from "@packages/types";
import type {
  DOMExportOutput,
  ElementFormatType,
  Klass,
  LexicalNode,
  NodeKey,
  Spread,
} from "lexical";
import { $create } from "lexical";

export type SerializedArticleNode = Spread<
  {
    data: ArticleNodeData;
  },
  SerializedDecoratorBlockNode
>;

/**
 * Serialization half of the article block; see ImageNode for the split.
 */
export class ArticleNode extends DecoratorBlockNode {
  __data: ArticleNodeData;

  static getType(): string {
    return "article";
  }

  static clone(node: ArticleNode): ArticleNode {
    return new this(node.__data, node.__format, node.__key);
  }

  constructor(
    data: ArticleNodeData = {
      mode: "url",
      url: "",
      distilled: { title: "", contentHtml: "" },
    },
    format?: ElementFormatType,
    key?: NodeKey,
  ) {
    super(format, key);
    this.__data = data;
  }

  static importJSON(serializedNode: SerializedArticleNode): ArticleNode {
    const node = ArticleNode.$createArticleNode(serializedNode.data);
    node.setFormat(serializedNode.format || "");
    return node;
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
    element.setAttribute("data-lexical-article", "1");
    const mode = this.__data.mode;
    element.setAttribute("data-article-mode", mode);
    return { element };
  }

  static $createArticleNode<T extends ArticleNode>(
    this: Klass<T>,
    data: ArticleNodeData,
  ): T {
    const node = $create(this);
    node.__data = data;
    return node;
  }

  static $isArticleNode<T extends ArticleNode>(
    this: Klass<T>,
    node: ArticleNode | LexicalNode | null | undefined,
  ): node is T {
    return node instanceof ArticleNode;
  }

  getData(): ArticleNodeData {
    return this.__data;
  }

  setData(next: ArticleNodeData): void {
    const w = this.getWritable();
    w.__data = next;
  }
}
