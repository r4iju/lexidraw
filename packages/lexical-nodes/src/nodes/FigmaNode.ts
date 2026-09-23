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
    return node;
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

  updateDOM(): false {
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
