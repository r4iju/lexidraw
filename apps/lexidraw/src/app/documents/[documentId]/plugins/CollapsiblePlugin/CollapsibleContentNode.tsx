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
import ReactDOMServer from "react-dom/server";

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
    let initialIsOpen = true; // Default to open unless parent container is closed
    editor.getEditorState().read(() => {
      const containerNode = this.getParentOrThrow();
      if (CollapsibleContainerNode.$isCollapsibleContainerNode(containerNode)) {
        initialIsOpen = containerNode.getOpen();
      }
    });

    // The class `h-0` is applied if initially closed to set a baseline for animation.
    // Animations themselves (e.g., animate-accordion-down/up) are typically handled by
    // the container node's updateDOM when the open state changes.
    const contentJsx = (
      <div
        className={[
          "pr-1 pb-1 pl-5 overflow-hidden origin-top",
          "transition-transform duration-300 ease-in-out",
          "details-open-content:scale-y-100", // <- opens automatically
          initialIsOpen ? "scale-y-100" : "scale-y-0",
        ].join(" ")}
      >
        {/* Lexical will append children here */}
      </div>
    );

    const htmlString = ReactDOMServer.renderToStaticMarkup(contentJsx);
    const temp = document.createElement("div");
    temp.innerHTML = htmlString;
    const dom = temp.firstChild as HTMLElement;

    // Imperatively add attributes/listeners not easily handled by static JSX
    if (IS_CHROME) {
      editor.getEditorState().read(() => {
        const containerNode = this.getParentOrThrow();
        invariant(
          CollapsibleContainerNode.$isCollapsibleContainerNode(containerNode),
          "Expected parent node to be a CollapsibleContainerNode",
        );
        if (!containerNode.__open) {
          // Accessing internal __open for initial state
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

  updateDOM(
    _prevNode: CollapsibleContentNode,
    _dom: HTMLElement,
    _config: EditorConfig,
  ): boolean {
    // Content DOM is static from its own perspective; parent handles open/close trigger
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
