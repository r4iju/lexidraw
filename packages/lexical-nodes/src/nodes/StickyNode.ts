import type {
  Klass,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedEditor,
  SerializedLexicalNode,
  Spread,
} from "lexical";
import { $create, $setSelection, createEditor, DecoratorNode } from "lexical";

export type StickyNoteColor =
  | "pink"
  | "yellow"
  | "green"
  | "blue"
  | "red"
  | "orange"
  | "purple"
  | "gray";

export type SerializedStickyNode = Spread<
  {
    xOffset: number;
    yOffset: number;
    color: StickyNoteColor;
    caption: SerializedEditor;
  },
  SerializedLexicalNode
>;

export class StickyNode extends DecoratorNode<unknown> {
  __x: number;
  __y: number;
  __color: StickyNoteColor;
  __caption: LexicalEditor;

  static getType(): string {
    return "sticky";
  }

  static clone(node: StickyNode): StickyNode {
    return new this(
      node.__x,
      node.__y,
      node.__color,
      node.__caption,
      node.__key,
    );
  }

  static importJSON(serializedNode: SerializedStickyNode): StickyNode {
    const stickyNode = $create(StickyNode);
    stickyNode.__x = serializedNode.xOffset;
    stickyNode.__y = serializedNode.yOffset;
    stickyNode.__color = serializedNode.color;
    const caption = serializedNode.caption;
    const nestedEditor = stickyNode.__caption;
    const editorState = nestedEditor.parseEditorState(caption.editorState);
    if (!editorState.isEmpty()) {
      nestedEditor.setEditorState(editorState);
    }
    return stickyNode;
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

  exportJSON(): SerializedStickyNode {
    return {
      caption: this.__caption.toJSON(),
      color: this.__color,
      type: "sticky",
      version: 1,
      xOffset: this.__x,
      yOffset: this.__y,
    };
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
    const colors = [
      "pink",
      "yellow",
      "green",
      "blue",
      "red",
      "orange",
      "purple",
      "gray",
    ];
    const currentIndex = colors.indexOf(writable.__color);
    const nextIndex = (currentIndex + 1) % colors.length;
    writable.__color = colors[nextIndex] as StickyNoteColor;
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
