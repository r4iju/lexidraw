import {
  DecoratorBlockNode,
  type SerializedDecoratorBlockNode,
} from "@lexical/react/LexicalDecoratorBlockNode";
import type {
  ElementFormatType,
  Klass,
  LexicalNode,
  NodeKey,
  Spread,
} from "lexical";
import { $create } from "lexical";
import { $importNodeState, figureDOM } from "../figure.js";

export type SerializedFigmaNode = Spread<
  {
    documentID: string;
  },
  SerializedDecoratorBlockNode
>;

export class FigmaNode extends DecoratorBlockNode {
  __id: string;

  static getType(): string {
    return "figma";
  }

  static clone(node: FigmaNode): FigmaNode {
    return new this(node.__id, node.__format, node.__key);
  }

  static importJSON(serializedNode: SerializedFigmaNode): FigmaNode {
    const node = FigmaNode.$createFigmaNode(serializedNode.documentID);
    node.setFormat(serializedNode.format);
    return $importNodeState(node, serializedNode);
  }

  exportJSON(): SerializedFigmaNode {
    return {
      ...super.exportJSON(),
      documentID: this.__id,
      type: "figma",
      version: 1,
    };
  }

  constructor(id = "", format?: ElementFormatType, key?: NodeKey) {
    super(format, key);
    this.__id = id;
  }

  createDOM(): HTMLElement {
    const element = super.createDOM();
    figureDOM(this, element);
    return element;
  }

  // The base class declares no parameters, though Lexical passes them.
  updateDOM(_prevNode?: FigmaNode, dom?: HTMLElement): false {
    if (dom) figureDOM(this, dom);
    return false;
  }

  getId(): string {
    return this.__id;
  }

  getTextContent(
    _includeInert?: boolean | undefined,
    _includeDirectionless?: false | undefined,
  ): string {
    return `https://www.figma.com/file/${this.__id}`;
  }

  static $createFigmaNode<T extends FigmaNode>(
    this: Klass<T>,
    documentID: string,
  ): T {
    const node = $create(this);
    node.__id = documentID;
    return node;
  }

  static $isFigmaNode<T extends FigmaNode>(
    this: Klass<T>,

    node: FigmaNode | LexicalNode | null | undefined,
  ): node is T {
    return node instanceof FigmaNode;
  }
}
