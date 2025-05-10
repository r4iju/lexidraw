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
import ReactDOMServer from "react-dom/server";
import { ChevronRight } from "lucide-react";

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

  createDOM(_config: EditorConfig, editor: LexicalEditor): HTMLElement {
    const summaryJsx = (
      <summary className="flex items-center cursor-pointer pt-1 pr-1 pl-2 font-bold list-none outline-none">
        <ChevronRight className="mr-2 transition-transform duration-200 ease-in-out group-open:rotate-90 size-4" />
      </summary>
    );

    const html = ReactDOMServer.renderToStaticMarkup(summaryJsx);
    const div = document.createElement("div");
    div.innerHTML = html;
    const dom = div.firstChild as HTMLElement;

    dom.addEventListener("click", (e) => {
      e.preventDefault();
      editor.update(() => {
        const container = this.getLatest().getParentOrThrow();
        if (CollapsibleContainerNode.$isCollapsibleContainerNode(container)) {
          container.toggleOpen();
        }
      });
    });

    return dom;
  }

  updateDOM() {
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
