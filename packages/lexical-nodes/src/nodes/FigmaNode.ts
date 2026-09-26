import {
  DecoratorBlockNode,
  type SerializedDecoratorBlockNode,
} from "@lexical/react/LexicalDecoratorBlockNode";
import {
  $create,
  type ElementFormatType,
  type Klass,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  type Spread,
  withField,
} from "lexical";
import { type SchemaJSON, storedValue } from "../schema-values.js";
import { figureDOM, figureState } from "../figure.js";
import {
  type ImportJSON,
  storedFields,
  withStoredJSON,
  written,
} from "../stored-fields.js";
import { storedBlockFields } from "./stored-block.js";

const { fields: figmaFields, json: figmaJSON } = storedFields({
  ...storedBlockFields,
  type: written,
  version: written,
  $: written,
  documentID: withField(storedValue<string>(), { field: "__id" }),
});

export type SerializedFigmaNode = Spread<
  SchemaJSON<typeof figmaJSON>,
  SerializedDecoratorBlockNode
>;

const figmaSchema = nodeSchema<FigmaNode>()(figmaFields);

export class FigmaNode extends DecoratorBlockNode {
  declare static importJSON: ImportJSON<FigmaNode>;
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

withStoredJSON(FigmaNode);
