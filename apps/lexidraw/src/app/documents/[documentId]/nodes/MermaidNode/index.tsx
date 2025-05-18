import type {
  EditorConfig,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from "lexical";
import { DecoratorNode, $applyNodeReplacement } from "lexical";

import type { JSX } from "react";
import React, { Suspense } from "react";

const MermaidComponent = React.lazy(() => import("./MermaidComponent"));

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

export class MermaidNode extends DecoratorNode<JSX.Element> {
  // ────────────────────────────────────────────────────────────
  // fields
  // ────────────────────────────────────────────────────────────
  __schema: string;
  __width: number | "inherit";
  __height: number | "inherit";

  // ────────────────────────────────────────────────────────────
  // boilerplate
  // ────────────────────────────────────────────────────────────
  static getType() {
    return "mermaid";
  }

  static clone(node: MermaidNode) {
    return new MermaidNode(
      node.__schema,
      node.__width,
      node.__height,
      node.__key,
    );
  }

  // ────────────────────────────────────────────────────────────
  // ctor
  // ────────────────────────────────────────────────────────────
  constructor(
    schema = "graph TD;\n  A[Start] --> B>Stop]",
    width: number | "inherit" = "inherit",
    height: number | "inherit" = "inherit",
    key?: NodeKey,
  ) {
    super(key);
    this.__schema = schema;
    this.__width = width;
    this.__height = height;
  }

  // ────────────────────────────────────────────────────────────
  // getters / setters
  // ────────────────────────────────────────────────────────────
  getSchema() {
    return this.__schema;
  }
  setSchema(s: string) {
    this.getWritable().__schema = s;
  }

  getWidth() {
    return this.__width;
  }
  getHeight() {
    return this.__height;
  }
  setWidthAndHeight({
    width,
    height,
  }: {
    width: number | "inherit";
    height: number | "inherit";
  }) {
    const writable = this.getWritable();
    writable.__width = width;
    writable.__height = height;
  }

  // ────────────────────────────────────────────────────────────
  // serialisation
  // ────────────────────────────────────────────────────────────
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
    return $applyNodeReplacement(
      new MermaidNode(node.schema, node.width, node.height),
    );
  }

  /** Create the outer “placeholder” element that will hold the React
   *  portal.  We mirror what `ExcalidrawNode` does so resizing logic
   *  continues to work unchanged. */
  createDOM(config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    const klass = config.theme.image; // same class as images

    span.style.display = "inline-block";
    span.style.width =
      this.__width === "inherit" ? "inherit" : `${this.__width}px`;
    span.style.height =
      this.__height === "inherit" ? "inherit" : `${this.__height}px`;

    if (klass) span.className = klass;
    return span;
  }

  /** Called when the node’s writable copy changed.  We update the size
   *  and return false so Lexical keeps using the existing DOM element. */
  updateDOM(prev: MermaidNode, dom: HTMLElement): boolean {
    if (prev.__width !== this.__width) {
      dom.style.width =
        this.__width === "inherit" ? "inherit" : `${this.__width}px`;
    }
    if (prev.__height !== this.__height) {
      dom.style.height =
        this.__height === "inherit" ? "inherit" : `${this.__height}px`;
    }
    return false; // we didn’t replace the element
  }

  // ────────────────────────────────────────────────────────────
  // React render
  // ────────────────────────────────────────────────────────────
  decorate(): JSX.Element {
    return (
      <Suspense fallback={null}>
        <MermaidComponent
          nodeKey={this.getKey()}
          schema={this.__schema}
          width={this.__width}
          height={this.__height}
        />
      </Suspense>
    );
  }

  static $createMermaidNode(
    schema?: string,
    w?: number | "inherit",
    h?: number | "inherit",
  ) {
    return new MermaidNode(schema, w, h);
  }

  static $isMermaidNode(node: LexicalNode | null): node is MermaidNode {
    return node instanceof MermaidNode;
  }
}
