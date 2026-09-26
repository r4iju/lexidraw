import {
  $create,
  $setState,
  DecoratorNode,
  type EditorConfig,
  type Klass,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  type SerializedLexicalNode,
  type Spread,
  stringValue,
  withField,
} from "lexical";
import { figureDOM, figureState, naturalSizeState } from "../figure.js";
import { zeroAsInheritValue } from "../schema-values.js";

/** Stored in the editor state */
export type SerializedMermaidNode = Spread<
  {
    type: "mermaid";
    version: 1;
    schema: string;
    width?: number | "inherit";
    height?: number | "inherit";
  },
  SerializedLexicalNode
>;

/** What a new diagram, or one stored without its source, draws. */
const DEFAULT_SCHEMA = "graph TD;\n  A[Start] --> B>Stop]";

const mermaidSchema = nodeSchema<MermaidNode>()({
  schema: withField(stringValue(DEFAULT_SCHEMA), { field: "__schema" }),
  width: withField(zeroAsInheritValue, { field: "__width" }),
  height: withField(zeroAsInheritValue, { field: "__height" }),
});

/**
 * Serialization half of the mermaid block; see ImageNode for the split.
 */
export class MermaidNode extends DecoratorNode<unknown> {
  __schema: string;
  __width: number | "inherit";
  __height: number | "inherit";

  $config() {
    return this.config("mermaid", {
      extends: DecoratorNode,
      json: mermaidSchema,
      stateConfigs: [figureState, naturalSizeState],
    });
  }

  constructor(
    schema = DEFAULT_SCHEMA,
    width: number | "inherit" = "inherit",
    height: number | "inherit" = "inherit",
    key?: NodeKey,
  ) {
    super(key);
    this.__schema = schema;
    this.__width = width === 0 ? "inherit" : width;
    this.__height = height === 0 ? "inherit" : height;
  }

  getSchema(): string {
    return this.__schema;
  }

  /** A new source drops the size the old one was drawn at. */
  setSchema(s: string): void {
    if (s === this.getLatest().__schema) return;
    const writable = this.getWritable();
    writable.__schema = s;
    $setState(writable, naturalSizeState, undefined);
  }

  getWidth(): number | "inherit" {
    return this.__width;
  }

  getHeight(): number | "inherit" {
    return this.__height;
  }

  setWidthAndHeight({
    width,
    height,
  }: {
    width: number | "inherit";
    height: number | "inherit";
  }): void {
    const w = width === 0 ? "inherit" : width;
    const h = height === 0 ? "inherit" : height;
    this.getWritable().__width = w;
    this.getWritable().__height = h;
  }

  isInline(): false {
    return false;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement("div");
    element.dataset.mediaType = "mermaid";
    figureDOM(this, element);
    return element;
  }

  updateDOM(_prevNode: MermaidNode, dom: HTMLElement): false {
    figureDOM(this, dom);
    return false;
  }

  static $createMermaidNode<T extends MermaidNode>(
    this: Klass<T>,
    schema?: string,
    w?: number | "inherit",
    h?: number | "inherit",
  ): T {
    const node = $create(this);
    if (schema !== undefined) {
      node.__schema = schema;
    }
    if (w !== undefined) {
      node.__width = w === 0 ? "inherit" : w;
    }
    if (h !== undefined) {
      node.__height = h === 0 ? "inherit" : h;
    }
    return node;
  }

  static $isMermaidNode<T extends MermaidNode>(
    this: Klass<T>,
    node: LexicalNode | null | undefined,
  ): node is T {
    return node instanceof MermaidNode;
  }
}
