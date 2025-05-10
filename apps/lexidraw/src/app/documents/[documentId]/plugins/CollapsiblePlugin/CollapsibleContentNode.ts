import {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  ElementNode,
  LexicalEditor,
  LexicalNode,
  SerializedElementNode,
} from "lexical";

import { CollapsibleContainerNode } from "./CollapsibleContainerNode";
import { IS_CHROME } from "@lexical/utils";
import invariant from "../../shared/invariant";

type SerializedCollapsibleContentNode = SerializedElementNode;

export function $convertCollapsibleContentElement(
  _domNode: HTMLElement,
): DOMConversionOutput | null {
  const node = CollapsibleContentNode.$createCollapsibleContentNode();
  return {
    node,
  };
}

export class CollapsibleContentNode extends ElementNode {
  static getType(): string {
    return "collapsible-content";
  }

  static clone(node: CollapsibleContentNode): CollapsibleContentNode {
    return new CollapsibleContentNode(node.__key);
  }

  private setDomHiddenUntilFound(dom: HTMLElement): void {
    // @ts-expect-error it's probably fine
    dom.hidden = "until-found";
  }

  private domOnBeforeMatch(dom: HTMLElement, callback: () => void): void {
    // @ts-expect-error it's probably fine
    dom.onbeforematch = callback;
  }

  createDOM(config: EditorConfig, editor: LexicalEditor): HTMLElement {
    const dom = document.createElement("div");
    dom.classList.add("pr-1", "pb-1", "pl-5", "overflow-hidden");

    // If initially closed, set height to 0 for opening animation baseline
    editor.getEditorState().read(() => {
      const containerNode = this.getParentOrThrow();
      if (
        CollapsibleContainerNode.$isCollapsibleContainerNode(containerNode) &&
        !containerNode.getOpen()
      ) {
        dom.classList.add("h-0");
      }
    });

    if (IS_CHROME) {
      editor.getEditorState().read(() => {
        const containerNode = this.getParentOrThrow();
        invariant(
          CollapsibleContainerNode.$isCollapsibleContainerNode(containerNode),
          "Expected parent node to be a CollapsibleContainerNode",
        );
        if (!containerNode.__open) {
          this.setDomHiddenUntilFound(dom);
        }
      });
      this.domOnBeforeMatch(dom, () => {
        editor.update(() => {
          const containerNode = this.getParentOrThrow().getLatest();
          invariant(
            CollapsibleContainerNode.$isCollapsibleContainerNode(containerNode),
            "Expected parent node to be a CollapsibleContainerNode",
          );
          if (!containerNode.__open) {
            containerNode.toggleOpen();
          }
        });
      });
    }
    return dom;
  }

  updateDOM(_prevNode: CollapsibleContentNode, _dom: HTMLElement): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      div: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute("data-lexical-collapsible-content")) {
          return null;
        }
        return {
          conversion: $convertCollapsibleContentElement,
          priority: 2,
        };
      },
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("div");
    element.classList.add("pr-1", "pb-1", "pl-5");
    element.setAttribute("data-lexical-collapsible-content", "true");
    return { element };
  }

  static importJSON(
    _serializedNode: SerializedCollapsibleContentNode,
  ): CollapsibleContentNode {
    return CollapsibleContentNode.$createCollapsibleContentNode();
  }

  isShadowRoot(): boolean {
    return true;
  }

  exportJSON(): SerializedCollapsibleContentNode {
    return {
      ...super.exportJSON(),
      type: "collapsible-content",
      version: 1,
    };
  }
  static $createCollapsibleContentNode(): CollapsibleContentNode {
    return new CollapsibleContentNode();
  }

  static $isCollapsibleContentNode(
    node: LexicalNode | null | undefined,
  ): node is CollapsibleContentNode {
    return node instanceof CollapsibleContentNode;
  }
}
