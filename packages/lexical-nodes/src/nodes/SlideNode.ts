import {
  $createParagraphNode,
  DecoratorNode,
  type EditorConfig,
  type Klass,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  type ParagraphNode,
  type SerializedLexicalNode,
  type Spread,
  withField,
} from "lexical";
import { EMPTY_CONTENT } from "../keyed-editor-state.js";
import { rawValueOr, type SchemaJSON } from "../schema-values.js";
import {
  type ImportJSON,
  storedFields,
  withStoredJSON,
  written,
} from "../stored-fields.js";

/**
 * What a deck stored without data reads as: the deck the slide editor made,
 * so such a deck still saves back as it did.
 */
const DEFAULT_DECK = {
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

const { fields: slideFields, json: slideJSON } = storedFields({
  type: written,
  version: written,
  data: withField(rawValueOr<unknown>(DEFAULT_DECK, { nullAsAbsent: true }), {
    field: "__data",
  }),
});

export type SerializedSlideDeckNode = Spread<
  SchemaJSON<typeof slideJSON>,
  SerializedLexicalNode
>;

const slideSchema = nodeSchema<SlideNode>()(slideFields);

/**
 * A slide deck saved before slides were removed (#253). Nothing makes one any
 * more. A stored deck keeps its data exactly as stored, so a document saves
 * it back unchanged, and editors show it as a placeholder with its text.
 */
export class SlideNode extends DecoratorNode<unknown> {
  declare static importJSON: ImportJSON<SlideNode>;
  __data: unknown;

  $config() {
    return this.config("slide-deck", {
      extends: DecoratorNode,
      json: slideSchema,
    });
  }

  constructor(
    data: unknown = { slides: [], currentSlideId: null },
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

  getData(): unknown {
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

  static $isSlideDeckNode<T extends SlideNode>(
    this: Klass<T>,
    node: LexicalNode | null | undefined,
  ): node is T {
    return node instanceof SlideNode;
  }
}

withStoredJSON(SlideNode);

type Stored = Record<string, unknown>;

const isStored = (value: unknown): value is Stored =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const listAt = (value: unknown, key: string): unknown[] => {
  const list = isStored(value) ? value[key] : undefined;
  return Array.isArray(list) ? list : [];
};

/** The slides a stored deck holds, whatever else its data holds. */
export const storedSlides = (data: unknown): unknown[] =>
  listAt(data, "slides");

/** A slide's title from its storyboard, if it had one. */
export function storedSlideTitle(slide: unknown): string | undefined {
  const metadata = isStored(slide) ? slide.slideMetadata : undefined;
  const title = isStored(metadata) ? metadata.storyboardTitle : undefined;
  return typeof title === "string" && title !== "" ? title : undefined;
}

const textOf = (node: unknown): string =>
  isStored(node) && typeof node.text === "string"
    ? node.text
    : isStored(node) && node.type === "linebreak"
      ? "\n"
      : listAt(node, "children").map(textOf).join("");

/** A block's lines: its own text, or each of its blocks' when it holds blocks. */
function linesOf(node: unknown): string[] {
  const children = listAt(node, "children");
  const holdsText =
    children.length === 0 ||
    children.some(
      (child) =>
        isStored(child) &&
        (typeof child.text === "string" || child.type === "linebreak"),
    );
  return holdsText ? [textOf(node)] : children.flatMap(linesOf);
}

/**
 * The text a stored deck's text boxes hold, a line per block, slide by slide.
 * A box stored as a JSON string, as some were, reads as its parsed state.
 */
export function slideDeckText(data: unknown): string[] {
  return storedSlides(data).flatMap((slide) =>
    listAt(slide, "elements").flatMap((element) => {
      if (!isStored(element) || element.kind !== "box") return [];
      let state = element.editorStateJSON;
      if (typeof state === "string") {
        try {
          state = JSON.parse(state);
        } catch {
          return [];
        }
      }
      return listAt(isStored(state) ? state.root : undefined, "children")
        .flatMap(linesOf)
        .map((line) => line.trim())
        .filter((line) => line !== "");
    }),
  );
}
