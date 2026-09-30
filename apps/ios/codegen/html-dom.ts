import { selectAll, selectOne, is, type Options } from "css-select";
import { parse as parseCSS, CSSStyleRule } from "rrweb-cssom";
Object.assign(globalThis, {
  CSSStyleRule,
  HTMLImageElement: {
    [Symbol.hasInstance](node: unknown) {
      return node instanceof NativeDOMNode && node.nodeName === "IMG";
    },
  },
});
import parse from "postcss-safe-parser";
import { CSSStyleDeclaration } from "cssstyle";
export interface DOMData {
  name: string;
  text?: string;
  attributes?: Record<string, string>;
  children?: DOMData[];
}

/** Inert DOM adapter for the operations importDOM reads. Unknown reads fail
 * rather than inventing browser behavior when a converter changes. */
export class NativeDOMNode {
  readonly nodeType: number;
  readonly nodeName: string;
  readonly childNodes: NativeDOMNode[];
  readonly attributes: Record<string, string>;
  readonly style: CSSStyleDeclaration;
  readonly dataset: Record<string, string>;
  readonly classList: { contains: (name: string) => boolean };
  private constructor(
    private data: DOMData,
    public parentNode: NativeDOMNode | null = null,
  ) {
    this.nodeType =
      data.name === "#text" ? 3 : data.name === "#document" ? 9 : 1;
    this.nodeName = data.name === "#text" ? "#text" : data.name.toUpperCase();
    this.attributes = data.attributes ?? {};
    this.childNodes = [];
    this.style = new CSSStyleDeclaration();
    const declarations = parse(`a { ${this.attributes.style ?? ""} }`);
    declarations.walkDecls((declaration) => {
      const property = declaration.prop.startsWith("--")
        ? declaration.prop
        : declaration.prop.toLowerCase();
      if (
        this.style.getPropertyPriority(property) === "important" &&
        !declaration.important
      )
        return;
      this.style.setProperty(
        property,
        declaration.value,
        declaration.important ? "important" : "",
      );
    });
    this.dataset = Object.fromEntries(
      Object.entries(this.attributes)
        .filter(([name]) => name.startsWith("data-"))
        .map(([name, value]) => [
          name
            .slice(5)
            .replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase()),
          value,
        ]),
    );
    this.classList = {
      contains: (name) =>
        (this.attributes.class ?? "").split(/\s+/).includes(name),
    };
  }
  static create(
    data: DOMData,
    parent: NativeDOMNode | null = null,
  ): NativeDOMNode {
    const target = new NativeDOMNode(data, parent);
    const proxy = new Proxy(target, {
      get(target, key, receiver) {
        if (!(key in target))
          throw new Error(`Unsupported HTML DOM API ${String(key)} (#168)`);
        return Reflect.get(target, key, receiver);
      },
    });
    proxy.childNodes.push(
      ...(data.children ?? []).map((child) =>
        NativeDOMNode.create(child, proxy),
      ),
    );
    return proxy;
  }
  get tagName() {
    return this.nodeName;
  }
  get parentElement() {
    return this.parentNode;
  }
  get children() {
    return this.childNodes.filter((node) => node.nodeType === 1);
  }
  get firstChild(): NativeDOMNode | null {
    return this.childNodes[0] ?? null;
  }
  get lastChild(): NativeDOMNode | null {
    return this.childNodes.at(-1) ?? null;
  }
  get previousSibling(): NativeDOMNode | null {
    return (
      this.parentNode?.childNodes[
        this.parentNode.childNodes.indexOf(this) - 1
      ] ?? null
    );
  }
  get nextSibling(): NativeDOMNode | null {
    return (
      this.parentNode?.childNodes[
        this.parentNode.childNodes.indexOf(this) + 1
      ] ?? null
    );
  }
  get textContent(): string {
    return (
      this.data.text ?? this.childNodes.map((node) => node.textContent).join("")
    );
  }
  get src() {
    return this.attributes.src ?? "";
  }
  get alt() {
    return this.attributes.alt ?? "";
  }
  get width() {
    return Math.max(0, Number.parseInt(this.attributes.width ?? "0", 10) || 0);
  }
  get height() {
    return Math.max(0, Number.parseInt(this.attributes.height ?? "0", 10) || 0);
  }
  get start() {
    // HTML's signed-integer parser accepts ASCII whitespace and a decimal
    // prefix. The reflected long defaults to 1 when absent, invalid or outside
    // Int32, while zero and negative values are valid list starts.
    const digits = /^[\t\n\f\r ]*[+-]?\d+/.exec(this.attributes.start ?? "");
    const value = digits ? Number.parseInt(digits[0], 10) : NaN;
    return value >= -2147483648 && value <= 2147483647 ? value : 1;
  }
  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }
  hasAttribute(name: string) {
    return name in this.attributes;
  }
  get body() {
    return this.querySelector("body");
  }
  get styleSheets() {
    return this.querySelectorAll("style").map((node) =>
      parseCSS(node.textContent),
    );
  }
  get colSpan() {
    return Math.max(
      1,
      Number.parseInt(this.attributes.colspan ?? "1", 10) || 1,
    );
  }
  get rowSpan() {
    return Math.max(
      0,
      Number.parseInt(this.attributes.rowspan ?? "1", 10) || 0,
    );
  }
  get cellIndex() {
    return this.parentNode?.children.indexOf(this) ?? -1;
  }
  get rowIndex() {
    let table: NativeDOMNode | null = this.parentNode;
    while (table && table.nodeName !== "TABLE") table = table.parentNode;
    return table?.querySelectorAll("tr").indexOf(this) ?? -1;
  }
  closest(selector: string): NativeDOMNode | null {
    let node: NativeDOMNode | null = this;
    while (node) {
      if (is(node, selector, { adapter })) return node;
      node = node.parentNode;
    }
    return null;
  }
  querySelector(selector: string) {
    return selectOne(selector, this.childNodes, { adapter, context: this });
  }
  querySelectorAll(selector: string): NativeDOMNode[] {
    return selectAll(selector, this.childNodes, { adapter, context: this });
  }
}
const adapter: NonNullable<Options<NativeDOMNode, NativeDOMNode>["adapter"]> = {
  isTag: (node): node is NativeDOMNode => node.nodeType === 1,
  getChildren: (node) => node.childNodes,
  getParent: (node) => node.parentNode,
  getSiblings: (node) => node.parentNode?.childNodes ?? [node],
  getName: (node) => node.nodeName.toLowerCase(),
  getAttributeValue: (node, name) => node.attributes[name],
  hasAttrib: (node, name) => node.hasAttribute(name),
  getText: (node) => node.textContent,
  removeSubsets(nodes) {
    return nodes.filter(
      (node) =>
        !nodes.some((parent) => parent !== node && contains(parent, node)),
    );
  },
};
function contains(parent: NativeDOMNode, node: NativeDOMNode): boolean {
  return (
    node.parentNode !== null &&
    (node.parentNode === parent || contains(parent, node.parentNode))
  );
}
