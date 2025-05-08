import type { LexicalEditor } from "lexical";
import { calculateZoomLevel } from "@lexical/utils";
import * as React from "react";
import { useRef } from "react";
import { cn } from "~/lib/utils";
import { Button } from "./button";

type VideoResizerProps = {
  onResizeStart?: () => void;
  onResizeEnd: (width: "inherit" | number, height: "inherit" | number) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  maxWidth?: number;
  editor: LexicalEditor;
  showCaption: boolean;
  setShowCaption: (show: boolean) => void;
  captionsEnabled: boolean;
  onDimensionsChange?: (dimensions: {
    width: number | "inherit";
    height: number | "inherit";
  }) => void;
  initialWidth?: "inherit" | number;
  initialHeight?: "inherit" | number;
};

export default function VideoResizer({
  onResizeStart,
  onResizeEnd,
  videoRef,
  maxWidth,
  editor,
  onDimensionsChange,
  showCaption,
  setShowCaption,
  captionsEnabled,
  buttonRef,
  initialWidth,
  initialHeight,
}: VideoResizerProps): React.JSX.Element {
  const controlWrapperRef = useRef<HTMLDivElement>(null);
  // This state was only used for the cleanup event listeners, not strictly necessary
  // const [, setIsResizing] = React.useState(false);

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

  const minWidth = 100; // Consider if different min size needed for video
  const minHeight = 100; // Consider if different min size needed for video

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

    const video = videoRef.current;
    const controlWrapper = controlWrapperRef.current;

    if (video !== null && controlWrapper !== null) {
      event.preventDefault();

      let startW: number;
      let startH: number;

      if (typeof initialWidth === "number") {
        startW = initialWidth;
      } else {
        startW = video.getBoundingClientRect().width;
        if (startW === 0 && video.offsetWidth > 0) {
          startW = video.offsetWidth;
        }
      }

      if (typeof initialHeight === "number") {
        startH = initialHeight;
      } else {
        startH = video.getBoundingClientRect().height;
        if (startH === 0 && video.offsetHeight > 0) {
          startH = video.offsetHeight;
        }
      }

      // Fallback if dimensions are still zero, use minWidth/minHeight
      // Though clamp later might handle this, ensuring non-zero start can be safer.
      if (startW === 0 && minWidth > 0) startW = minWidth;
      if (startH === 0 && minHeight > 0) startH = minHeight;

      const zoom = calculateZoomLevel(video);
      const positioning = positioningRef.current;
      positioning.startWidth = startW;
      positioning.startHeight = startH;
      // Get video aspect ratio from videoWidth/videoHeight if available and non-zero
      positioning.ratio =
        video.videoWidth > 0 && video.videoHeight > 0
          ? video.videoWidth / video.videoHeight
          : startW > 0 && startH > 0
            ? startW / startH
            : 0; // Use startW/startH for ratio if video intrinsics are 0
      positioning.currentWidth = startW;
      positioning.currentHeight = startH;
      positioning.startX = event.clientX / zoom;
      positioning.startY = event.clientY / zoom;
      positioning.isResizing = true;
      positioning.direction = direction;

      setStartCursor(direction);
      onResizeStart?.();
      onDimensionsChange?.({ width: startW, height: startH }); // Initial dimensions

      controlWrapper.classList.add("video-control-wrapper--resizing"); // Optional class change

      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", handlePointerUp);
    }
  };

  const handlePointerMove = (event: PointerEvent) => {
    const video = videoRef.current;
    const positioning = positioningRef.current;

    const isHorizontal =
      positioning.direction & (Direction.east | Direction.west);
    const isVertical =
      positioning.direction & (Direction.south | Direction.north);

    if (video !== null && positioning.isResizing) {
      const zoom = calculateZoomLevel(video);
      // Ensure we are starting calculations with numbers from startWidth/startHeight
      let newWidth = positioning.startWidth;
      let newHeight = positioning.startHeight;

      // Corner cursor
      if (isHorizontal && isVertical) {
        let diff = Math.floor(positioning.startX - event.clientX / zoom);
        diff = positioning.direction & Direction.east ? -diff : diff;

        newWidth = clamp(
          positioning.startWidth + diff, // Use startWidth (number)
          minWidth,
          maxWidthContainer,
        );

        if (positioning.ratio > 0) {
          newHeight = newWidth / positioning.ratio;
        } else {
          // Fallback: Recalculate height based on vertical difference
          let vDiff = Math.floor(positioning.startY - event.clientY / zoom);
          vDiff = positioning.direction & Direction.south ? -vDiff : vDiff;
          newHeight = clamp(
            positioning.startHeight + vDiff, // Use startHeight (number)
            minHeight,
            maxHeightContainer,
          );
        }
      } else if (isVertical) {
        let diff = Math.floor(positioning.startY - event.clientY / zoom);
        diff = positioning.direction & Direction.south ? -diff : diff;

        newHeight = clamp(
          positioning.startHeight + diff, // Use startHeight (number)
          minHeight,
          maxHeightContainer,
        );
        if (positioning.ratio > 0) {
          newWidth = newHeight * positioning.ratio;
        }
      } else {
        // isHorizontal
        let diff = Math.floor(positioning.startX - event.clientX / zoom);
        diff = positioning.direction & Direction.east ? -diff : diff;

        newWidth = clamp(
          positioning.startWidth + diff, // Use startWidth (number)
          minWidth,
          maxWidthContainer,
        );
        if (positioning.ratio > 0) {
          newHeight = newWidth / positioning.ratio;
        }
      }

      // Clamp dimensions after ratio adjustments
      newHeight = clamp(newHeight, minHeight, maxHeightContainer);
      if (positioning.ratio > 0) {
        newWidth = clamp(
          newHeight * positioning.ratio,
          minWidth,
          maxWidthContainer,
        );
        // Re-clamp height if width clamping changed it significantly
        if (Math.abs(newHeight - newWidth / positioning.ratio) > 1) {
          newHeight = clamp(
            newWidth / positioning.ratio,
            minHeight,
            maxHeightContainer,
          );
        }
      } else {
        // If no ratio, clamp width independently
        newWidth = clamp(newWidth, minWidth, maxWidthContainer);
      }

      // Update positioning ref with numbers
      positioning.currentHeight = newHeight;
      positioning.currentWidth = newWidth;

      // Update live dimensions if callback provided (pass numbers)
      onDimensionsChange?.({ width: newWidth, height: newHeight });

      // Live visual feedback
      const videoElement = videoRef.current;
      if (videoElement) {
        videoElement.style.setProperty("width", `${newWidth}px`);
        videoElement.style.setProperty("height", `${newHeight}px`);
      }
    }
  };

  const handlePointerUp = () => {
    const video = videoRef.current;
    const positioning = positioningRef.current;
    const controlWrapper = controlWrapperRef.current;
    if (video !== null && controlWrapper !== null && positioning.isResizing) {
      const width = positioning.currentWidth;
      const height = positioning.currentHeight;

      // Reset styles if they were applied for live feedback
      const videoElement = videoRef.current;
      if (videoElement) {
        videoElement.style.removeProperty("width");
        videoElement.style.removeProperty("height");
      }

      positioning.startWidth = 0;
      positioning.startHeight = 0;
      positioning.ratio = 0;
      positioning.startX = 0;
      positioning.startY = 0;
      positioning.currentWidth = 0;
      positioning.currentHeight = 0;
      positioning.isResizing = false;

      controlWrapper.classList.remove("video-control-wrapper--resizing");

      setEndCursor();
      // Pass the final numeric width/height. The Node update might handle 'inherit' logic if needed.
      if (typeof width === "number" && typeof height === "number") {
        onResizeEnd(width, height);
      } else {
        // Fallback or error handling if dimensions aren't numbers?
        // For now, assume they become numbers after resize.
        // If original was 'inherit', maybe pass that? Needs consideration.
        // Let's pass numbers as calculated.
        onResizeEnd(
          typeof width === "number" ? width : video.offsetWidth,
          typeof height === "number" ? height : video.offsetHeight,
        ); // Fallback to offsetWidth/Height might be inaccurate
      }

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

      {/* Resizer handles (same logic as before) */}
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
        className="absolute bottom-0 right-0 w-4 h-4 pointer-events-auto cursor-nwse-resize"
        onPointerDown={(event) =>
          handlePointerDown(event, Direction.south | Direction.east)
        }
      >
        <div className="absolute bottom-0 right-0 w-4 h-4 border-b-[2px] border-r-[2px] border-foreground cursor-nwse-resize" />
      </div>

      {/* Bottom-Left */}
      <div
        className="absolute bottom-0 left-0 w-4 h-4 pointer-events-auto cursor-nesw-resize"
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
