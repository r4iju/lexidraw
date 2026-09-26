import {
  $create,
  $createParagraphNode,
  DecoratorNode,
  type EditorConfig,
  type Klass,
  type LexicalNode,
  type LexicalParseJSON,
  type NodeKey,
  nodeSchema,
  type ParagraphNode,
  type SerializedLexicalNode,
  type Spread,
  withField,
} from "lexical";
import { z } from "zod";
import {
  EMPTY_CONTENT,
  type KeyedSerializedEditorState,
} from "../keyed-editor-state.js";
import { rawValueOr, type SchemaJSON, shapedAs } from "../schema-values.js";
import { inStoredOrder, withoutNodeState } from "../stored-order.js";
import { shapeFromZod } from "../zod-shape.js";
import { CHART_TYPES } from "./ChartNode.js";

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

const SizeSchema = z.union([z.number(), z.literal("inherit")]);

const elementFields = {
  id: z.string(),
  x: z.number(),
  y: z.number(),
  width: SizeSchema,
  height: SizeSchema,
  version: z.number().optional(),
  zIndex: z.number(),
};

export const SlideElementSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("box"),
    ...elementFields,
    editorStateJSON: z.custom<KeyedSerializedEditorState>(),
    backgroundColor: z.string().optional(),
  }),
  z.object({
    kind: z.literal("image"),
    ...elementFields,
    url: z.string(),
  }),
  z.object({
    kind: z.literal("chart"),
    ...elementFields,
    chartType: z.enum(CHART_TYPES),
    chartData: z.string(),
    chartConfig: z.string(),
  }),
]);

export const SlideSchema = z.object({
  id: z.string(),
  elements: z.array(SlideElementSchema),
  backgroundColor: z.string().optional(),
  slideMetadata: SlideStrategicMetadataSchema.optional(),
});

export const SlideDeckSchema = z.object({
  slides: z.array(SlideSchema),
  currentSlideId: z.string().nullable(),
  deckMetadata: DeckStrategicMetadataSchema.optional(),
});

export type ThemeSettings = z.infer<typeof ThemeSettingsSchema>;

export type DeckStrategicMetadata = z.infer<typeof DeckStrategicMetadataSchema>;

export type SlideStrategicMetadata = z.infer<
  typeof SlideStrategicMetadataSchema
>;

export type SlideElementSpec = z.infer<typeof SlideElementSchema>;

export type SlideData = z.infer<typeof SlideSchema>;

export type SlideDeckData = z.infer<typeof SlideDeckSchema>;

export type SerializedSlideDeckNode = Spread<
  { type: "slide-deck"; data: SlideDeckData; version: 1 },
  SerializedLexicalNode
>;

/** What a deck made without data, or stored without any, holds. */
const DEFAULT_DECK: SlideDeckData = {
  slides: [
    {
      id: "default-slide-1",
      elements: [
        {
          kind: "box",
          id: "default-box-1",
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

const slideFields = {
  data: withField(
    shapedAs(
      shapeFromZod(SlideDeckSchema),
      rawValueOr(DEFAULT_DECK, { nullAsAbsent: true }),
    ),
    { field: "__data" },
  ),
};

/** @internal What {@link slideFields} write, which {@link SerializedSlideDeckNode} is checked against. */
export type SlideFieldsJSON = SchemaJSON<typeof slideFields>;

const slideSchema = nodeSchema<SlideNode>()(slideFields);

/**
 * Serialization half of the slide deck block; see ImageNode for the split.
 */
export class SlideNode extends DecoratorNode<unknown> {
  __data: SlideDeckData;

  $config() {
    return this.config("slide-deck", {
      extends: DecoratorNode,
      json: slideSchema,
    });
  }

  constructor(
    data: SlideDeckData = { slides: [], currentSlideId: null },
    key?: NodeKey,
  ) {
    super(key);
    this.__data = data;
  }

  exportJSON(): SerializedLexicalNode {
    return inStoredOrder(super.exportJSON(), ["data"]);
  }

  updateFromJSON(json: LexicalParseJSON<SerializedLexicalNode>): this {
    return super.updateFromJSON(withoutNodeState(json));
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

  static $createSlideNode<T extends SlideNode>(
    this: Klass<T>,
    data?: SlideDeckData,
  ): T {
    const node = $create(this);
    node.__data = data ?? DEFAULT_DECK;
    return node;
  }

  static $isSlideDeckNode<T extends SlideNode>(
    this: Klass<T>,
    node: LexicalNode | null | undefined,
  ): node is T {
    return node instanceof SlideNode;
  }
}
