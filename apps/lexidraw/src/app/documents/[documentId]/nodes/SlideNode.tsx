import React, {
  Suspense,
  useCallback,
  useEffect,
  createContext,
  useContext,
} from "react";
import type { JSX } from "react";
import {
  $getNodeByKey,
  DecoratorNode,
  EditorConfig,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  Spread,
  type EditorState,
} from "lexical";
import { LexicalComposer as NestedComposer } from "@lexical/react/LexicalComposer";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";

/*************************************************************************************************
 * 1. SlideContainerNode – represents a single slide and stores an ordered list of element specs. *
 *************************************************************************************************/

export type SlideElementSpec =
  | {
      kind: "text";
      id: string;
      x: number;
      y: number;
      width: number;
      height: number;
      // each text element gets its *own* nested Lexical state (JSON string)
      editorStateJSON: string;
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
      "SlideContainer relative w-[1280px] h-[720px] bg-white shadow border border-border rounded-lg overflow-hidden";
    return div;
  }

  updateDOM(): false {
    return false; // DOM handled by React component
  }

  decorate(editor: LexicalEditor): JSX.Element {
    return (
      <Suspense fallback={null}>
        <SlideRenderer nodeKey={this.__key} editor={editor} />
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
      el.id === id ? { ...el, ...partial } : el,
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
 * 2. <SlideRenderer /> – React component that renders a single slide at runtime.                   *
 *************************************************************************************************/

interface SlideRendererProps {
  nodeKey: NodeKey;
  editor: LexicalEditor; // This is the main editor instance
}

const SlideRenderer: React.FC<SlideRendererProps> = ({ nodeKey, editor }) => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [counter, setCounter] = React.useState(0);

  // Force re‑render when slide data changes.
  useEffect(() => {
    return editor.registerMutationListener(
      SlideContainerNode,
      (mutatedNodes) => {
        for (const [affectedNodeKey] of mutatedNodes) {
          if (affectedNodeKey === nodeKey) {
            setCounter((c) => c + 1);
            return;
          }
        }
      },
    );
  }, [editor, nodeKey]);

  const slide = editor.getEditorState().read(() => {
    const node = $getNodeByKey(nodeKey);
    return SlideContainerNode.$isSlideContainerNode(node) ? node : null;
  });

  if (!slide) return null;

  return (
    <div className="relative w-full h-full bg-background overflow-hidden">
      {slide.__elements.map((el) => {
        if (el.kind === "text") {
          return (
            <div
              key={el.id}
              style={{
                position: "absolute",
                left: el.x,
                top: el.y,
                width: el.width,
                height: el.height,
              }}
              className="outline-1 outline-transparent hover:outline-primary"
            >
              <NestedTextEditor element={el} slideNodeKey={nodeKey} />
            </div>
          );
        }
        if (el.kind === "image") {
          return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={el.id}
              src={el.src}
              style={{
                position: "absolute",
                left: el.x,
                top: el.y,
                width: el.width,
                height: el.height,
              }}
              draggable={false}
              alt="slide visual"
            />
          );
        }
        return null;
      })}
    </div>
  );
};

/*************************************************************************************************
 * 3. <NestedTextEditor /> – small Lexical instance per text box.                                  *
 *************************************************************************************************/

interface NestedTextEditorProps {
  element: Extract<SlideElementSpec, { kind: "text" }>;
  slideNodeKey: NodeKey;
}

const NestedTextEditor: React.FC<NestedTextEditorProps> = ({
  element,
  slideNodeKey,
}) => {
  const { editor: parentEditor } = useSlideParentEditor();

  const initialConfig = {
    namespace: `slide-text-${element.id}`,
    editorState: element.editorStateJSON
      ? parentEditor?.parseEditorState(element.editorStateJSON)
      : undefined,
    nodes: [], // Consider adding basic nodes like ParagraphNode, TextNode if not implicitly included
    onError(error: Error) {
      console.error("NestedTextEditor error:", error);
      // Potentially use a toast or other error reporting mechanism
      throw error;
    },
    theme: {
      // Potentially inherit or define a minimal theme
    },
  };

  /** Persist nested editor state back into the slide node. */
  const handleChange = useCallback(
    (editorState: EditorState) => {
      if (!parentEditor) {
        throw new Error("Parent editor not found");
      }
      const json = editorState.toJSON();
      parentEditor.update(() => {
        const node = $getNodeByKey(slideNodeKey);
        if (SlideContainerNode.$isSlideContainerNode(node)) {
          node.updateElement(element.id, {
            editorStateJSON: JSON.stringify(json),
          });
        }
      });
    },
    [parentEditor, element.id, slideNodeKey],
  );

  return (
    <NestedComposer initialConfig={initialConfig}>
      <RichTextPlugin
        contentEditable={
          <ContentEditable className="w-full h-full p-1 outline-none" />
        }
        placeholder={
          <div className="absolute top-1 left-1 text-muted-foreground select-none pointer-events-none">
            Enter text...
          </div>
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <OnChangePlugin onChange={handleChange} />
      <HistoryPlugin />
    </NestedComposer>
  );
};

/*************************************************************************************************
 * 4. Context + hooks to expose the parent (deck) editor to nested editors.                        *
 *************************************************************************************************/

const SlideParentEditorContext = createContext<{
  editor: LexicalEditor | null;
} | null>(null);

export const SlideParentEditorProvider: React.FC<{
  children: React.ReactNode;
  editor: LexicalEditor;
}> = ({ children, editor }) => {
  return (
    <SlideParentEditorContext.Provider value={{ editor }}>
      {children}
    </SlideParentEditorContext.Provider>
  );
};

export function useSlideParentEditor() {
  // Exported for potential use in other slide-related components
  const ctx = useContext(SlideParentEditorContext);
  if (!ctx || !ctx.editor) {
    throw new Error(
      "useSlideParentEditor must be used within a SlideParentEditorProvider",
    );
  }
  return ctx;
}

/*************************************************************************************************
 * 6. Helper for unique IDs. (Section 5 is for the plugin)                                       *
 *************************************************************************************************/

export function uuid(): string {
  return Math.random().toString(36).slice(2, 10);
}
