import type {
  EditorConfig,
  Klass,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from "lexical";
import { $create, DecoratorNode } from "lexical";

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

/**
 * Serialization half of the mermaid block; see ImageNode for the split.
 */
export class MermaidNode extends DecoratorNode<unknown> {
  __schema: string;
  __width: number | "inherit";
  __height: number | "inherit";

  static getType(): string {
    return "mermaid";
  }

  static clone(node: MermaidNode): MermaidNode {
    return new this(node.__schema, node.__width, node.__height, node.__key);
  }

  constructor(
    schema = "graph TD;\n  A[Start] --> B>Stop]",
    width: number | "inherit" = "inherit",
    height: number | "inherit" = "inherit",
    key?: NodeKey,
  ) {
    super(key);
    this.__schema = schema;
    // Older documents stored an unset dimension as 0.
    this.__width = width === 0 ? "inherit" : width;
    this.__height = height === 0 ? "inherit" : height;
  }

  getSchema(): string {
    return this.__schema;
  }

  setSchema(s: string): void {
    this.getWritable().__schema = s;
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

  exportJSON(): SerializedMermaidNode {
    return {
      type: "mermaid",
      version: 1,
      schema: this.__schema,
      width: this.__width,
      height: this.__height,
    };
  }

  static importJSON(node: SerializedMermaidNode): MermaidNode {
    return MermaidNode.$createMermaidNode(node.schema, node.width, node.height);
  }

  isInline(): false {
    return false;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const element = document.createElement("div");
    element.dataset.mediaType = "mermaid";
    return element;
  }

  updateDOM(): false {
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
