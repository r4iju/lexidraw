import React, { Suspense } from "react";
import type { JSX } from "react";
import {
  DecoratorNode,
  EditorConfig,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
} from "lexical";
import { SlideComponent } from "./SlideComponent"; // Adjust path as necessary

export type SlideElementSpec =
  | {
      kind: "text";
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      editorStateJSON: string | null;
    }
  | {
      kind: "image";
      id: string;
      src: string;
      x: number;
      y: number;
      width: number;
      height: number;
    };

export type SerializedSlidePageNode = Spread<
  { elements: SlideElementSpec[] },
  SerializedLexicalNode
>;

export class SlidePageNode extends DecoratorNode<JSX.Element> {
  __elements: SlideElementSpec[];

  static getType(): string {
    return "slide-page";
  }

  static clone(node: SlidePageNode): SlidePageNode {
    return new SlidePageNode(node.__elements, node.__key);
  }

  constructor(elements: SlideElementSpec[] = [], key?: NodeKey) {
    super(key);
    this.__elements = elements;
  }

  exportJSON(): SerializedSlidePageNode {
    return {
      elements: this.__elements,
      type: SlidePageNode.getType(),
      version: 1,
    };
  }

  static importJSON(json: SerializedSlidePageNode): SlidePageNode {
    return new SlidePageNode(json.elements);
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement("section");
    div.className = "slide-page-lexical-node";
    return div;
  }

  updateDOM(): false {
    return false;
  }

  decorate(editor: LexicalEditor): JSX.Element {
    return (
      <Suspense fallback={null}>
        {/* SelectionProvider is removed */}
        <SlideComponent nodeKey={this.__key} editor={editor} />
      </Suspense>
    );
  }

  addElement(element: SlideElementSpec): void {
    const self = this.getWritable();
    self.__elements = [...self.__elements, element];
  }

  updateElement(id: string, partial: Partial<SlideElementSpec>): void {
    const self = this.getWritable();
    self.__elements = self.__elements.map((el) =>
      el.id === id ? ({ ...el, ...partial } as SlideElementSpec) : el,
    );
  }

  removeElement(id: string): void {
    const self = this.getWritable();
    self.__elements = self.__elements.filter((el) => el.id !== id);
  }

  static $create(): SlidePageNode {
    return new SlidePageNode();
  }

  static $isSlidePageNode(
    // Ensure method name is consistent
    node: LexicalNode | null | undefined,
  ): node is SlidePageNode {
    return node instanceof SlidePageNode;
  }
}
