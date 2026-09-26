import {
  type EditorConfig,
  type LexicalNode,
  nodeSchema,
  type SerializedTextNode,
  type Spread,
  TextNode,
} from "lexical";
import type { SchemaJSON } from "../schema-values.js";
import {
  type ImportJSON,
  storedFields,
  withStoredJSON,
  written,
} from "../stored-fields.js";
import { storedTextFields, textOrEmpty } from "./stored-text.js";

const { fields: keywordFields, json: keywordJSON } = storedFields({
  ...storedTextFields(textOrEmpty),
  type: written,
  version: written,
});

export type SerializedKeywordNode = Spread<
  SchemaJSON<typeof keywordJSON>,
  SerializedTextNode
>;

const keywordSchema = nodeSchema<KeywordNode>()(keywordFields);

export class KeywordNode extends TextNode {
  declare static importJSON: ImportJSON<KeywordNode>;

  $config() {
    return this.config("keyword", { extends: TextNode, json: keywordSchema });
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

withStoredJSON(KeywordNode);

export function $createKeywordNode(keyword: string): KeywordNode {
  return new KeywordNode(keyword);
}

export function $isKeywordNode(node: LexicalNode | null | undefined): boolean {
  return node instanceof KeywordNode;
}
