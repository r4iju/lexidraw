import { BlockWithAlignableContents } from "@lexical/react/LexicalBlockWithAlignableContents";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalNodeSelection } from "@lexical/react/useLexicalNodeSelection";
import { mergeRegister } from "@lexical/utils";
import {
  $getNodeByKey,
  $getSelection,
  $isNodeSelection,
  CLICK_COMMAND,
  COMMAND_PRIORITY_LOW,
  type ElementFormatType,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type NodeKey,
} from "lexical";
import type * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import ImageResizer from "~/components/ui/image-resizer";
import { cn } from "~/lib/utils";
import { YouTubeNode } from "./YouTubeNode";
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

export default function YouTubeComponent({
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
  }, [clearSelection, editor, isSelected, onDelete, setSelected]);

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
      {/** biome-ignore lint/a11y/noStaticElementInteractions: youtube component is interactive */}
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
        <button type="button" ref={buttonRef} style={{ display: "none" }} />
      </div>
    </BlockWithAlignableContents>
  );
}
