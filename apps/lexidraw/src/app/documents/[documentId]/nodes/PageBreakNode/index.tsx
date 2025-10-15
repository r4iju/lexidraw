import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_HIGH,
  COMMAND_PRIORITY_LOW,
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
} from "lexical";
import { ScissorsIcon } from "lucide-react";
import { type JSX, useCallback, useEffect } from "react";
import { cn } from "~/lib/utils";

export type SerializedPageBreakNode = SerializedLexicalNode;

function PageBreakComponent({ nodeKey }: { nodeKey: NodeKey }) {
  const [editor] = useLexicalComposerContext();
  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);

  const $onDelete = useCallback(
    (event: KeyboardEvent) => {
      event.preventDefault();
      if (isSelected && $isNodeSelection($getSelection())) {
        const node = $getNodeByKey(nodeKey);
        if (PageBreakNode.$isPageBreakNode(node)) {
          node.remove();
          return true;
        }
      }
      return false;
    },
    [isSelected, nodeKey],
  );

  useEffect(() => {
    return mergeRegister(
      editor.registerCommand(
        CLICK_COMMAND,
        (event: MouseEvent) => {
          const pbElem = editor.getElementByKey(nodeKey);

          if (event.target === pbElem) {
            if (!event.shiftKey) {
              clearSelection();
            }
            setSelected(!isSelected);
            return true;
          }

          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        $onDelete,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        $onDelete,
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [clearSelection, editor, isSelected, nodeKey, $onDelete, setSelected]);

  useEffect(() => {
    const pbElem = editor.getElementByKey(nodeKey);
    if (pbElem !== null) {
      pbElem.className = isSelected ? "selected" : "";
    }
  }, [editor, isSelected, nodeKey]);

  return (
    <figure
      data-node-type="page-break"
      className={cn(
        "relative block border-y border-dashed",
        "bg-muted border-muted",
        "w-[calc(100%+4rem)]",
        "-ml-[2rem]",
        "my-[1rem]",
        "peer-[:has(+.page-break-handle)[data-selected='true']]:border-primary",
      )}
    >
      {/* scissors icon (old ::before) */}
      <ScissorsIcon
        className={cn(
          "absolute left-[calc(2rem+12px)]",
          "top-1/2 -translate-y-1/2 h-4 w-4 opacity-50",
          "peer-[:has(+.page-break-handle)[data-selected='true']]:opacity-100",
        )}
      />

      <span className="absolute inset-0 flex items-center justify-center">
        <span className="border px-1.5 py-0.5 text-xs font-semibold bg-background text-muted-foreground border-muted cursor-default">
          PAGE&nbsp;BREAK
        </span>
      </span>

      {/* invisible handle that Lexical toggles with .selected */}
      <span data-selected={isSelected} className="page-break-handle hidden" />
    </figure>
  );
}

export class PageBreakNode extends DecoratorNode<JSX.Element> {
  static getType(): string {
    return "page-break";
  }

  static clone(node: PageBreakNode): PageBreakNode {
    return new PageBreakNode(node.__key);
  }

  static importJSON(_serializedNode: SerializedPageBreakNode): PageBreakNode {
    return PageBreakNode.$createPageBreakNode();
  }

  static importDOM(): DOMConversionMap | null {
    return {
      figure: (domNode: HTMLElement) => {
        const tp = domNode.getAttribute("type");
        if (tp !== PageBreakNode.getType()) {
          return null;
        }

        return {
          conversion: PageBreakNode.$convertPageBreakElement,
          priority: COMMAND_PRIORITY_HIGH,
        };
      },
    };
  }

  exportJSON(): SerializedLexicalNode {
    return {
      type: this.getType(),
      version: 1,
    };
  }

  createDOM(): HTMLElement {
    const el = document.createElement("figure");
    el.style.pageBreakAfter = "always";
    el.setAttribute("type", this.getType());
    return el;
  }

  getTextContent(): string {
    return "\n";
  }

  isInline(): false {
    return false;
  }

  updateDOM(): boolean {
    return false;
  }

  decorate(): JSX.Element {
    return <PageBreakComponent nodeKey={this.__key} />;
  }

  static $convertPageBreakElement(): DOMConversionOutput {
    return { node: PageBreakNode.$createPageBreakNode() };
  }

  static $createPageBreakNode(): PageBreakNode {
    return new PageBreakNode();
  }

  static $isPageBreakNode(
    node: LexicalNode | null | undefined,
  ): node is PageBreakNode {
    return node instanceof PageBreakNode;
  }
}
