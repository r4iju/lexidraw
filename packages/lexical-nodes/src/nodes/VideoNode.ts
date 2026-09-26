import {
  $create,
  $createParagraphNode,
  $getRoot,
  createEditor,
  DecoratorNode,
  type DOMConversionMap,
  type DOMConversionOutput,
  type DOMExportOutput,
  type EditorConfig,
  type Klass,
  type LexicalEditor,
  type LexicalNode,
  type NodeKey,
  nodeSchema,
  rawValue,
  type SerializedEditorState,
  type SerializedLexicalNode,
  type SerializedParagraphNode,
  type Spread,
  withAccessors,
  withField,
} from "lexical";
import { figureDOM, figureState } from "../figure.js";
import {
  falseOrStored,
  holdsNodes,
  namedTransform,
  type SchemaJSON,
  storedValue,
} from "../schema-values.js";
import { inStoredOrder } from "../stored-order.js";
import {
  type Size,
  type StoredSizeAccessors,
  storedSizeFields,
  withStoredSize,
} from "./stored-size.js";

const EMPTY_PARAGRAPH: SerializedParagraphNode = {
  children: [],
  direction: null,
  format: "",
  indent: 0,
  textFormat: 0,
  textStyle: "",
  type: "paragraph",
  version: 1,
};

/** The caption a video starts with, as its editor writes it. */
const EMPTY_CAPTION: SerializedEditorState = {
  root: {
    children: [EMPTY_PARAGRAPH],
    direction: null,
    format: "",
    indent: 0,
    type: "root",
    version: 1,
  },
};

/**
 * A caption with something in its root, or the one a video starts with: a
 * caption is never left without its paragraph.
 */
const videoCaptionValue = namedTransform(
  "videoCaption",
  rawValue<unknown>(),
  (value): SerializedEditorState => (holdsNodes(value) ? value : EMPTY_CAPTION),
);

const videoFields = {
  caption: withAccessors(videoCaptionValue, {
    getter: "getCaptionJSON",
    setter: "setCaptionJSON",
  }),
  height: storedSizeFields.height,
  src: withField(storedValue<string>(), { field: "__src" }),
  width: storedSizeFields.width,
  showCaption: withField(falseOrStored, { field: "__showCaption" }),
  captionsEnabled: withField(falseOrStored, { field: "__captionsEnabled" }),
};

/** @internal What {@link videoFields} write, which {@link SerializedVideoNode} is checked against. */
export type VideoFieldsJSON = SchemaJSON<typeof videoFields>;

const videoSchema = nodeSchema<VideoNode>()(videoFields);

export interface VideoPayload {
  caption?: LexicalEditor;
  captionsEnabled?: boolean;
  height?: number;
  src: string;
  width?: number;
  showCaption?: boolean;
}

function convertVideoElement(domNode: Node): null | DOMConversionOutput {
  if (domNode instanceof HTMLVideoElement) {
    const { src, height, width } = domNode;
    const node = VideoNode.$createVideoNode({ src, height, width });
    return { node };
  }
  return null;
}

export type SerializedVideoNode = Spread<
  {
    caption: SerializedEditorState;
    height: number;
    src: string;
    width: number;
    showCaption: boolean;
    captionsEnabled: boolean;
  },
  SerializedLexicalNode
>;

function createCaptionEditor(): LexicalEditor {
  const caption = createEditor();
  try {
    caption.setEditorState(caption.parseEditorState(EMPTY_CAPTION));
  } catch (e) {
    console.error("Error setting initial caption state in constructor:", e);
    caption.update(() => {
      const root = $getRoot();
      if (root.isEmpty()) {
        root.append($createParagraphNode());
      }
    });
  }
  return caption;
}

export interface VideoNode extends StoredSizeAccessors {}

// biome-ignore lint/suspicious/noUnsafeDeclarationMerging: withStoredSize installs the accessors the interface declares.
export class VideoNode extends DecoratorNode<unknown> {
  __src: string;
  __width: Size;
  __height: Size;
  __showCaption: boolean;
  __caption: LexicalEditor;
  __captionsEnabled: boolean;

  $config() {
    return this.config("video", {
      extends: DecoratorNode,
      json: videoSchema,
      stateConfigs: [figureState],
    });
  }

  /** A copy gets a caption editor of its own, holding the same caption. */
  afterCloneFrom(prevNode: this): void {
    super.afterCloneFrom(prevNode);
    this.__src = prevNode.__src;
    this.__width = prevNode.__width;
    this.__height = prevNode.__height;
    this.__showCaption = prevNode.__showCaption;
    this.__captionsEnabled = prevNode.__captionsEnabled;
    const caption = prevNode.__caption.getEditorState();
    if (!caption.isEmpty()) this.__caption.setEditorState(caption.clone());
  }

  getCaptionJSON(): SerializedEditorState {
    return this.__caption.getEditorState().toJSON();
  }

  setCaptionJSON(caption: SerializedEditorState): this {
    try {
      this.__caption.setEditorState(this.__caption.parseEditorState(caption));
    } catch (e) {
      console.error(
        "Error importing caption JSON, falling back to default:",
        e,
      );
      this.__caption.setEditorState(
        this.__caption.parseEditorState(EMPTY_CAPTION),
      );
    }
    return this;
  }

  exportJSON(): SerializedLexicalNode {
    return inStoredOrder(super.exportJSON(), [
      "width",
      "showCaption",
      "captionsEnabled",
      "$",
    ]);
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("video");
    element.setAttribute("src", this.__src);
    if (this.__width && this.__width !== "inherit") {
      element.setAttribute("width", this.__width.toString());
    }
    if (this.__height && this.__height !== "inherit") {
      element.setAttribute("height", this.__height.toString());
    }
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      video: (_node: Node) => ({
        conversion: convertVideoElement,
        priority: 0,
      }),
    };
  }

  constructor(
    src = "",
    width?: "inherit" | number,
    height?: "inherit" | number,
    showCaption?: boolean,
    caption?: LexicalEditor,
    key?: NodeKey,
    captionsEnabled?: boolean,
  ) {
    super(key);
    this.__src = src;
    this.__width = width || "inherit";
    this.__height = height || "inherit";
    this.__showCaption = showCaption || false;
    this.__captionsEnabled = captionsEnabled || false;
    this.__caption = caption || createCaptionEditor();
  }

  setWidthAndHeight(
    width: "inherit" | number,
    height: "inherit" | number,
  ): void {
    const writable = this.getWritable();
    writable.__width = width;
    writable.__height = height;
  }

  getSrc(): string {
    return this.__src;
  }

  getShowCaption(): boolean {
    return this.__showCaption;
  }

  setShowCaption(showCaption: boolean): void {
    const writable = this.getWritable();
    writable.__showCaption = showCaption;
  }

  getCaption(): LexicalEditor {
    return this.__caption;
  }

  isInline(): false {
    return false;
  }

  static $createVideoNode<T extends VideoNode>(
    this: Klass<T>,
    { height, src, width, showCaption, caption, captionsEnabled }: VideoPayload,
  ): T {
    const node = $create(this);
    node.__src = src;
    node.__width = width || "inherit";
    node.__height = height || "inherit";
    node.__showCaption = showCaption || false;
    node.__captionsEnabled = captionsEnabled || false;
    if (caption) {
      node.__caption = caption;
    }
    return node;
  }

  static $isVideoNode<T extends VideoNode>(
    this: Klass<T>,
    node: LexicalNode | null | undefined,
  ): node is T {
    return node instanceof VideoNode;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const div = document.createElement("div");
    const theme = config.theme;
    const className = theme.video;
    if (className !== undefined) {
      div.className = className;
    }
    figureDOM(this, div);
    return div;
  }

  updateDOM(_prevNode: VideoNode, dom: HTMLElement): boolean {
    figureDOM(this, dom);
    return false;
  }
}

withStoredSize(VideoNode);
