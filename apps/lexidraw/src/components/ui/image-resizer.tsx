import type { LexicalEditor } from "lexical";
import { calculateZoomLevel } from "@lexical/utils";
import * as React from "react";
import { useRef } from "react";
import { cn } from "~/lib/utils";
import { Button } from "./button";

type ImageResizerProps = {
  onResizeStart?: () => void;
  onResizeEnd: (width: "inherit" | number, height: "inherit" | number) => void;
  buttonRef: React.RefObject<HTMLButtonElement>;
  imageRef: React.RefObject<HTMLImageElement>;
  maxWidth?: number;
  editor: LexicalEditor;
  showCaption: boolean;
  setShowCaption?: (show: boolean) => void;
  bottomOffset?: boolean;
  captionsEnabled: boolean;
  onDimensionsChange?: (dimensions: {
    width: number | "inherit";
    height: number | "inherit";
  }) => void;
};

export default function ImageResizer({
  onResizeStart,
  onResizeEnd,
  buttonRef,
  imageRef,
  maxWidth,
  editor,
  showCaption,
  setShowCaption,
  captionsEnabled,
  onDimensionsChange,
  bottomOffset,
}: ImageResizerProps): React.JSX.Element {
  const controlWrapperRef = useRef<HTMLDivElement>(null);
  const [, setIsResizing] = React.useState(false);

  const userSelect = useRef({
    priority: "",
    value: "default",
  });

  const positioningRef = useRef<{
    currentHeight: "inherit" | number;
    currentWidth: "inherit" | number;
    direction: number;
    isResizing: boolean;
    ratio: number;
    startHeight: number;
    startWidth: number;
    startX: number;
    startY: number;
  }>({
    currentHeight: 0,
    currentWidth: 0,
    direction: 0,
    isResizing: false,
    ratio: 0,
    startHeight: 0,
    startWidth: 0,
    startX: 0,
    startY: 0,
  });

  const clamp = (value: number, min: number, max: number) => {
    return Math.min(Math.max(value, min), max);
  };

  const Direction = {
    east: 1 << 0,
    north: 1 << 3,
    south: 1 << 1,
    west: 1 << 2,
  };

  const editorRootElement = editor.getRootElement();
  // Find max width, accounting for editor padding.

  const maxWidthContainer = maxWidth
    ? maxWidth
    : editorRootElement !== null
      ? editorRootElement.getBoundingClientRect().width - 20
      : 100;

  const maxHeightContainer =
    editorRootElement !== null
      ? editorRootElement.getBoundingClientRect().height - 20
      : 100;

  const minWidth = 100;
  const minHeight = 100;

  const setStartCursor = (direction: number) => {
    const ew = direction === Direction.east || direction === Direction.west;
    const ns = direction === Direction.north || direction === Direction.south;
    const nwse =
      (direction & Direction.north && direction & Direction.west) ||
      (direction & Direction.south && direction & Direction.east);

    const cursorDir = ew ? "ew" : ns ? "ns" : nwse ? "nwse" : "nesw";

    if (editorRootElement !== null) {
      editorRootElement.style.setProperty(
        "cursor",
        `${cursorDir}-resize`,
        "important",
      );
    }
    if (document.body !== null) {
      document.body.style.setProperty(
        "cursor",
        `${cursorDir}-resize`,
        "important",
      );
      userSelect.current.value = document.body.style.getPropertyValue(
        "-webkit-user-select",
      );
      userSelect.current.priority = document.body.style.getPropertyPriority(
        "-webkit-user-select",
      );
      document.body.style.setProperty(
        "-webkit-user-select",
        `none`,
        "important",
      );
    }
  };

  const setEndCursor = () => {
    if (editorRootElement !== null) {
      editorRootElement.style.setProperty("cursor", "text");
    }
    if (document.body !== null) {
      document.body.style.setProperty("cursor", "default");
      document.body.style.setProperty(
        "-webkit-user-select",
        userSelect.current.value,
        userSelect.current.priority,
      );
    }
  };

  const handlePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
    direction: number,
  ) => {
    if (!editor.isEditable()) {
      return;
    }

    const image = imageRef.current;
    const controlWrapper = controlWrapperRef.current;

    if (image !== null && controlWrapper !== null) {
      event.preventDefault();
      const { width, height } = image.getBoundingClientRect();
      const zoom = calculateZoomLevel(image);
      const positioning = positioningRef.current;
      positioning.startWidth = width;
      positioning.startHeight = height;
      positioning.ratio = width / height;
      positioning.currentWidth = width;
      positioning.currentHeight = height;
      positioning.startX = event.clientX / zoom;
      positioning.startY = event.clientY / zoom;
      positioning.isResizing = true;
      positioning.direction = direction;

      setStartCursor(direction);
      onResizeStart?.();
      onDimensionsChange?.({ width, height });

      controlWrapper.classList.add("image-control-wrapper--resizing");

      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    const image = imageRef.current;
    const positioning = positioningRef.current;

    const isHorizontal =
      positioning.direction & (Direction.east | Direction.west);
    const isVertical =
      positioning.direction & (Direction.south | Direction.north);

    if (image !== null && positioning.isResizing) {
      const zoom = calculateZoomLevel(image);
      let newWidth = positioning.currentWidth;
      let newHeight = positioning.currentHeight;

      // Corner cursor
      if (isHorizontal && isVertical) {
        let diff = Math.floor(positioning.startX - event.clientX / zoom);
        diff = positioning.direction & Direction.east ? -diff : diff;

        newWidth = clamp(
          positioning.startWidth + diff,
          minWidth,
          maxWidthContainer,
        );

        newHeight = newWidth / positioning.ratio;
      } else if (isVertical) {
        let diff = Math.floor(positioning.startY - event.clientY / zoom);
        diff = positioning.direction & Direction.south ? -diff : diff;

        newHeight = clamp(
          positioning.startHeight + diff,
          minHeight,
          maxHeightContainer,
        );
      } else {
        let diff = Math.floor(positioning.startX - event.clientX / zoom);
        diff = positioning.direction & Direction.east ? -diff : diff;

        newWidth = clamp(
          positioning.startWidth + diff,
          minWidth,
          maxWidthContainer,
        );
      }

      const newDimensions = { width: newWidth, height: newHeight };
      onDimensionsChange?.(newDimensions);
      positioning.currentHeight = newHeight;
      positioning.currentWidth = newWidth;
    }
  };

  const handlePointerUp = () => {
    const image = imageRef.current;
    const positioning = positioningRef.current;
    const controlWrapper = controlWrapperRef.current;
    if (image !== null && controlWrapper !== null && positioning.isResizing) {
      const width = positioning.currentWidth;
      const height = positioning.currentHeight;
      positioning.startWidth = 0;
      positioning.startHeight = 0;
      positioning.ratio = 0;
      positioning.startX = 0;
      positioning.startY = 0;
      positioning.currentWidth = 0;
      positioning.currentHeight = 0;
      positioning.isResizing = false;

      controlWrapper.classList.remove("image-control-wrapper--resizing");

      setEndCursor();
      onResizeEnd(width, height);
      setIsResizing(false);
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
    }
  };

  return (
    <div
      ref={controlWrapperRef}
      className={cn("absolute top-0 left-0 size-full z-30")}
      style={{ pointerEvents: "none" }} // parent won't catch events, only children
    >
      {!showCaption && captionsEnabled && (
        <Button
          variant="ghost"
          // middle of the bottom
          className="absolute bottom-0 right-1/2 translate-x-1/2 z-50 m-2 pointer-events-auto"
          ref={buttonRef}
          onClick={() => {
            setShowCaption?.(!showCaption);
          }}
        >
          Add Caption
        </Button>
      )}
      {/* Top-Right */}
      <div
        className="absolute top-0 right-0 w-4 h-4 pointer-events-auto cursor-nesw-resize"
        onPointerDown={(event) =>
          handlePointerDown(event, Direction.north | Direction.east)
        }
      >
        <div className="absolute top-0 right-0 w-4 h-4 border-t-[2px] border-r-[2px] border-foreground cursor-nesw-resize" />
      </div>

      {/* Bottom-Right */}
      <div
        className={cn(
          "absolute bottom-0 right-0 w-4 h-4 pointer-events-auto cursor-nwse-resize",
          {
            "bottom-1.5": bottomOffset !== undefined,
          },
        )}
        onPointerDown={(event) =>
          handlePointerDown(event, Direction.south | Direction.east)
        }
      >
        <div className="absolute bottom-0 right-0 w-4 h-4 border-b-[2px] border-r-[2px] border-foreground cursor-nwse-resize" />
      </div>

      {/* Bottom-Left */}
      <div
        className={cn(
          "absolute bottom-0 left-0 w-4 h-4 pointer-events-auto cursor-nesw-resize",
          {
            "bottom-1.5": bottomOffset !== undefined,
          },
        )}
        onPointerDown={(event) =>
          handlePointerDown(event, Direction.south | Direction.west)
        }
      >
        <div className="absolute bottom-0 left-0 w-4 h-4 border-b-[2px] border-l-[2px] border-foreground cursor-nesw-resize" />
      </div>

      {/* Top-Left */}
      <div
        className="absolute top-0 left-0 w-4 h-4 pointer-events-auto cursor-nwse-resize"
        onPointerDown={(event) =>
          handlePointerDown(event, Direction.north | Direction.west)
        }
      >
        <div className="absolute top-0 left-0 w-4 h-4 border-t-[2px] border-l-[2px] border-foreground cursor-nwse-resize" />
      </div>
    </div>
  );
}
