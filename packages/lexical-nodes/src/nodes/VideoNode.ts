import type {
  Klass,
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedEditorState,
  SerializedLexicalNode,
  Spread,
} from "lexical";
import {
  $create,
  $createParagraphNode,
  $getRoot,
  createEditor,
  DecoratorNode,
} from "lexical";
import { $importNodeState, figureDOM, nodeStateJSON } from "../figure.js";

const defaultInitialCaptionState = JSON.stringify({
  root: {
    children: [
      {
        children: [],
        direction: null,
        format: "",
        indent: 0,
        type: "paragraph",
        version: 1,
      },
    ],
    direction: null,
    format: "",
    indent: 0,
    type: "root",
    version: 1,
  },
});

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
    caption?: SerializedEditorState;
    height?: number;
    src: string;
    width?: number;
    showCaption?: boolean;
    captionsEnabled?: boolean;
  },
  SerializedLexicalNode
>;

function createCaptionEditor(): LexicalEditor {
  const caption = createEditor();
  try {
    caption.setEditorState(
      caption.parseEditorState(defaultInitialCaptionState),
    );
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

export class VideoNode extends DecoratorNode<unknown> {
  __src: string;
  __width: "inherit" | number;
  __height: "inherit" | number;
  __showCaption: boolean;
  __caption: LexicalEditor;
  __captionsEnabled: boolean;

  static getType(): string {
    return "video";
  }

  static clone(node: VideoNode): VideoNode {
    const newCaptionEditor = createEditor();
    try {
      const currentCaptionState = node.__caption.getEditorState();
      if (!currentCaptionState.isEmpty()) {
        newCaptionEditor.setEditorState(currentCaptionState.clone());
      } else {
        newCaptionEditor.setEditorState(
          newCaptionEditor.parseEditorState(defaultInitialCaptionState),
        );
      }
    } catch (e) {
      console.error(
        "Error cloning caption editor state, falling back to default:",
        e,
      );
      newCaptionEditor.setEditorState(
        newCaptionEditor.parseEditorState(defaultInitialCaptionState),
      );
    }

    return new this(
      node.__src,
      node.__width,
      node.__height,
      node.__showCaption,
      newCaptionEditor,
      node.__key,
      node.__captionsEnabled,
    );
  }

  static importJSON(serializedNode: SerializedVideoNode): VideoNode {
    const { height, width, src, caption, showCaption, captionsEnabled } =
      serializedNode;
    const node = VideoNode.$createVideoNode({
      src,
      height,
      width,
      showCaption,
      captionsEnabled,
    });
    if (caption) {
      const nestedEditor = node.__caption;
      try {
        const editorState = nestedEditor.parseEditorState(caption);
        if (!editorState.isEmpty()) {
          nestedEditor.setEditorState(editorState);
        } else {
          nestedEditor.setEditorState(
            nestedEditor.parseEditorState(defaultInitialCaptionState),
          );
        }
      } catch (e) {
        console.error(
          "Error importing caption JSON, falling back to default:",
          e,
        );
        nestedEditor.setEditorState(
          nestedEditor.parseEditorState(defaultInitialCaptionState),
        );
      }
    }
    return $importNodeState(node, serializedNode);
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

  exportJSON(): SerializedVideoNode {
    let captionJSON: SerializedEditorState | null = null;
    try {
      captionJSON = this.__caption.getEditorState().toJSON();
    } catch (e) {
      console.error(
        "Error exporting caption to JSON, using default empty state:",
        e,
      );
      const tempEditor = createEditor();
      tempEditor.setEditorState(
        tempEditor.parseEditorState(defaultInitialCaptionState),
      );
      captionJSON = tempEditor.getEditorState().toJSON();
    }
    return {
      caption: captionJSON,
      height: this.__height === "inherit" ? 0 : this.__height,
      src: this.getSrc(),
      type: "video",
      version: 1,
      width: this.__width === "inherit" ? 0 : this.__width,
      showCaption: this.__showCaption,
      captionsEnabled: this.__captionsEnabled,
      ...nodeStateJSON(super.exportJSON()),
    };
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
