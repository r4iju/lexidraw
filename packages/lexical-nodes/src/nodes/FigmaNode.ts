import {
  DecoratorBlockNode,
  type SerializedDecoratorBlockNode,
} from "@lexical/react/LexicalDecoratorBlockNode";
import {
  $create,
  type ElementFormatType,
  type Klass,
  type LexicalNode,
  type LexicalParseJSON,
  type NodeKey,
  nodeSchema,
  type Spread,
  withField,
} from "lexical";
import { type SchemaJSON, storedValue } from "../schema-values.js";
import { figureDOM, figureState } from "../figure.js";
import { inStoredOrder } from "../stored-order.js";
import { storedBlockFields, withStoredBlockFormat } from "./stored-block.js";

export type SerializedFigmaNode = Spread<
  { documentID: string },
  SerializedDecoratorBlockNode
>;

const figmaFields = {
  ...storedBlockFields,
  documentID: withField(storedValue<string>(), { field: "__id" }),
};

/** @internal What {@link figmaFields} write, which {@link SerializedFigmaNode} is checked against. */
export type FigmaFieldsJSON = SchemaJSON<typeof figmaFields>;

const figmaSchema = nodeSchema<FigmaNode>()(figmaFields);

export class FigmaNode extends DecoratorBlockNode {
  __id: string;

  $config() {
    return this.config("figma", {
      extends: DecoratorBlockNode,
      json: figmaSchema,
      stateConfigs: [figureState],
    });
  }

  constructor(id = "", format?: ElementFormatType, key?: NodeKey) {
    super(format, key);
    this.__id = id;
  }

  updateFromJSON(json: LexicalParseJSON<SerializedDecoratorBlockNode>): this {
    return super.updateFromJSON(withStoredBlockFormat(json));
  }

  exportJSON(): SerializedDecoratorBlockNode {
    return inStoredOrder(super.exportJSON(), ["documentID"]);
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
