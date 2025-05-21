import { ElementNode, SerializedElementNode, Spread } from "lexical";

export type SerializedSlideDeckNode = Spread<
  {
    type: "slide-deck";
  },
  SerializedElementNode
>;

export class SlideDeckNode extends ElementNode {
  static getType() {
    return "slide-deck";
  }

  static clone(n: SlideDeckNode) {
    return new SlideDeckNode(n.__key);
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

  createDOM() {
    const el = document.createElement("section");
    el.className = "relative mx-auto w-[1280px] h-[720px] max-w-full max-h-full";
    return el;
  }
  updateDOM() {
    return false;
  }

  /* Factory */
  static $create() {
    return new SlideDeckNode();
  }
  static $isSlideDeckNode(node: unknown): node is SlideDeckNode {
    return node instanceof SlideDeckNode;
  }
}
