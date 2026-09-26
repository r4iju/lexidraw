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
  objectValue,
  optional,
  type Spread,
  stringValue,
  unionValue,
  withField,
} from "lexical";
import {
  emptyOrStored,
  type SchemaJSON,
  shapedAs,
  storedValue,
} from "../schema-values.js";
import {
  type ImportJSON,
  storedFields,
  withStoredJSON,
  written,
} from "../stored-fields.js";

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

/** What an article made without data holds. */
const DEFAULT_DATA: ArticleNodeData = {
  mode: "url",
  url: "",
  distilled: { title: "", contentHtml: "" },
};

/** An article's data, as `ArticleNodeData` describes it. */
const articleDataShape = unionValue([
  objectValue({
    mode: enumValue(["url"]),
    url: stringValue(),
    distilled: objectValue({
      ...articleSnapshotFields,
      excerpt: optionalText(),
      datePublished: optionalText(),
    }),
  }),
  objectValue({
    mode: enumValue(["entity"]),
    entityId: stringValue(),
    snapshot: optional(objectValue(articleSnapshotFields)),
  }),
]);

const { fields: articleFields, json: articleJSON } = storedFields({
  format: withField(emptyOrStored<ElementFormatType>(), { field: "__format" }),
  type: written,
  version: written,
  data: withField(shapedAs(articleDataShape, storedValue<ArticleNodeData>()), {
    field: "__data",
  }),
});

export type SerializedArticleNode = Spread<
  SchemaJSON<typeof articleJSON>,
  SerializedDecoratorBlockNode
>;

const articleSchema = nodeSchema<ArticleNode>()(articleFields);

/**
 * Serialization half of the article block; see ImageNode for the split.
 */
export class ArticleNode extends DecoratorBlockNode {
  declare static importJSON: ImportJSON<ArticleNode>;
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

withStoredJSON(ArticleNode);
