import {
  $applyNodeReplacement,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type LexicalParseJSON,
  type NodeKey,
  nodeSchema,
  type SerializedLexicalNode,
  type SerializedTextNode,
  type Spread,
  TextNode,
  withField,
} from "lexical";
import { type SchemaJSON, storedValue } from "../schema-values.js";
import { inStoredOrder, withoutNodeState } from "../stored-order.js";
import { storedTextFields } from "./stored-text.js";

export type SerializedMentionNode = Spread<
  { mentionName: string },
  SerializedTextNode
>;

function $convertMentionElement(
  domNode: HTMLElement,
): DOMConversionOutput | null {
  const textContent = domNode.textContent;

  if (textContent !== null) {
    const node = $createMentionNode(textContent);
    return {
      node,
    };
  }

  return null;
}

const mentionStyle = "background-color: rgba(24, 119, 232, 0.2)";

const mentionFields = {
  ...storedTextFields(storedValue<string>()),
  mentionName: withField(storedValue<string>(), { field: "__mention" }),
};

/** @internal What {@link mentionFields} write, which {@link SerializedMentionNode} is checked against. */
export type MentionFieldsJSON = SchemaJSON<typeof mentionFields>;

const mentionSchema = nodeSchema<MentionNode>()(mentionFields);

export class MentionNode extends TextNode {
  __mention: string;

  $config() {
    return this.config("mention", { extends: TextNode, json: mentionSchema });
  }

  constructor(mentionName = "", text?: string, key?: NodeKey) {
    super(text ?? mentionName, key);
    this.__mention = mentionName;
  }

  exportJSON(): SerializedTextNode {
    return inStoredOrder(super.exportJSON(), ["mentionName"]);
  }

  updateFromJSON(json: LexicalParseJSON<SerializedLexicalNode>): this {
    return super.updateFromJSON(withoutNodeState(json));
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.style.cssText = mentionStyle;
    dom.className = "mention";
    return dom;
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute("data-lexical-mention", "true");
    element.textContent = this.__text;
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute("data-lexical-mention")) {
          return null;
        }
        return {
          conversion: $convertMentionElement,
          priority: 1,
        };
      },
    };
  }

  isTextEntity(): true {
    return true;
  }

  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }
}

export function $createMentionNode(mentionName: string): MentionNode {
  const mentionNode = new MentionNode(mentionName);
  mentionNode.setMode("segmented").toggleDirectionless();
  return $applyNodeReplacement(mentionNode);
}

export function $isMentionNode(
  node: LexicalNode | null | undefined,
): node is MentionNode {
  return node instanceof MentionNode;
}
