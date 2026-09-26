import { CodeNode, type SerializedCodeNode } from "@lexical/code";
import {
  type EditorConfig,
  enumValue,
  nodeSchema,
  optional,
  setDOMUnmanaged,
  stringValue,
  withAccessors,
  withField,
} from "lexical";
import { namedTransform, rawValueOr } from "../schema-values.js";
import { inStoredOrder } from "../stored-order.js";

const documentCodeSchema = nodeSchema<DocumentCodeNode>()({
  // CodeNode's schema reads a language as a string or null, where its setter
  // then holds an empty one, or null, as none.
  language: withAccessors(
    optional(
      namedTransform(
        "emptyAbsent",
        stringValue(),
        (language) => language || undefined,
      ),
    ),
    { getter: { field: "__language" }, setter: "setLanguage" },
  ),
  showLineNumbers: withField(rawValueOr(false, { nullAsAbsent: true }), {
    field: "__showLineNumbers",
  }),
  // Syntax colours are presentation: a theme saved with the code must not
  // override the page's, so none is kept.
  theme: withAccessors(enumValue([undefined]), {
    getter: "getThemeJSON",
    setter: null,
  }),
});

export class DocumentCodeNode extends CodeNode {
  /** CodeNode's constructor and setter both store a language as `|| undefined`. */
  declare __language: string | undefined;
  __showLineNumbers = false;

  $config() {
    return this.config("code", {
      extends: CodeNode,
      json: documentCodeSchema,
    });
  }
  getThemeJSON(): undefined {
    return undefined;
  }
  /** Lexical writes the absent theme as an undefined key, which code never had. */
  exportJSON(): SerializedCodeNode {
    const { theme: _theme, ...json } = super.exportJSON();
    return inStoredOrder(json, ["showLineNumbers"]);
  }
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
