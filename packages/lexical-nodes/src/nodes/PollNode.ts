import {
  $create,
  arrayValue,
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type Klass,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  objectValue,
  type SerializedLexicalNode,
  type Spread,
  stringValue,
  withField,
} from "lexical";
import { type SchemaJSON, shapedAs, storedValue } from "../schema-values.js";
import {
  type ImportJSON,
  storedFields,
  withStoredJSON,
  written,
} from "../stored-fields.js";

export type Options = readonly Option[];

export type Option = Readonly<{
  text: string;
  uid: string;
  votes: string[];
}>;

const { fields: pollFields, json: pollJSON } = storedFields({
  options: withField(
    shapedAs(
      arrayValue(
        objectValue({
          text: stringValue(),
          uid: stringValue(),
          votes: arrayValue(stringValue()),
        }),
      ),
      storedValue<Options>(),
    ),
    { field: "__options" },
  ),
  question: withField(storedValue<string>(), { field: "__question" }),
  type: written,
  version: written,
});

export type SerializedPollNode = Spread<
  SchemaJSON<typeof pollJSON>,
  SerializedLexicalNode
>;

const pollSchema = nodeSchema<PollNode>()(pollFields);

export class PollNode extends DecoratorNode<unknown> {
  declare static importJSON: ImportJSON<PollNode>;
  __question: string;
  __options: Options;

  $config() {
    return this.config("poll", { extends: DecoratorNode, json: pollSchema });
  }

  static $convertPollElement(domNode: HTMLElement): DOMConversionOutput | null {
    const question = domNode.getAttribute("data-lexical-poll-question");
    const options = domNode.getAttribute("data-lexical-poll-options");
    if (question !== null && options !== null) {
      const node = PollNode.$createPollNode(question, JSON.parse(options));
      return { node };
    }
    return null;
  }

  static cloneOption(option: Option, text: string, votes?: string[]): Option {
    return {
      text,
      uid: option.uid,
      votes: votes || Array.from(option.votes),
    };
  }

  constructor(question = "", options: Options = [], key?: NodeKey) {
    super(key);
    this.__question = question;
    this.__options = options;
  }

  getQuestion(): string {
    return this.__question;
  }

  addOption(option: Option): void {
    const self = this.getWritable();
    const options = Array.from(self.__options);
    options.push(option);
    self.__options = options;
  }

  deleteOption(option: Option): void {
    const self = this.getWritable();
    const options = Array.from(self.__options);
    const index = options.indexOf(option);
    options.splice(index, 1);
    self.__options = options;
  }

  setOptionText(option: Option, text: string): void {
    const self = this.getWritable();
    const clonedOption = PollNode.cloneOption(option, text);
    const options = Array.from(self.__options);
    const index = options.indexOf(option);
    options[index] = clonedOption;
    self.__options = options;
  }

  toggleVote(option: Option, clientID: string): void {
    const self = this.getWritable();
    const votes = option.votes;
    const votesClone = Array.from(votes);
    const voteIndex = votes.indexOf(clientID);
    if (voteIndex === -1) {
      votesClone.push(clientID);
    } else {
      votesClone.splice(voteIndex, 1);
    }
    const clonedOption = PollNode.cloneOption(option, option.text, votesClone);
    const options = Array.from(self.__options);
    const index = options.indexOf(option);
    options[index] = clonedOption;
    self.__options = options;
  }

  static importDOM(): DOMConversionMap | null {
    return {
      span: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute("data-lexical-poll-question")) {
          return null;
        }
        return {
          conversion: PollNode.$convertPollElement,
          priority: 2,
        };
      },
    };
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("span");
    element.setAttribute("data-lexical-poll-question", this.__question);
    element.setAttribute(
      "data-lexical-poll-options",
      JSON.stringify(this.__options),
    );
    return { element };
  }

  createDOM(): HTMLElement {
    const elem = document.createElement("div");
    elem.dataset.mediaType = "poll";
    return elem;
  }

  updateDOM(): false {
    return false;
  }

  static createUID(): string {
    return Math.random()
      .toString(36)
      .replace(/[^a-z]+/g, "")
      .substring(0, 5);
  }

  static createPollOption(text = ""): Option {
    return {
      text,
      uid: PollNode.createUID(),
      votes: [],
    };
  }

  static $createPollNode<T extends PollNode>(
    this: Klass<T>,
    question: string,
    options: Options,
  ): T {
    const node = $create(this);
    node.__question = question;
    node.__options = options;
    return node;
  }

  static $isPollNode<T extends PollNode>(
    this: Klass<T>,
    node: LexicalNode | null | undefined,
  ): node is T {
    return node instanceof PollNode;
  }
}

withStoredJSON(PollNode);
