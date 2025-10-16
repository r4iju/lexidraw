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

import {
  DecoratorNode,
  createEditor,
  $getRoot,
  $createParagraphNode,
} from "lexical";
import * as React from "react";
import { Suspense } from "react";

const VideoComponent = React.lazy(() => import("./VideoComponent"));

// Define a default initial state for the caption editor
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
    const newCaptionEditor = createEditor({
      // nodes: node.__caption.getNodes(), // This was incorrect
      // onError: (error) => { /* handle error */ }, // Optional: add error handling
      // theme: node.__caption._config.theme, // Preserve theme if needed
    });
    try {
      const currentCaptionState = node.__caption.getEditorState();
      if (!currentCaptionState.isEmpty()) {
        newCaptionEditor.setEditorState(currentCaptionState.clone());
      } else {
        // If original was empty, initialize new one with default
        newCaptionEditor.setEditorState(
          newCaptionEditor.parseEditorState(defaultInitialCaptionState),
        );
      }
    } catch (e) {
      console.error(
        "Error cloning caption editor state, falling back to default:",
        e,
      );
      // Fallback to a default state if cloning fails catastrophically
      newCaptionEditor.setEditorState(
        newCaptionEditor.parseEditorState(defaultInitialCaptionState),
      );
    }

    return new VideoNode(
      node.__src,
      node.__width,
      node.__height,
      node.__showCaption,
      newCaptionEditor, // Use the carefully prepared new caption editor
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
      // caption editor will be initialized by constructor if `caption` is undefined here
    });
    if (caption) {
      const nestedEditor = node.__caption;
      try {
        const editorState = nestedEditor.parseEditorState(caption);
        if (!editorState.isEmpty()) {
          nestedEditor.setEditorState(editorState);
        } else {
          // If parsed state is empty, set a default one
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
    // If caption was not in serializedNode, constructor already initialized it with a default state.
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
    this.__captionsEnabled = captionsEnabled || false; // Initialize this field

    if (caption) {
      this.__caption = caption;
    } else {
      this.__caption = createEditor();
      // Initialize with a default state if a new editor is created
      try {
        this.__caption.setEditorState(
          this.__caption.parseEditorState(defaultInitialCaptionState),
        );
      } catch (e) {
        console.error("Error setting initial caption state in constructor:", e);
        // Fallback for safety, though parseEditorState with valid JSON should not fail
        this.__caption.update(() => {
          const root = $getRoot();
          if (root.isEmpty()) {
            root.append($createParagraphNode());
          }
        });
      }
    }
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
          resizable={true} // Assuming always resizable for now
          caption={this.__caption}
          showCaption={this.__showCaption}
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
    const div = document.createElement("div");
    const theme = config.theme;
    const className = theme.video;
    if (className !== undefined) {
      div.className = className;
    }
    return div;
  }

  updateDOM(
    _prevNode: VideoNode,
    _dom: HTMLElement,
    _config: EditorConfig,
  ): boolean {
    return false;
  }
}
