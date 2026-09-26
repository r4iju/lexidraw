import {
  type EditorConfig,
  type LexicalNode,
  type LexicalParseJSON,
  nodeSchema,
  type SerializedLexicalNode,
  type SerializedTextNode,
  TextNode,
} from "lexical";
import { withoutNodeState } from "../stored-order.js";
import { storedTextFields, textOrEmpty } from "./stored-text.js";

export type SerializedKeywordNode = SerializedTextNode;

const keywordSchema = nodeSchema<KeywordNode>()(storedTextFields(textOrEmpty));

export class KeywordNode extends TextNode {
  $config() {
    return this.config("keyword", { extends: TextNode, json: keywordSchema });
  }

  updateFromJSON(json: LexicalParseJSON<SerializedLexicalNode>): this {
    return super.updateFromJSON(withoutNodeState(json));
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.style.cursor = "default";
    dom.className = "keyword";
    return dom;
  }

  canInsertTextBefore(): boolean {
    return false;
  }

  canInsertTextAfter(): boolean {
    return false;
  }

  isTextEntity(): true {
    return true;
  }
}

export function $createKeywordNode(keyword: string): KeywordNode {
  return new KeywordNode(keyword);
}

export function $isKeywordNode(node: LexicalNode | null | undefined): boolean {
  return node instanceof KeywordNode;
}
