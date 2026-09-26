import {
  type EditorConfig,
  type LexicalNode,
  type SerializedTextNode,
  TextNode,
} from "lexical";

export type SerializedKeywordNode = SerializedTextNode;

export class KeywordNode extends TextNode {
  $config() {
    return this.config("keyword", { extends: TextNode });
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
