import { addClassNamesToElement } from "@lexical/utils";
import {
  type DOMConversionMap,
  type EditorConfig,
  ElementNode,
  type LexicalNode,
  type LexicalParseJSON,
  nodeSchema,
  type SerializedLexicalNode,
} from "lexical";
import { withoutNodeState } from "../stored-order.js";
import { unreadElementFields } from "./stored-element.js";

export class LayoutItemNode extends ElementNode {
  $config() {
    return this.config("layout-item", {
      extends: ElementNode,
      json: nodeSchema<LayoutItemNode>()(unreadElementFields),
    });
  }

  updateFromJSON(json: LexicalParseJSON<SerializedLexicalNode>): this {
    return super.updateFromJSON(withoutNodeState(json));
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = document.createElement("div");
    dom.setAttribute("data-lexical-layout-item", "true");
    if (typeof config.theme.layoutItem === "string") {
      addClassNamesToElement(dom, config.theme.layoutItem);
    }
    return dom;
  }

  updateDOM(): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap | null {
    return {};
  }

  isShadowRoot(): boolean {
    return true;
  }

  static $createLayoutItemNode(): LayoutItemNode {
    return new LayoutItemNode();
  }

  static $isLayoutItemNode(
    node: LexicalNode | null | undefined,
  ): node is LayoutItemNode {
    return node instanceof LayoutItemNode;
  }
}
