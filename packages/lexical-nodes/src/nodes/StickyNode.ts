import {
  $create,
  $setSelection,
  createEditor,
  DecoratorNode,
  enumValue,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type LexicalParseJSON,
  type NodeKey,
  nodeSchema,
  type SerializedEditor,
  type SerializedLexicalNode,
  type Spread,
  withAccessors,
  withField,
} from "lexical";
import {
  type NestedEditorJSON,
  nestedEditorValue,
  type SchemaJSON,
  setNestedEditorJSON,
  shapedAs,
  storedValue,
} from "../schema-values.js";
import { inStoredOrder, withoutNodeState } from "../stored-order.js";

const STICKY_NOTE_COLORS = [
  "pink",
  "yellow",
  "green",
  "blue",
  "red",
  "orange",
  "purple",
  "gray",
] as const;

export type StickyNoteColor = (typeof STICKY_NOTE_COLORS)[number];

export type SerializedStickyNode = Spread<
  {
    xOffset: number;
    yOffset: number;
    color: StickyNoteColor;
    caption: NestedEditorJSON;
  },
  SerializedLexicalNode
>;

const stickyFields = {
  caption: withAccessors(nestedEditorValue, {
    getter: "getCaptionJSON",
    setter: "setCaptionJSON",
  }),
  color: withField(
    shapedAs(
      enumValue(STICKY_NOTE_COLORS, "yellow"),
      storedValue<StickyNoteColor>(),
    ),
    { field: "__color" },
  ),
  xOffset: withField(storedValue<number>(), { field: "__x" }),
  yOffset: withField(storedValue<number>(), { field: "__y" }),
};

/** @internal What {@link stickyFields} write, which {@link SerializedStickyNode} is checked against. */
export type StickyFieldsJSON = SchemaJSON<typeof stickyFields>;

const stickySchema = nodeSchema<StickyNode>()(stickyFields);

export class StickyNode extends DecoratorNode<unknown> {
  __x: number;
  __y: number;
  __color: StickyNoteColor;
  __caption: LexicalEditor;

  $config() {
    return this.config("sticky", {
      extends: DecoratorNode,
      json: stickySchema,
    });
  }

  constructor(
    x = 0,
    y = 0,
    color: StickyNoteColor = "yellow",
    caption?: LexicalEditor,
    key?: NodeKey,
  ) {
    super(key);
    this.__x = x;
    this.__y = y;
    this.__caption = caption || createEditor();
    this.__color = color;
  }

  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__x = prevNode.__x;
    this.__y = prevNode.__y;
    this.__color = prevNode.__color;
    this.__caption = prevNode.__caption;
  }

  exportJSON(): SerializedLexicalNode {
    return inStoredOrder(super.exportJSON(), [
      "caption",
      "color",
      "type",
      "version",
      "xOffset",
      "yOffset",
    ]);
  }

  updateFromJSON(json: LexicalParseJSON<SerializedLexicalNode>): this {
    return super.updateFromJSON(withoutNodeState(json));
  }

  getCaptionJSON(): SerializedEditor {
    return this.__caption.toJSON();
  }

  setCaptionJSON(caption: NestedEditorJSON): this {
    setNestedEditorJSON(this.__caption, caption);
    return this;
  }

  createDOM(): HTMLElement {
    const div = document.createElement("div");
    div.style.display = "contents";
    return div;
  }

  updateDOM(): false {
    return false;
  }

  setPosition(x: number, y: number): void {
    const writable = this.getWritable();
    writable.__x = x;
    writable.__y = y;
    $setSelection(null);
  }

  toggleColor(): void {
    const writable = this.getWritable();
    const currentIndex = STICKY_NOTE_COLORS.indexOf(writable.__color);
    const nextIndex = (currentIndex + 1) % STICKY_NOTE_COLORS.length;
    writable.__color = STICKY_NOTE_COLORS[nextIndex] ?? "yellow";
  }

  isIsolated(): true {
    return true;
  }

  static $isStickyNode<T extends StickyNode>(
    this: Klass<T>,

    node: LexicalNode | null | undefined,
  ): node is T {
    return node instanceof StickyNode;
  }

  static $createStickyNode<T extends StickyNode>(
    this: Klass<T>,
    xOffset: number,
    yOffset: number,
  ): T {
    const node = $create(this);
    node.__x = xOffset;
    node.__y = yOffset;
    node.__color = "yellow";
    return node;
  }
}
