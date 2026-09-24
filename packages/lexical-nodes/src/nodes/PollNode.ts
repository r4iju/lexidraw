import {
  $create,
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
  type Klass,
} from "lexical";

export type Options = readonly Option[];

export type Option = Readonly<{
  text: string;
  uid: string;
  votes: string[];
}>;

export type SerializedPollNode = Spread<
  {
    question: string;
    options: Options;
  },
  SerializedLexicalNode
>;

export class PollNode extends DecoratorNode<unknown> {
  __question: string;
  __options: Options;

  static getType(): string {
    return "poll";
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

  static clone(node: PollNode): PollNode {
    return new this(node.__question, node.__options, node.__key);
  }

  static importJSON(s: SerializedPollNode): PollNode {
    return PollNode.$createPollNode(s.question, s.options);
  }

  constructor(question = "", options: Options = [], key?: NodeKey) {
    super(key);
    this.__question = question;
    this.__options = options;
  }

  exportJSON(): SerializedPollNode {
    return {
      options: this.__options,
      question: this.__question,
      type: "poll",
      version: 1,
    };
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
