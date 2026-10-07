import { BlockWithAlignableContents } from "@lexical/react/LexicalBlockWithAlignableContents";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useLexicalEditable } from "@lexical/react/useLexicalEditable";
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
import { mediaLink } from "@packages/lexical-nodes/media-links";
import YoutubeIcon from "~/components/icons/youtube";
import ImageResizer from "~/components/ui/image-resizer";
import { cn } from "~/lib/utils";
import {
  ALIGN_MARGINS,
  EmbedFallback,
  EmbedLoading,
  embedAlign,
} from "./common/embed";
import { PrintedLink } from "./common/PrintedLink";
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
  const isEditable = useLexicalEditable();

  const [isSelected, setSelected, clearSelection] =
    useLexicalNodeSelection(nodeKey);
  const [isHovered, setIsHovered] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  /** Where the facade is: its thumbnail coming, shown, missing, or the player in its place. */
  const [facade, setFacade] = useState<
    "loading" | "ready" | "unavailable" | "playing"
  >("loading");
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
    width:
      typeof currentDimensions.width === "number"
        ? currentDimensions.width
        : "100%",
    maxWidth: "100%", // allow shrinking on small screens
    aspectRatio: `${ratio}`,
  };

  const align = embedAlign(format);
  const href = mediaLink("youtube", videoID);

  if (!href)
    return (
      <BlockWithAlignableContents
        className={className}
        format={format}
        nodeKey={nodeKey}
      >
        <EmbedFallback icon={<YoutubeIcon />} message="No video linked" />
      </BlockWithAlignableContents>
    );
  const source = { href, label: "Open on YouTube" };

  return (
    <BlockWithAlignableContents
      className={className}
      format={format}
      nodeKey={nodeKey}
    >
      {facade === "unavailable" ? (
        <EmbedFallback
          icon={<YoutubeIcon />}
          message="This video is unavailable"
          source={source}
        />
      ) : (
        /* biome-ignore lint/a11y/noStaticElementInteractions: hovering shows the resize handles */
        <div
          ref={containerRef}
          style={containerStyles}
          data-embed-align={align}
          aria-busy={facade === "loading" || undefined}
          className={cn("document-embed print:hidden", ALIGN_MARGINS[align], {
            "ring-primary ring-1": isEditable && (isSelected || isResizing),
          })}
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
        >
          <img
            src={`https://i.ytimg.com/vi/${videoID}/hqdefault.jpg`}
            alt=""
            className="absolute inset-0 size-full object-cover"
            onLoad={(event) =>
              setFacade(
                // YouTube answers an id it has no video for with a 120px placeholder.
                event.currentTarget.naturalWidth <= 120
                  ? "unavailable"
                  : "ready",
              )
            }
            onError={() => setFacade("unavailable")}
          />
          {facade === "loading" && <EmbedLoading />}
          {facade === "ready" && (
            <button
              type="button"
              aria-label="Play video"
              className="group/play absolute inset-0 flex items-center justify-center bg-black/0 transition-colors hover:bg-black/10"
              onClick={() => setFacade("playing")}
            >
              <svg
                aria-hidden
                viewBox="0 0 68 48"
                className="h-12 w-[68px] drop-shadow-md"
              >
                <path
                  d="M66.5 7.7a8.6 8.6 0 0 0-6-6C55.2.3 34 .3 34 .3s-21.2 0-26.5 1.4a8.6 8.6 0 0 0-6 6C.1 13 .1 24 .1 24s0 11 1.4 16.3a8.6 8.6 0 0 0 6 6C12.8 47.7 34 47.7 34 47.7s21.2 0 26.5-1.4a8.6 8.6 0 0 0 6-6C67.9 35 67.9 24 67.9 24s0-11-1.4-16.3Z"
                  className="fill-[#212121]/80 transition-colors group-hover/play:fill-[#f00]"
                />
                <path d="M45 24 27 14v20" fill="#fff" />
              </svg>
            </button>
          )}
          {facade === "playing" && (
            <iframe
              className="absolute inset-0 size-full"
              style={{ colorScheme: "normal" }}
              src={`https://www.youtube-nocookie.com/embed/${videoID}?autoplay=1`}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              title="YouTube video"
              data-lexical-youtube-node-key={nodeKey}
            />
          )}

          {isEditable && (isHovered || isResizing) && (
            <ImageResizer
              editor={editor}
              imageRef={
                containerRef as React.RefObject<
                  HTMLImageElement | HTMLDivElement
                >
              }
              buttonRef={buttonRef as React.RefObject<HTMLButtonElement>}
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
      )}
      <PrintedLink href={source.href} />
    </BlockWithAlignableContents>
  );
}
