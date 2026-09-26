import {
  type EditorConfig,
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
import { storedTextFields, textOrEmpty } from "./stored-text.js";

export type SerializedAutocompleteNode = Spread<
  { uuid: string },
  SerializedTextNode
>;

const autocompleteFields = {
  ...storedTextFields(textOrEmpty),
  uuid: withField(storedValue<string>(), { field: "__uuid" }),
};

/** @internal What {@link autocompleteFields} write, which {@link SerializedAutocompleteNode} is checked against. */
export type AutocompleteFieldsJSON = SchemaJSON<typeof autocompleteFields>;

const autocompleteSchema = nodeSchema<AutocompleteNode>()(autocompleteFields);

export class AutocompleteNode extends TextNode {
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

  exportJSON(): SerializedTextNode {
    return inStoredOrder(super.exportJSON(), ["uuid"]);
  }

  updateFromJSON(json: LexicalParseJSON<SerializedLexicalNode>): this {
    return super.updateFromJSON(withoutNodeState(json));
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
