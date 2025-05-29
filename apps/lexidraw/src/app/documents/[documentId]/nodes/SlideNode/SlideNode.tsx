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
  $getSelection,
  $isNodeSelection,
  $createNodeSelection,
  $setSelection,
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
import { cn } from "~/lib/utils";
import type { ChartType } from "../ChartNode";

type EditorStateJSONChild = {
  children?: EditorStateJSONChild[];
  direction: string | null;
  format: string;
  indent: number;
  type: string;
  version: number;
  [key: string]: unknown;
};

export type EditorStateJSON = {
  root: EditorStateJSONChild;
};

export type SlideElementSpec =
  | {
      kind: "box";
      id: string;
      x: number;
      y: number;
      width: number | "inherit";
      height: number | "inherit";
      editorStateJSON: EditorStateJSON | null;
      version?: number;
      backgroundColor?: string;
      zIndex: number;
    }
  | {
      kind: "image";
      id: string;
      x: number;
      y: number;
      width: number | "inherit";
      height: number | "inherit";
      url: string;
      version?: number;
      zIndex: number;
    }
  | {
      kind: "chart";
      id: string;
      x: number;
      y: number;
      width: number | "inherit";
      height: number | "inherit";
      chartType: ChartType;
      chartData: string;
      chartConfig: string;
      version?: number;
      zIndex: number;
    };

export interface SlideData {
  id: string;
  elements: SlideElementSpec[];
  backgroundColor?: string;
  slideMetadata?: SlideStrategicMetadata;
}

export type ThemeSettings = {
  templateName?: string;
  colorPalette?: {
    primary?: string;
    secondary?: string;
    accent?: string;
    slideBackground?: string;
    textHeader?: string;
    textBody?: string;
  };
  fonts?: {
    heading?: string;
    body?: string;
    caption?: string;
  };
  logoUrl?: string;
  customTokens?: Record<string, string> | string;
};

export type DeckStrategicMetadata = {
  bigIdea?: string;
  audiencePersonaSummary?: string;
  overallObjective?: string;
  recommendedTone?: string;
  originalUserPrompt?: string;
  targetSlideCount?: number;
  targetDurationMinutes?: number;
  theme?: ThemeSettings;
};

export type SlideStrategicMetadata = {
  purpose?: string;
  storyboardTitle?: string;
  keyVisualHint?: string;
  takeAwayMessage?: string;
  layoutTemplateHint?: string;
  speakerNotes?: string;
  sourceMaterialRefs?: string[];
};

export type SlideDeckData = {
  slides: SlideData[];
  currentSlideId: string | null;
  deckMetadata?: DeckStrategicMetadata;
};

export const DEFAULT_BOX_EDITOR_STATE = {
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
} satisfies EditorStateJSON;

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
          editorStateJSON: DEFAULT_BOX_EDITOR_STATE,
          zIndex: 0,
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
    const clonedNode = new SlideNode(node.__data, node.__key);
    return clonedNode;
  }

  constructor(data: string, key?: NodeKey) {
    super(key);
    this.__data = data;
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

  setData(data: SlideDeckData): void {
    console.log(
      "[SlideNode setData] Received data to set:",
      JSON.stringify(data, null, 2),
    );
    const writable = this.getWritable();
    const newDataString = JSON.stringify(data);
    writable.__data = newDataString;
  }

  getData(): SlideDeckData {
    try {
      return JSON.parse(this.__data) as SlideDeckData;
    } catch (e) {
      console.error(
        "[SlideNode] Error parsing SlideDeckNode data in getData:",
        e,
      );
      throw e;
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

  static $createSlideNode(data: SlideDeckData): SlideNode {
    const jsonData = JSON.stringify(data);
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
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showSelectionUI, setShowSelectionUI] = useState(false);

  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if ($isNodeSelection(selection)) {
          const selectedNodes = selection.getNodes();
          if (
            selectedNodes.length === 1 &&
            selectedNodes[0] &&
            selectedNodes[0].getKey() === nodeKey
          ) {
            setShowSelectionUI(true);
            return;
          }
        }
        setShowSelectionUI(false);
      });
    });
  }, [editor, nodeKey]);

  const handleOpenModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const handleSelect = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      editor.update(() => {
        editor.focus();
        const selection = $getSelection();
        if (
          !$isNodeSelection(selection) ||
          !selection.getNodes().find((node) => node.getKey() === nodeKey)
        ) {
          const nodeSelection = $createNodeSelection();
          nodeSelection.add(nodeKey);
          $setSelection(nodeSelection);
        }
      });
    },
    [editor, nodeKey],
  );

  const handleSaveModal = useCallback(
    (updatedDataString: string) => {
      editor.update(() => {
        const node = $getNodeByKey<SlideNode>(nodeKey);
        if (node) {
          try {
            const parsedData = JSON.parse(updatedDataString) as SlideDeckData;
            node.setData(parsedData);
          } catch (e) {
            console.error("[SlideNodeInner] Error saving slide data:", e);
          }
        }
      });
      setIsModalOpen(false);
    },
    [editor, nodeKey],
  );

  return (
    <>
      <div
        onDoubleClick={handleOpenModal}
        onClick={handleSelect}
        className={cn("cursor-pointer relative", {
          "ring-1 ring-primary box-content": showSelectionUI,
        })}
      >
        <SlideView initialDataString={initialDataString} editor={editor} />
      </div>
      {isModalOpen && (
        <SlideModal
          nodeKey={nodeKey}
          initialDataString={initialDataString}
          editor={editor}
          onSave={handleSaveModal}
          onOpenChange={setIsModalOpen}
          isOpen={isModalOpen}
        />
      )}
    </>
  );
}
