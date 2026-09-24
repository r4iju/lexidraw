import { CodeNode, type SerializedCodeNode } from "@lexical/code";
import {
  $create,
  setDOMUnmanaged,
  type EditorConfig,
  type NodeKey,
} from "lexical";

export class DocumentCodeNode extends CodeNode {
  __showLineNumbers = false;

  static getType() {
    return "code";
  }
  static clone(node: DocumentCodeNode) {
    return new DocumentCodeNode(node.__language, node.__key);
  }
  constructor(language?: string | null, key?: NodeKey) {
    super(language, key);
  }
  afterCloneFrom(previous: this) {
    super.afterCloneFrom(previous);
    this.__showLineNumbers = previous.__showLineNumbers;
  }
  static importJSON(
    serialized: SerializedCodeNode & { showLineNumbers?: boolean },
  ) {
    const node = $create(DocumentCodeNode).updateFromJSON(serialized);
    node.setShowLineNumbers(serialized.showLineNumbers ?? false);
    node.setStyle("");
    return node;
  }
  exportJSON(): SerializedCodeNode & { showLineNumbers: boolean } {
    const { theme: _theme, ...json } = super.exportJSON();
    return { ...json, showLineNumbers: this.getShowLineNumbers() };
  }
  // Syntax colours are presentation; legacy saved themes must not override the page.
  getTheme() {
    return "none";
  }
  setTheme(_theme?: string) {
    return this;
  }
  getShowLineNumbers() {
    return this.getLatest().__showLineNumbers;
  }
  setShowLineNumbers(value: boolean) {
    this.getWritable().__showLineNumbers = value;
    return this;
  }
  createDOM(config: EditorConfig) {
    const body = super.createDOM(config);
    body.className = "document-code-body";
    body.removeAttribute("data-theme");
    const wrapper = document.createElement("div");
    wrapper.className = "document-code";
    wrapper.dataset.lineNumbers = String(this.getShowLineNumbers());
    const header = document.createElement("div");
    header.className = "document-code-header";
    header.contentEditable = "false";
    setDOMUnmanaged(header, { captureSelection: true });
    wrapper.append(header, body);
    return wrapper;
  }
  getDOMSlot(element: HTMLElement) {
    const body = element.querySelector<HTMLElement>(".document-code-body");
    if (!body) throw new Error("Missing code content slot");
    return super.getDOMSlot(element).withElement(body);
  }
  updateDOM(previous: this, element: HTMLElement, config: EditorConfig) {
    const body = this.getDOMSlot(element).element;
    super.updateDOM(previous, body, config);
    body.removeAttribute("data-theme");
    element.dataset.lineNumbers = String(this.getShowLineNumbers());
    return false;
  }
}
