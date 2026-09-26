import {
  DecoratorBlockNode,
  type SerializedDecoratorBlockNode,
} from "@lexical/react/LexicalDecoratorBlockNode";
import type { ArticleNodeData } from "@packages/types";
import {
  $create,
  type DOMExportOutput,
  type ElementFormatType,
  enumValue,
  type Klass,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  nullable,
  numberValue,
  optional,
  type Spread,
  stringValue,
  unionValue,
  withField,
} from "lexical";
import { openObjectValue } from "../schema-values.js";

export type SerializedArticleNode = Spread<
  {
    data: ArticleNodeData;
  },
  SerializedDecoratorBlockNode
>;

const optionalText = () => optional(nullable(stringValue()));

/** What an entity's snapshot keeps of a distilled page. */
const articleSnapshotFields = {
  title: stringValue(),
  byline: optionalText(),
  siteName: optionalText(),
  wordCount: optional(nullable(numberValue())),
  updatedAt: optional(stringValue()),
  contentHtml: stringValue(),
  bestImageUrl: optionalText(),
};

const DEFAULT_DATA: ArticleNodeData = {
  mode: "url",
  url: "",
  distilled: { title: "", contentHtml: "" },
};

const articleSchema = nodeSchema<ArticleNode>()({
  data: withField(
    unionValue(
      [
        openObjectValue({
          mode: enumValue(["url"]),
          url: stringValue(),
          distilled: openObjectValue({
            ...articleSnapshotFields,
            excerpt: optionalText(),
            datePublished: optionalText(),
          }),
        }),
        openObjectValue({
          mode: enumValue(["entity"]),
          entityId: stringValue(),
          snapshot: optional(openObjectValue(articleSnapshotFields)),
        }),
      ],
      DEFAULT_DATA,
    ),
    { field: "__data" },
  ),
});

/**
 * Serialization half of the article block; see ImageNode for the split.
 */
export class ArticleNode extends DecoratorBlockNode {
  __data: ArticleNodeData;

  $config() {
    return this.config("article", {
      extends: DecoratorBlockNode,
      json: articleSchema,
    });
  }

  constructor(
    data: ArticleNodeData = DEFAULT_DATA,
    format?: ElementFormatType,
    key?: NodeKey,
  ) {
    super(format, key);
    this.__data = data;
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
