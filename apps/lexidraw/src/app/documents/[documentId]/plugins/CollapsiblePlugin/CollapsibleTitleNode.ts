import {
  $createParagraphNode,
  $isElementNode,
  DOMConversionMap,
  DOMConversionOutput,
  EditorConfig,
  ElementNode,
  LexicalEditor,
  LexicalNode,
  RangeSelection,
  SerializedElementNode,
} from "lexical";

import { CollapsibleContainerNode } from "./CollapsibleContainerNode";
import { CollapsibleContentNode } from "./CollapsibleContentNode";
import { IS_CHROME } from "@lexical/utils";
import invariant from "../../shared/invariant";

type SerializedCollapsibleTitleNode = SerializedElementNode;

export function $convertSummaryElement(
  _domNode: HTMLElement,
): DOMConversionOutput | null {
  const node = CollapsibleTitleNode.$createCollapsibleTitleNode();
  return {
    node,
  };
}

export class CollapsibleTitleNode extends ElementNode {
  static getType(): string {
    return "collapsible-title";
  }

  static clone(node: CollapsibleTitleNode): CollapsibleTitleNode {
    return new CollapsibleTitleNode(node.__key);
  }

  createDOM(config: EditorConfig, editor: LexicalEditor): HTMLElement {
    const dom = document.createElement("summary");
    dom.classList.add(
      "flex",
      "items-center",
      "cursor-pointer",
      "pt-1",
      "pr-1",
      "pl-2",
      "font-bold",
      "outline-none",
      "list-none",
    );

    const icon = document.createElement("span");
    icon.classList.add(
      "mr-2",
      "transition-transform",
      "duration-200",
      "ease-in-out",
      "size-4",
    );
    icon.innerHTML =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6" /></svg>';
    dom.prepend(icon);

    if (IS_CHROME) {
      dom.addEventListener("click", (event) => {
        event.preventDefault();
        editor.update(() => {
          const collapsibleContainer = this.getLatest().getParentOrThrow();
          invariant(
            CollapsibleContainerNode.$isCollapsibleContainerNode(
              collapsibleContainer,
            ),
            "Expected parent node to be a CollapsibleContainerNode",
          );
          collapsibleContainer.toggleOpen();
          const isOpen = collapsibleContainer.getOpen();
          if (isOpen) {
            icon.classList.add("rotate-90");
          } else {
            icon.classList.remove("rotate-90");
          }
        });
      });
    }

    editor.getEditorState().read(() => {
      const container = this.getParent();
      if (
        CollapsibleContainerNode.$isCollapsibleContainerNode(container) &&
        container.getOpen()
      ) {
        icon.classList.add("rotate-90");
      }
    });

    return dom;
  }

  updateDOM(
    _prevNode: CollapsibleTitleNode,
    _dom: HTMLElement,
    _config: EditorConfig,
  ): boolean {
    return false;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      summary: (_domNode: HTMLElement) => {
        return {
          conversion: $convertSummaryElement,
          priority: 1,
        };
      },
    };
  }

  static importJSON(
    _serializedNode: SerializedCollapsibleTitleNode,
  ): CollapsibleTitleNode {
    return CollapsibleTitleNode.$createCollapsibleTitleNode();
  }

  static $isCollapsibleTitleNode(
    node: LexicalNode | null | undefined,
  ): node is CollapsibleTitleNode {
    return node instanceof CollapsibleTitleNode;
  }

  static $createCollapsibleTitleNode(): CollapsibleTitleNode {
    return new CollapsibleTitleNode();
  }

  exportJSON(): SerializedCollapsibleTitleNode {
    return {
      ...super.exportJSON(),
      type: "collapsible-title",
      version: 1,
    };
  }

  collapseAtStart(_selection: RangeSelection): boolean {
    this.getParentOrThrow().insertBefore(this);
    return true;
  }

  insertNewAfter(_: RangeSelection, restoreSelection = true): ElementNode {
    const containerNode = this.getParentOrThrow();

    if (
      containerNode !== null &&
      !CollapsibleContainerNode.$isCollapsibleContainerNode(containerNode)
    ) {
      throw new Error(
        "CollapsibleTitleNode expects to be child of CollapsibleContainerNode",
      );
    }

    if (containerNode.getOpen()) {
      const contentNode = this.getNextSibling();
      if (!CollapsibleContentNode.$isCollapsibleContentNode(contentNode)) {
        throw new Error(
          "CollapsibleTitleNode expects to have CollapsibleContentNode sibling",
        );
      }

      const firstChild = contentNode.getFirstChild();
      if ($isElementNode(firstChild)) {
        return firstChild;
      } else {
        const paragraph = $createParagraphNode();
        contentNode.append(paragraph);
        return paragraph;
      }
    } else {
      const paragraph = $createParagraphNode();
      containerNode.insertAfter(paragraph, restoreSelection);
      return paragraph;
    }
  }
}
