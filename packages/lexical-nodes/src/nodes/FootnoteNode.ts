import {
  $getRoot,
  $isElementNode,
  $create,
  DecoratorNode,
  type DOMExportOutput,
  type ElementDOMSlot,
  ElementNode,
  type Klass,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";

/** The fragment ids a footnote and its first marker link to each other by. */
export const footnoteId = (label: string) => `fn-${label}`;
export const footnoteReferenceId = (label: string) => `fnref-${label}`;

export type SerializedFootnoteReferenceNode = Spread<
  { label: string },
  SerializedLexicalNode
>;

/**
 * A footnote marker, `[^label]` in markdown. The label is how the markdown
 * names the note; the number a reader sees is the note's place among the
 * notes, which the editor's subclass works out.
 */
export class FootnoteReferenceNode extends DecoratorNode<unknown> {
  __label: string;

  static getType(): string {
    return "footnote-reference";
  }

  static clone(node: FootnoteReferenceNode): FootnoteReferenceNode {
    return new this(node.__label, node.__key);
  }

  constructor(label = "", key?: NodeKey) {
    super(key);
    this.__label = label;
  }

  static importJSON(
    serializedNode: SerializedFootnoteReferenceNode,
  ): FootnoteReferenceNode {
    return FootnoteReferenceNode.$createFootnoteReferenceNode(
      serializedNode.label,
    ).updateFromJSON(serializedNode);
  }

  exportJSON(): SerializedFootnoteReferenceNode {
    return {
      ...super.exportJSON(),
      label: this.getLabel(),
      type: "footnote-reference",
      version: 1,
    };
  }

  createDOM(): HTMLElement {
    const element = document.createElement("sup");
    element.className = "footnote-ref";
    return element;
  }

  updateDOM(): false {
    return false;
  }

  exportDOM(): DOMExportOutput {
    const sup = document.createElement("sup");
    const link = document.createElement("a");
    link.href = `#${footnoteId(this.__label)}`;
    link.textContent = this.__label;
    sup.append(link);
    return { element: sup };
  }

  isInline(): true {
    return true;
  }

  getTextContent(): string {
    return "";
  }

  getLabel(): string {
    return this.getLatest().__label;
  }

  decorate(): unknown {
    return null;
  }

  static $createFootnoteReferenceNode<T extends FootnoteReferenceNode>(
    this: Klass<T>,
    label: string,
  ): T {
    const node = $create(this);
    node.__label = label;
    return node;
  }

  static $isFootnoteReferenceNode(
    node: LexicalNode | null | undefined,
  ): node is FootnoteReferenceNode {
    return node instanceof FootnoteReferenceNode;
  }
}

export type SerializedFootnoteDefinitionNode = Spread<
  { label: string },
  SerializedElementNode
>;

/**
 * The note itself, `[^label]: text` in markdown. Its number is drawn by a
 * CSS counter over the notes, which sit together at the end of the document
 * in the order their markers first appear.
 */
function footnoteDOM(label: string) {
  const root = document.createElement("div");
  root.className = "footnote";
  root.id = footnoteId(label);
  const number = document.createElement("span");
  number.className = "footnote-number";
  number.contentEditable = "false";
  number.setAttribute("aria-hidden", "true");
  const body = document.createElement("span");
  body.className = "footnote-body";
  const back = document.createElement("a");
  back.className = "footnote-backref";
  back.contentEditable = "false";
  back.href = `#${footnoteReferenceId(label)}`;
  back.setAttribute("aria-label", "Back to the text");
  // Text presentation: without the selector the arrow draws as an emoji.
  back.textContent = "↩\uFE0E";
  root.append(number, body, back);
  return { root, body, back };
}

export class FootnoteDefinitionNode extends ElementNode {
  __label: string;

  static getType(): string {
    return "footnote-definition";
  }

  static clone(node: FootnoteDefinitionNode): FootnoteDefinitionNode {
    return new FootnoteDefinitionNode(node.__label, node.__key);
  }

  constructor(label = "", key?: NodeKey) {
    super(key);
    this.__label = label;
  }

  createDOM(): HTMLElement {
    return footnoteDOM(this.__label).root;
  }

  getDOMSlot(element: HTMLElement): ElementDOMSlot<HTMLElement> {
    const body = element.querySelector<HTMLElement>(":scope > .footnote-body");
    return super.getDOMSlot(element).withElement(body ?? element);
  }

  updateDOM(prevNode: FootnoteDefinitionNode, dom: HTMLElement): boolean {
    if (prevNode.__label !== this.__label) {
      dom.id = footnoteId(this.__label);
      const back = dom.querySelector<HTMLAnchorElement>(
        ":scope > .footnote-backref",
      );
      if (back) back.href = `#${footnoteReferenceId(this.__label)}`;
    }
    return false;
  }

  exportDOM(): DOMExportOutput {
    const { root, body, back } = footnoteDOM(this.__label);
    back.removeAttribute("contenteditable");
    return { element: root, append: (child) => body.append(child) };
  }

  static importJSON(
    json: SerializedFootnoteDefinitionNode,
  ): FootnoteDefinitionNode {
    return FootnoteDefinitionNode.$createFootnoteDefinitionNode(
      typeof json.label === "string" ? json.label : "",
    ).updateFromJSON(json);
  }

  exportJSON(): SerializedFootnoteDefinitionNode {
    return {
      ...super.exportJSON(),
      label: this.getLabel(),
      type: "footnote-definition",
      version: 1,
    };
  }

  getLabel(): string {
    return this.getLatest().__label;
  }

  static $createFootnoteDefinitionNode(label: string): FootnoteDefinitionNode {
    return new FootnoteDefinitionNode(label);
  }

  static $isFootnoteDefinitionNode(
    node: LexicalNode | null | undefined,
  ): node is FootnoteDefinitionNode {
    return node instanceof FootnoteDefinitionNode;
  }
}

function $referencesInOrder(): FootnoteReferenceNode[] {
  const found: FootnoteReferenceNode[] = [];
  const visit = (node: LexicalNode) => {
    if (FootnoteReferenceNode.$isFootnoteReferenceNode(node)) found.push(node);
    else if ($isElementNode(node))
      for (const child of node.getChildren()) visit(child);
  };
  visit($getRoot());
  return found;
}

/** The document's notes, in the order they are numbered. */
export function $footnoteDefinitions(): FootnoteDefinitionNode[] {
  return $getRoot()
    .getChildren()
    .filter(FootnoteDefinitionNode.$isFootnoteDefinitionNode);
}

/**
 * Moves every note to the end of the document, in the order its marker
 * first appears, so that a note's number is its place in the list. Notes
 * nothing refers to follow, in the order they were written. Returns the
 * labels of markers with no note.
 */
export function $gatherFootnotes(): string[] {
  const definitions = new Map<string, FootnoteDefinitionNode>();
  for (const definition of $footnoteDefinitions()) {
    if (!definitions.has(definition.getLabel()))
      definitions.set(definition.getLabel(), definition);
  }
  const ordered: FootnoteDefinitionNode[] = [];
  const missing: string[] = [];
  for (const reference of $referencesInOrder()) {
    const label = reference.getLabel();
    const definition = definitions.get(label);
    if (definition) {
      if (!ordered.includes(definition)) ordered.push(definition);
    } else if (!missing.includes(label)) {
      missing.push(label);
    }
  }
  for (const definition of $footnoteDefinitions())
    if (!ordered.includes(definition)) ordered.push(definition);
  const root = $getRoot();
  const current = $footnoteDefinitions();
  const inPlace =
    current.length === ordered.length &&
    current.every((definition, index) => definition.is(ordered[index])) &&
    root
      .getChildren()
      .slice(-ordered.length)
      .every((node, index) => node.is(ordered[index]));
  if (!inPlace && ordered.length > 0) root.append(...ordered);
  return missing;
}
