import {
  $create,
  $createParagraphNode,
  DecoratorNode,
  type EditorConfig,
  type Klass,
  type LexicalNode,
  type NodeKey,
  type ParagraphNode,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import { z } from "zod";
import {
  EMPTY_CONTENT,
  type KeyedSerializedEditorState,
} from "../keyed-editor-state.js";
import type { ChartType } from "./ChartNode.js";

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

/**
 * Serialization half of the slide deck block; see ImageNode for the split.
 */
export class SlideNode extends DecoratorNode<unknown> {
  __data: SlideDeckData;

  static getType(): string {
    return "slide-deck";
  }

  static clone(node: SlideNode): SlideNode {
    return new this(node.__data, node.__key);
  }

  constructor(
    data: SlideDeckData = { slides: [], currentSlideId: null },
    key?: NodeKey,
  ) {
    super(key);
    this.__data = data;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const div = document.createElement("div");
    div.className = config.theme.slideDeck || "slide-deck-container";
    return div;
  }

  updateDOM(): false {
    return false;
  }

  setData(data: SlideDeckData): void {
    const writable = this.getWritable();
    writable.__data = data;
  }

  getData(): SlideDeckData {
    return this.__data;
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
    return SlideNode.$createSlideNode(serializedNode.data);
  }

  static $createSlideNode<T extends SlideNode>(
    this: Klass<T>,
    data?: SlideDeckData,
  ): T {
    const node = $create(this);
    node.__data = data ?? {
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
    };
    return node;
  }

  static $isSlideDeckNode<T extends SlideNode>(
    this: Klass<T>,
    node: LexicalNode | null | undefined,
  ): node is T {
    return node instanceof SlideNode;
  }
}
