import {
  ElementNode,
  SerializedElementNode,
  Spread,
  LexicalNode,
  $createParagraphNode,
  ParagraphNode,
} from "lexical";

export type SerializedSlideDeckNode = Spread<
  { type: "slide-deck" },
  SerializedElementNode
>;

export class SlideDeckNode extends ElementNode {
  static getType() {
    return "slide-deck";
  }

  static clone(n: SlideDeckNode) {
    return new SlideDeckNode(n.__key);
  }

  createDOM() {
    const el = document.createElement("section");
    el.className =
      "slide-deck-lexical-node relative mx-auto w-[1280px] h-[720px] max-w-full max-h-full overflow-hidden";
    return el;
  }

  updateDOM() {
    return false;
  }

  // Method to ensure there's content after this node
  insertNewAfter(): ParagraphNode {
    const newBlock = $createParagraphNode();
    const direction = this.getDirection();
    newBlock.setDirection(direction);
    this.insertAfter(newBlock, true);
    return newBlock;
  }

  canBeEmpty(): boolean {
    return false; // A slide deck itself isn't "empty" in terms of user content like a paragraph
  }

  isInline(): boolean {
    return false; // Explicitly a block node
  }

  exportJSON(): SerializedSlideDeckNode {
    return {
      ...super.exportJSON(),
      type: "slide-deck",
      version: 1,
    };
  }

  static importJSON() {
    return new SlideDeckNode();
  }

  static $create() {
    return new SlideDeckNode();
  }
  static $isSlideDeckNode(node?: LexicalNode | null): node is SlideDeckNode {
    return node instanceof SlideDeckNode;
  }
}
