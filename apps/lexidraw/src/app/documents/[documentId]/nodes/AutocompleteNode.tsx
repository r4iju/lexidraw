import { TextNode, type EditorConfig, type NodeKey } from "lexical";
import type { SerializedTextNode, Spread } from "lexical";

export type SerializedAutocompleteNode = Spread<
  {
    uuid: string;
  },
  SerializedTextNode
>;

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

  static getType(): "autocomplete" {
    return "autocomplete";
  }

  static clone(node: AutocompleteNode): AutocompleteNode {
    return new AutocompleteNode(node.__text, node.__uuid, node.__key);
  }

  static importJSON(
    serializedNode: SerializedAutocompleteNode,
  ): AutocompleteNode {
    const node = AutocompleteNode.$createAutocompleteNode(
      serializedNode.text,
      serializedNode.uuid,
    );
    node.setFormat(serializedNode.format);
    node.setDetail(serializedNode.detail);
    node.setMode(serializedNode.mode);
    node.setStyle(serializedNode.style);
    return node;
  }

  exportJSON(): SerializedAutocompleteNode {
    return {
      ...super.exportJSON(),
      type: AutocompleteNode.getType(),
      uuid: this.__uuid,
      version: 1,
    };
  }

  constructor(text: string, uuid: string, key?: NodeKey) {
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
