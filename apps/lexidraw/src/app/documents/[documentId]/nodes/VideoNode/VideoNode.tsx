import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  SerializedLexicalNode,
  SerializedEditorState,
  Spread,
} from "lexical";

import { DecoratorNode, createEditor } from "lexical";
import * as React from "react";
import { Suspense } from "react";

const VideoComponent = React.lazy(() => import("./VideoComponent"));

export interface VideoPayload {
  caption?: LexicalEditor;
  captionsEnabled?: boolean;
  height?: number;
  key?: NodeKey;
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

export class VideoNode extends DecoratorNode<React.JSX.Element> {
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
    const newCaption = createEditor();
    try {
      const editorStateJSON = node.__caption.getEditorState().toJSON();
      newCaption.setEditorState(newCaption.parseEditorState(editorStateJSON));
    } catch (e) {
      console.error("Error cloning caption editor state:", e);
    }

    return new VideoNode(
      node.__src,
      node.__width,
      node.__height,
      node.__showCaption,
      newCaption,
      node.__key,
      node.__captionsEnabled,
    );
  }

  static importJSON(serializedNode: SerializedVideoNode): VideoNode {
    const { height, width, src, caption, showCaption } = serializedNode;
    const node = VideoNode.$createVideoNode({
      src,
      height,
      width,
      showCaption,
    });
    if (caption) {
      const nestedEditor = node.__caption;
      const editorState = nestedEditor.parseEditorState(caption);
      if (!editorState.isEmpty()) {
        nestedEditor.setEditorState(editorState);
      }
    }
    return node;
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
    src: string,
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
    this.__caption = caption || createEditor();
    this.__captionsEnabled = captionsEnabled || false;
  }

  exportJSON(): SerializedVideoNode {
    return {
      caption: this.__caption.getEditorState().toJSON(),
      height: this.__height === "inherit" ? 0 : this.__height,
      src: this.getSrc(),
      type: "video",
      version: 1,
      width: this.__width === "inherit" ? 0 : this.__width,
      showCaption: this.__showCaption,
      captionsEnabled: this.__captionsEnabled,
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

  decorate(_editor: LexicalEditor, _config: EditorConfig): React.JSX.Element {
    return (
      <Suspense fallback={null}>
        <VideoComponent
          src={this.__src}
          nodeKey={this.getKey()}
          width={this.__width}
          height={this.__height}
          _resizable={true}
          showCaption={this.__showCaption}
          caption={this.__caption}
          captionsEnabled={this.__captionsEnabled}
        />
      </Suspense>
    );
  }

  isInline(): false {
    return false;
  }

  static $createVideoNode({
    height,
    key,
    src,
    width,
    showCaption,
    caption,
    captionsEnabled,
  }: VideoPayload): VideoNode {
    return new VideoNode(
      src,
      width,
      height,
      showCaption,
      caption,
      key,
      captionsEnabled,
    );
  }

  static $isVideoNode(node: LexicalNode | null | undefined): node is VideoNode {
    return node instanceof VideoNode;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const span = document.createElement("span");
    const theme = config.theme;
    const className = theme.video; // Example: theme.video if you add it to your theme
    if (className !== undefined) {
      span.className = className;
    }
    // You can add other attributes or classes to the span if needed
    // For a DecoratorNode, this element often just serves as a container
    // for the React component rendered by decorate().
    return span;
  }
}
