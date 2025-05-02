"use client";

import React, {
  PropsWithChildren,
  useState,
  useCallback,
  useRef,
  useEffect,
} from "react";
import { Button } from "~/components/ui/button";
import { X } from "lucide-react";
import { cn } from "~/lib/utils";

interface SidebarWrapperProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  className?: string;
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
}

export const SidebarWrapper: React.FC<
  PropsWithChildren<SidebarWrapperProps>
> = ({
  isOpen,
  onClose,
  title,
  children,
  className,
  initialWidth = 360,
  minWidth = 200,
  maxWidth = 800,
}) => {
  const [width, setWidth] = useState(initialWidth);
  const isResizingRef = useRef(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const initialMouseXRef = useRef(0);
  const initialWidthRef = useRef(initialWidth);

  // Unified move logic
  const handleMove = useCallback(
    (clientX: number) => {
      if (!isResizingRef.current) return;

      const deltaX = initialMouseXRef.current - clientX;
      let newWidth = initialWidthRef.current + deltaX;

      if (minWidth !== undefined) {
        newWidth = Math.max(minWidth, newWidth);
      }

      const viewportWidth = window.innerWidth;
      const effectiveMaxWidth =
        maxWidth !== undefined
          ? Math.min(maxWidth, viewportWidth)
          : viewportWidth;
      newWidth = Math.min(effectiveMaxWidth, newWidth);

      setWidth(newWidth);
    },
    [minWidth, maxWidth],
  );

  // Specific event handlers calling the unified logic
  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      handleMove(e.clientX);
    },
    [handleMove],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length === 1) {
        handleMove(e.touches[0].clientX);
      }
    },
    [handleMove],
  );

  // Unified end handler
  const handleResizeEnd = useCallback(() => {
    if (!isResizingRef.current) return;
    isResizingRef.current = false;

    // Remove global listeners
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleResizeEnd);
    document.removeEventListener("touchmove", handleTouchMove);
    document.removeEventListener("touchend", handleResizeEnd);

    // Restore body style
    document.body.style.userSelect = "";
    document.body.style.webkitUserSelect = "";
  }, [handleMouseMove, handleTouchMove]); // handleMove removed, end doesn't use it

  // Unified start handler
  const handleResizeStart = useCallback(
    (clientX: number) => {
      // Check ref before accessing offsetWidth
      if (!sidebarRef.current) {
        console.warn("Sidebar ref not available at resize start");
        return;
      }
      if (isResizingRef.current) return; // Avoid starting multiple times

      isResizingRef.current = true;
      initialMouseXRef.current = clientX;
      initialWidthRef.current = sidebarRef.current.offsetWidth;

      // Add global listeners
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleResizeEnd);
      document.addEventListener("touchmove", handleTouchMove, {
        passive: false,
      });
      document.addEventListener("touchend", handleResizeEnd);

      // Prevent text selection
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
    },
    [handleMouseMove, handleTouchMove, handleResizeEnd], // Added handleResizeEnd dependency
  );

  // Inline handlers for the resize handle element
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    handleResizeStart(e.clientX);
    e.preventDefault();
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1) {
      handleResizeStart(e.touches[0].clientX);
      // e.preventDefault(); // Only if needed to prevent scrolling
    }
  };

  // Effect for cleaning up global listeners on unmount *if* resizing
  useEffect(() => {
    return () => {
      if (isResizingRef.current) {
        // If component unmounts while resizing, clean up everything
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleResizeEnd);
        document.removeEventListener("touchmove", handleTouchMove);
        document.removeEventListener("touchend", handleResizeEnd);
        document.body.style.userSelect = "";
        document.body.style.webkitUserSelect = "";
      }
    };
    // Depend on the handlers used in cleanup
  }, [handleMouseMove, handleTouchMove, handleResizeEnd]);

  return (
    <aside
      ref={sidebarRef}
      style={{ width: `${width}px` }}
      className={cn(
        "fixed right-0 top-0 h-full flex flex-col border-l bg-popover shadow-lg transition-transform duration-300 ease-in-out z-40 touch-none",
        {
          "translate-x-0": isOpen,
          "translate-x-full": !isOpen,
        },
        className,
      )}
    >
      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown} // Use inline handler
        onTouchStart={handleTouchStart} // Use inline handler
        className="absolute left-0 top-0 h-full w-4 cursor-col-resize group -translate-x-1/2"
        aria-label="Resize sidebar" // Added aria-label for accessibility
        role="separator" // Added role
        tabIndex={0} // Make it focusable for potential keyboard support later
      >
        <div className="h-full w-[2px] bg-transparent group-hover:bg-primary transition-colors duration-200 mx-auto pointer-events-none"></div>{" "}
        {/* Added pointer-events-none to inner div */}
      </div>

      {/* Header */}
      <header className="flex items-center justify-between border-b shrink-0 px-4 py-2 w-full">
        <h2 className="text-lg font-semibold truncate pr-2">{title}</h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          aria-label="Close Sidebar"
        >
          <X className="h-5 w-5" />
        </Button>
      </header>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4">
        {" "}
        {/* Added padding */}
        {children}
      </div>
    </aside>
  );
};
