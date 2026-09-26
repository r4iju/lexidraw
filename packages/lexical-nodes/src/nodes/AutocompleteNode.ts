import {
  type EditorConfig,
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
import { storedTextFields, textOrEmpty } from "./stored-text.js";

const { fields: autocompleteFields, json: autocompleteJSON } = storedFields({
  ...storedTextFields(textOrEmpty),
  type: written,
  version: written,
  uuid: withField(storedValue<string>(), { field: "__uuid" }),
});

export type SerializedAutocompleteNode = Spread<
  SchemaJSON<typeof autocompleteJSON>,
  SerializedTextNode
>;

const autocompleteSchema = nodeSchema<AutocompleteNode>()(autocompleteFields);

export class AutocompleteNode extends TextNode {
  declare static importJSON: ImportJSON<AutocompleteNode>;
  /**
   * A unique uuid is generated for each session and assigned to the instance.
   * This helps to:
   * - Ensures max one Autocomplete node per session.
   * - Ensure that when collaboration is enabled, this node is not shown in
   *   other sessions.
   * See https://github.com/facebook/lexical/blob/master/packages/lexical-playground/src/plugins/AutocompletePlugin/index.tsx#L39
   */
  __uuid: string;

  $config() {
    return this.config("autocomplete", {
      extends: TextNode,
      json: autocompleteSchema,
    });
  }

  constructor(text = "", uuid = "", key?: NodeKey) {
    super(text, key);
    this.__uuid = uuid;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.classList.add(config.theme.autocomplete);
    // Instead of comparing to a module-level UUID,
    // add the node's uuid as a data attribute.
    dom.setAttribute("data-session-uuid", this.__uuid);
    return dom;
  }

  updateDOM(_prevNode: AutocompleteNode, _dom: HTMLElement): boolean {
    // no changes needed after initial creation
    return false;
  }

  excludeFromCopy() {
    return true;
  }

  static $createAutocompleteNode(text: string, uuid: string): AutocompleteNode {
    // We set the node to 'token' mode (read-only, basically),
    // so user can't directly edit it.
    return new AutocompleteNode(text, uuid).setMode("token");
  }
}

withStoredJSON(AutocompleteNode);
