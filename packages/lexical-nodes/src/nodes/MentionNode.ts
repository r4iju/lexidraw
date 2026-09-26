import {
  $applyNodeReplacement,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  type SerializedTextNode,
  type Spread,
  TextNode,
  withField,
} from "lexical";
import { type SchemaJSON, storedValue } from "../schema-values.js";
import {
  type ImportJSON,
  storedFields,
  withStoredJSON,
  written,
} from "../stored-fields.js";
import { storedTextFields } from "./stored-text.js";

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

const { fields: mentionFields, json: mentionJSON } = storedFields({
  ...storedTextFields(storedValue<string>()),
  type: written,
  version: written,
  mentionName: withField(storedValue<string>(), { field: "__mention" }),
});

export type SerializedMentionNode = Spread<
  SchemaJSON<typeof mentionJSON>,
  SerializedTextNode
>;

const mentionSchema = nodeSchema<MentionNode>()(mentionFields);

export class MentionNode extends TextNode {
  declare static importJSON: ImportJSON<MentionNode>;
  __mention: string;

  $config() {
    return this.config("mention", { extends: TextNode, json: mentionSchema });
  }

  constructor(mentionName = "", text?: string, key?: NodeKey) {
    super(text ?? mentionName, key);
    this.__mention = mentionName;
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

withStoredJSON(MentionNode);
