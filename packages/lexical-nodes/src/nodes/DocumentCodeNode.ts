import { CodeNode, type SerializedCodeNode } from "@lexical/code";
import {
  booleanValue,
  type EditorConfig,
  enumValue,
  nodeSchema,
  setDOMUnmanaged,
  withAccessors,
  withField,
} from "lexical";

const documentCodeSchema = nodeSchema<DocumentCodeNode>()({
  showLineNumbers: withField(booleanValue(), { field: "__showLineNumbers" }),
  // Syntax colours are presentation: a theme saved with the code must not
  // override the page's, so none is kept.
  theme: withAccessors(enumValue([undefined]), {
    getter: "getThemeJSON",
    setter: null,
  }),
});

export class DocumentCodeNode extends CodeNode {
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
  exportJSON(): Omit<SerializedCodeNode, "theme"> & {
    showLineNumbers: boolean;
  } {
    const { theme: _theme, ...json } =
      super.exportJSON() as SerializedCodeNode & {
        showLineNumbers: boolean;
      };
    return json;
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
