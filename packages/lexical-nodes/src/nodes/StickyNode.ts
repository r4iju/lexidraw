import {
  $create,
  $setSelection,
  createEditor,
  DecoratorNode,
  enumValue,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  numberValue,
  type SerializedEditor,
  type SerializedLexicalNode,
  type Spread,
  withAccessors,
  withField,
} from "lexical";
import {
  type NestedEditorJSON,
  nestedEditorValue,
  setNestedEditorJSON,
} from "../schema-values.js";

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
    caption: SerializedEditor;
  },
  SerializedLexicalNode
>;

const stickySchema = nodeSchema<StickyNode>()({
  caption: withAccessors(nestedEditorValue, {
    getter: "getCaptionJSON",
    setter: "setCaptionJSON",
  }),
  color: withField(enumValue(STICKY_NOTE_COLORS, "yellow"), {
    field: "__color",
  }),
  xOffset: withField(numberValue(), { field: "__x" }),
  yOffset: withField(numberValue(), { field: "__y" }),
});

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
