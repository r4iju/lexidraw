import type {
  DOMConversionMap,
  DOMConversionOutput,
  DOMExportOutput,
  EditorConfig,
  ElementFormatType,
  LexicalEditor,
  LexicalNode,
  NodeKey,
  Spread,
} from "lexical";

import { BlockWithAlignableContents } from "@lexical/react/LexicalBlockWithAlignableContents";
import {
  DecoratorBlockNode,
  type SerializedDecoratorBlockNode,
} from "@lexical/react/LexicalDecoratorBlockNode";
import type * as React from "react";
import { useRef, useState, useCallback, useEffect } from "react";

// Lexical React helpers
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";

// Lexical core commands/types
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
} from "lexical";

// UI
import ImageResizer from "~/components/ui/image-resizer";
import { cn } from "~/lib/utils";

type YouTubeComponentProps = Readonly<{
  className: Readonly<{
    base: string;
    focus: string;
  }>;
  format: ElementFormatType | null;
  nodeKey: NodeKey;
  videoID: string;
  width?: "inherit" | number;
  height?: "inherit" | number;
}>;

function YouTubeComponent({
  className,
  format,
  nodeKey,
  videoID,
  width,
  height,
}: YouTubeComponentProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [editor] = useLexicalComposerContext();

  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const [isHovered, setIsHovered] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [currentDimensions, setCurrentDimensions] = useState({
    width,
    height,
  });

  // Delete key handling
  const onDelete = useCallback(
    (event: KeyboardEvent) => {
      if (isSelected && $isNodeSelection($getSelection())) {
        event.preventDefault();
        editor.update(() => {
          const node = $getNodeByKey(nodeKey);
          if (YouTubeNode.$isYouTubeNode(node)) {
            node.remove();
          }
        });
        return true;
      }
      return false;
    },
    [editor, isSelected, nodeKey],
  );

  // Click & keyboard command registration
  useEffect(() => {
    return mergeRegister(
      editor.registerCommand<MouseEvent>(
        CLICK_COMMAND,
        (event) => {
          const target = event.target as Node | null;
          if (!containerRef.current || !target) return false;

          if (containerRef.current.contains(target)) {
            if (!event.shiftKey) {
              clearSelection();
            }
            setSelected(!isSelected);
            return true;
          }
          return false;
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_DELETE_COMMAND,
        onDelete,
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        onDelete,
        COMMAND_PRIORITY_LOW,
      ),
    );
  }, [clearSelection, editor, isSelected, nodeKey, onDelete, setSelected]);

  const onResizeStart = () => {
    setIsResizing(true);
  };

  const onResizeEnd = (
    nextWidth: "inherit" | number,
    nextHeight: "inherit" | number,
  ) => {
    // Delay hiding handles so user can move pointer away
    setTimeout(() => setIsResizing(false), 200);

    editor.update(() => {
      const node = $getNodeByKey(nodeKey);
      if (YouTubeNode.$isYouTubeNode(node)) {
        node.setWidthAndHeight(nextWidth, nextHeight);
      }
    });

    // Update local state to reflect final dim
    setCurrentDimensions({ width: nextWidth, height: nextHeight });
  };

  const handleDimensionsChange = ({
    width: liveW,
    height: liveH,
  }: {
    width: number | "inherit";
    height: number | "inherit";
  }) => {
    setCurrentDimensions({ width: liveW, height: liveH });
  };

  const numericWidth =
    typeof currentDimensions.width === "number" ? currentDimensions.width : 560;
  const numericHeight =
    typeof currentDimensions.height === "number"
      ? currentDimensions.height
      : 315;

  const ratio =
    numericWidth && numericHeight ? numericWidth / numericHeight : 16 / 9;

  const containerStyles: React.CSSProperties = {
    position: "relative",
    display: "inline-block",
    width:
      currentDimensions.width === "inherit"
        ? undefined
        : currentDimensions.width,
    maxWidth: "100%", // allow shrinking on small screens
    aspectRatio: `${ratio}`,
  };

  return (
    <BlockWithAlignableContents
      className={className}
      format={format}
      nodeKey={nodeKey}
    >
      <div
        ref={containerRef}
        style={containerStyles}
        className={cn({ "ring-primary ring-1": isSelected || isResizing })}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <iframe
          style={{ width: "100%", height: "100%" }}
          src={`https://www.youtube-nocookie.com/embed/${videoID}`}
          frameBorder="0"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="YouTube video"
          data-lexical-youtube-node-key={nodeKey}
        />

        {(isHovered || isResizing) && (
          <ImageResizer
            editor={editor}
            imageRef={
              containerRef as React.RefObject<HTMLImageElement | HTMLDivElement>
            }
            buttonRef={buttonRef as React.RefObject<HTMLButtonElement>}
            // maxWidth={560}
            onResizeStart={onResizeStart}
            onResizeEnd={onResizeEnd}
            onDimensionsChange={handleDimensionsChange}
            showCaption={false}
            captionsEnabled={false}
          />
        )}

        {/* Hidden button used by ImageResizer to position Add Caption button (unused here) */}
        <button
          ref={buttonRef}
          style={{ display: "none" }}
          aria-hidden="true"
        />
      </div>
    </BlockWithAlignableContents>
  );
}

export type SerializedYouTubeNode = Spread<
  {
    videoID: string;
    width?: number;
    height?: number;
  },
  SerializedDecoratorBlockNode
>;

function $convertYoutubeElement(
  domNode: HTMLElement,
): null | DOMConversionOutput {
  const videoID = domNode.getAttribute("data-lexical-youtube");
  if (videoID) {
    const widthAttr = domNode.getAttribute("width");
    const heightAttr = domNode.getAttribute("height");
    const widthNum = widthAttr ? parseInt(widthAttr, 10) : undefined;
    const heightNum = heightAttr ? parseInt(heightAttr, 10) : undefined;

    const node = YouTubeNode.$createYouTubeNode(videoID, widthNum, heightNum);
    return { node };
  }
  return null;
}

export class YouTubeNode extends DecoratorBlockNode {
  __id: string;
  __width: "inherit" | number;
  __height: "inherit" | number;

  static getType(): string {
    return "youtube";
  }

  static clone(node: YouTubeNode): YouTubeNode {
    return new YouTubeNode(
      node.__id,
      node.__width,
      node.__height,
      node.__format,
      node.__key,
    );
  }

  static importJSON(serializedNode: SerializedYouTubeNode): YouTubeNode {
    const node = YouTubeNode.$createYouTubeNode(
      serializedNode.videoID,
      serializedNode.width,
      serializedNode.height,
    );
    node.setFormat(serializedNode.format);
    return node;
  }

  exportJSON(): SerializedYouTubeNode {
    return {
      ...super.exportJSON(),
      type: "youtube",
      version: 1,
      videoID: this.__id,
      width: this.__width === "inherit" ? 0 : this.__width,
      height: this.__height === "inherit" ? 0 : this.__height,
    };
  }

  constructor(
    id: string,
    width?: "inherit" | number,
    height?: "inherit" | number,
    format?: ElementFormatType,
    key?: NodeKey,
  ) {
    super(format, key);
    this.__id = id;
    this.__width = width || "inherit";
    this.__height = height || "inherit";
  }

  exportDOM(): DOMExportOutput {
    const element = document.createElement("iframe");
    element.setAttribute("data-lexical-youtube", this.__id);
    if (this.__width && this.__width !== "inherit") {
      element.setAttribute("width", this.__width.toString());
    }
    if (this.__height && this.__height !== "inherit") {
      element.setAttribute("height", this.__height.toString());
    }
    element.setAttribute(
      "src",
      `https://www.youtube-nocookie.com/embed/${this.__id}`,
    );
    element.setAttribute("frameborder", "0");
    element.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
    );
    element.setAttribute("allowfullscreen", "true");
    element.setAttribute("title", "YouTube video");
    return { element };
  }

  static importDOM(): DOMConversionMap | null {
    return {
      iframe: (domNode: HTMLElement) => {
        if (!domNode.hasAttribute("data-lexical-youtube")) {
          return null;
        }
        return {
          conversion: $convertYoutubeElement,
          priority: 1,
        };
      },
    };
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
    return `https://www.youtube.com/watch?v=${this.__id}`;
  }

  decorate(_editor: LexicalEditor, config: EditorConfig): React.JSX.Element {
    const embedBlockTheme = config.theme.embedBlock || {};
    const className = {
      base: embedBlockTheme.base || "",
      focus: embedBlockTheme.focus || "",
    };
    return (
      <YouTubeComponent
        className={className}
        format={this.__format}
        nodeKey={this.getKey()}
        videoID={this.__id}
        width={this.__width}
        height={this.__height}
      />
    );
  }

  static $createYouTubeNode(
    videoID: string,
    width?: number,
    height?: number,
  ): YouTubeNode {
    return new YouTubeNode(videoID, width, height);
  }

  static $isYouTubeNode(
    node: YouTubeNode | LexicalNode | null | undefined,
  ): node is YouTubeNode {
    return node instanceof YouTubeNode;
  }

  setWidthAndHeight(
    width: "inherit" | number,
    height: "inherit" | number,
  ): void {
    const writable = this.getWritable();
    writable.__width = width;
    writable.__height = height;
  }

  getWidth(): "inherit" | number {
    return this.__width;
  }

  getHeight(): "inherit" | number {
    return this.__height;
  }
}
