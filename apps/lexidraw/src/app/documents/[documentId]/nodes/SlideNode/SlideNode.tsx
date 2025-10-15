import {
  DecoratorNode,
  type Spread,
  type LexicalNode,
  $createParagraphNode,
  type ParagraphNode,
  type EditorConfig,
  type NodeKey,
  type LexicalEditor,
  type SerializedLexicalNode,
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
import { z } from "zod";
import { MetadataModalProvider } from "./MetadataModalContext";
import { EMPTY_CONTENT } from "../../initial-content";
import type { KeyedSerializedEditorState } from "../../types";

export type SlideElementSpec =
  | {
      kind: "box";
      id: string;
      x: number;
      y: number;
      width: number | "inherit";
      height: number | "inherit";
      editorStateJSON: KeyedSerializedEditorState;
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

export const ThemeSettingsSchema = z.object({
  templateName: z.string().optional(),
  colorPalette: z
    .object({
      primary: z.string().optional(),
      secondary: z.string().optional(),
      accent: z.string().optional(),
      slideBackground: z.string().optional(),
      textHeader: z.string().optional(),
      textBody: z.string().optional(),
    })
    .optional(),
  fonts: z
    .object({
      heading: z.string().optional(),
      body: z.string().optional(),
      caption: z.string().optional(),
    })
    .optional(),
  logoUrl: z.string().optional(),
  customTokens: z.string().optional(),
});

export const DeckStrategicMetadataSchema = z.object({
  bigIdea: z.string().optional(),
  audiencePersonaSummary: z.string().optional(),
  overallObjective: z.string().optional(),
  recommendedTone: z.string().optional(),
  originalUserPrompt: z.string().optional(),
  targetSlideCount: z.number().optional(),
  targetDurationMinutes: z.number().optional(),
  theme: ThemeSettingsSchema.optional(),
});

export const SlideStrategicMetadataSchema = z.object({
  purpose: z.string().optional(),
  storyboardTitle: z.string().optional(),
  keyMessage: z.string().optional(),
  keyVisualHint: z.string().optional(),
  takeAwayMessage: z.string().optional(),
  layoutTemplateHint: z.string().optional(),
  speakerNotes: z.string().optional(),
  sourceMaterialRefs: z.array(z.string()).optional(),
});

export type ThemeSettings = z.infer<typeof ThemeSettingsSchema>;

export type DeckStrategicMetadata = z.infer<typeof DeckStrategicMetadataSchema>;

export type SlideStrategicMetadata = z.infer<
  typeof SlideStrategicMetadataSchema
>;

export type SlideDeckData = {
  slides: SlideData[];
  currentSlideId: string | null;
  deckMetadata?: DeckStrategicMetadata;
};

export type SerializedSlideDeckNode = Spread<
  {
    type: "slide-deck";
    data: SlideDeckData;
    version: 1;
  },
  SerializedLexicalNode
>;

export class SlideNode extends DecoratorNode<JSX.Element> {
  __data: SlideDeckData;

  static getType() {
    return "slide-deck";
  }

  static clone(node: SlideNode): SlideNode {
    const clonedNode = new SlideNode(node.__data, node.__key);
    return clonedNode;
  }

  constructor(data: SlideDeckData, key?: NodeKey) {
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
        <SlideNodeInner nodeKey={this.getKey()} initialData={this.__data} />
      </Suspense>
    );
  }

  setData(data: SlideDeckData): void {
    const writable = this.getWritable();
    writable.__data = data;
  }

  getData(): SlideDeckData {
    try {
      return this.__data;
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

  static $createSlideNode(data?: SlideDeckData): SlideNode {
    return new SlideNode(
      data ?? {
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
                height: 50,
                editorStateJSON: EMPTY_CONTENT,
                zIndex: 0,
              },
            ],
          },
        ],
        currentSlideId: "default-slide-1",
      },
    );
  }

  static $isSlideDeckNode(node?: LexicalNode | null): node is SlideNode {
    return node instanceof SlideNode;
  }
}

function SlideNodeInner({
  nodeKey,
  initialData,
}: {
  nodeKey: NodeKey;
  initialData: SlideDeckData;
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
    (updatedData: SlideDeckData) => {
      editor.update(() => {
        const node = $getNodeByKey<SlideNode>(nodeKey);
        if (node) {
          try {
            node.setData(updatedData);
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
        <SlideView initialData={initialData} editor={editor} />
      </div>
      {isModalOpen && (
        <MetadataModalProvider>
          <SlideModal
            nodeKey={nodeKey}
            initialData={initialData}
            editor={editor}
            onSave={handleSaveModal}
            onOpenChange={setIsModalOpen}
            isOpen={isModalOpen}
          />
        </MetadataModalProvider>
      )}
    </>
  );
}
