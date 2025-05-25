import {
  DecoratorNode,
  Spread,
  LexicalNode,
  $createParagraphNode,
  ParagraphNode,
  EditorConfig,
  NodeKey,
  LexicalEditor,
  SerializedLexicalNode,
  $getNodeByKey,
} from "lexical";
import React, {
  type JSX,
  Suspense,
  useState,
  useCallback,
  useEffect,
} from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import SlideView from "./SlideView";
import { SlideModal } from "./SlideModal";

export interface SlideElementSpec {
  kind: "box";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  editorStateJSON: string | null;
}

export interface SlideData {
  id: string;
  elements: SlideElementSpec[];
}

export interface SlideDeckData {
  slides: SlideData[];
  currentSlideId: string | null;
}

export const DEFAULT_BOX_EDITOR_STATE_STRING = JSON.stringify({
  root: {
    children: [
      {
        children: [],
        direction: null,
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
    ],
    direction: null,
    format: "",
    indent: 0,
    type: "root",
    version: 1,
  },
});

export const DEFAULT_SLIDE_DECK_DATA: SlideDeckData = {
  slides: [
    {
      id: "default-slide-1",
      elements: [
        {
          kind: "box",
          id: `box-${Date.now()}`,
          x: 50,
          y: 50,
          width: 300,
          height: 150,
          editorStateJSON: DEFAULT_BOX_EDITOR_STATE_STRING,
        },
      ],
    },
  ],
  currentSlideId: "default-slide-1",
};

export type SerializedSlideDeckNode = Spread<
  {
    type: "slide-deck";
    data: string;
    version: 1;
  },
  SerializedLexicalNode
>;

export class SlideNode extends DecoratorNode<JSX.Element> {
  __data: string;

  static getType() {
    return "slide-deck";
  }

  static clone(node: SlideNode): SlideNode {
    return new SlideNode(node.__data, node.__key);
  }

  constructor(data?: string, key?: NodeKey) {
    super(key);
    this.__data = data || JSON.stringify(DEFAULT_SLIDE_DECK_DATA);
  }

  createDOM(config: EditorConfig): HTMLElement {
    const div = document.createElement("div");
    div.className = config.theme.slideDeck || "slide-deck-container";
    return div;
  }

  updateDOM(
    _prevNode: SlideNode,
    _dom: HTMLElement,
    _config: EditorConfig,
  ): boolean {
    return false;
  }

  decorate(_editor: LexicalEditor, _config: EditorConfig): JSX.Element {
    return (
      <Suspense fallback={<div>Loading Slides...</div>}>
        <SlideNodeInner
          nodeKey={this.getKey()}
          initialDataString={this.__data}
        />
      </Suspense>
    );
  }

  // Data management methods
  setData(data: SlideDeckData): void {
    const writable = this.getWritable();
    writable.__data = JSON.stringify(data);
  }

  getData(): SlideDeckData {
    try {
      return JSON.parse(this.__data) as SlideDeckData;
    } catch (e) {
      console.error("Error parsing SlideDeckNode data:", e);
      return DEFAULT_SLIDE_DECK_DATA; // Return default on error
    }
  }

  insertNewAfter(): ParagraphNode {
    const newBlock = $createParagraphNode();
    this.insertAfter(newBlock, true);
    return newBlock;
  }

  canBeEmpty(): boolean {
    return false;
  }

  isInline(): boolean {
    return false;
  }

  exportJSON(): SerializedSlideDeckNode {
    return {
      ...super.exportJSON(),
      type: "slide-deck",
      data: this.__data,
      version: 1,
    };
  }

  static importJSON(serializedNode: SerializedSlideDeckNode): SlideNode {
    const node = new SlideNode(serializedNode.data);
    return node;
  }

  static $createSlideDeckNode(data?: SlideDeckData): SlideNode {
    const jsonData = data
      ? JSON.stringify(data)
      : JSON.stringify(DEFAULT_SLIDE_DECK_DATA);
    return new SlideNode(jsonData);
  }

  static $isSlideDeckNode(node?: LexicalNode | null): node is SlideNode {
    return node instanceof SlideNode;
  }
}

function SlideNodeInner({
  nodeKey,
  initialDataString,
}: {
  nodeKey: NodeKey;
  initialDataString: string;
}) {
  const [editor] = useLexicalComposerContext();
  const [dataString, setDataString] = useState(initialDataString);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    setDataString(initialDataString);
  }, [initialDataString]);

  const handleOpenModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const handleSaveModal = useCallback(
    (updatedDataString: string) => {
      editor.update(() => {
        const node = $getNodeByKey(nodeKey) as SlideNode | null;
        if (SlideNode.$isSlideDeckNode(node)) {
          try {
            const parsedData = JSON.parse(updatedDataString) as SlideDeckData;
            node.setData(parsedData);
            setDataString(updatedDataString);
          } catch (e) {
            console.error("Error saving slide data:", e);
          }
        }
      });
      setIsModalOpen(false);
    },
    [editor, nodeKey],
  );

  return (
    <>
      <div onDoubleClick={handleOpenModal} className="cursor-pointer">
        <SlideView initialDataString={dataString} />
      </div>
      {isModalOpen && (
        <SlideModal
          nodeKey={nodeKey}
          initialDataString={dataString}
          editor={editor}
          onSave={handleSaveModal}
          onOpenChange={setIsModalOpen}
          isOpen={isModalOpen}
        />
      )}
    </>
  );
}

export function $createSlideDeckNode(data?: SlideDeckData): SlideNode {
  return SlideNode.$createSlideDeckNode(data);
}
