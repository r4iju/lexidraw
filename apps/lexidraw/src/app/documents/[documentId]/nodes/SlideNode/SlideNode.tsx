import React, { Suspense, createContext, useContext } from "react";
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
import { SlideComponent } from "./SlideComponent";

/*************************************************************************************************
 * 1. SlideElement & SlideContainerNode                                                           *
 *************************************************************************************************/
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

export type SerializedSlideContainerNode = Spread<
  {
    elements: SlideElementSpec[];
  },
  SerializedLexicalNode
>;

export class SlideContainerNode extends DecoratorNode<JSX.Element> {
  /** Absolute‑positioned slide elements (text boxes, images, etc.) */
  __elements: SlideElementSpec[];

  static getType(): string {
    return "slide-container";
  }

  static clone(node: SlideContainerNode): SlideContainerNode {
    return new SlideContainerNode(node.__elements, node.__key);
  }

  constructor(elements: SlideElementSpec[] = [], key?: NodeKey) {
    super(key);
    this.__elements = elements;
  }

  /** ---------------- Serialization -------------- */
  exportJSON(): SerializedSlideContainerNode {
    return {
      type: "slide-container",
      version: 1,
      elements: this.__elements,
    };
  }

  static importJSON(json: SerializedSlideContainerNode): SlideContainerNode {
    return new SlideContainerNode(json.elements);
  }

  /** ---------------- DOM stub + decorate -------------- */
  createDOM(_config: EditorConfig): HTMLElement {
    const div = document.createElement("section");
    // Apply Tailwind classes as suggested
    div.className =
      "relative w-[1280px] h-[720px] bg-background shadow border border-border rounded-lg overflow-hidden";
    return div;
  }

  updateDOM(): false {
    return false; // DOM handled by React component
  }

  decorate(editor: LexicalEditor): JSX.Element {
    return (
      <Suspense fallback={null}>
        <SlideComponent nodeKey={this.__key} editor={editor} />
      </Suspense>
    );
  }

  /** -------------- Mutating API -------------- */
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

  static $create(): SlideContainerNode {
    return new SlideContainerNode();
  }

  static $isSlideContainerNode(
    node: LexicalNode | null | undefined,
  ): node is SlideContainerNode {
    return node instanceof SlideContainerNode;
  }
}

/*************************************************************************************************
 * 2. Parent‑editor context (used by nested editors)                                              *
 *************************************************************************************************/
const SlideParentEditorContext = createContext<{
  editor: LexicalEditor;
} | null>(null);

export const SlideParentEditorProvider: React.FC<{
  children: React.ReactNode;
  editor: LexicalEditor;
}> = ({ children, editor }) => (
  <SlideParentEditorContext.Provider value={{ editor }}>
    {children}
  </SlideParentEditorContext.Provider>
);

export function useSlideParentEditor() {
  const ctx = useContext(SlideParentEditorContext);
  if (!ctx)
    throw new Error(
      "useSlideParentEditor must be used within a SlideParentEditorProvider",
    );
  return ctx.editor;
}

/*************************************************************************************************
 * 3. Active‑slide context (deck navigation)                                                      *
 *************************************************************************************************/
export const ActiveSlideContext = createContext<{
  activeKey: NodeKey | null;
  setActiveKey: (k: NodeKey | null) => void;
  slideKeys: NodeKey[];
  deckEditor: LexicalEditor | null;
} | null>(null);

export function useActiveSlideKey() {
  const ctx = useContext(ActiveSlideContext);
  if (!ctx)
    throw new Error(
      "useActiveSlideKey must be used within a ActiveSlideContext.Provider",
    );
  return ctx;
}
