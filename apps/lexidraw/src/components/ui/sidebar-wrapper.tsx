"use client";

import React, {
  useState,
  useCallback,
  useRef,
  useEffect,
  createContext,
  useContext,
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
  children: React.ReactNode;
  ref?: React.RefObject<HTMLElement>;
}

interface SidebarSizeContextType {
  width: number;
}

const SidebarSizeContext = createContext<SidebarSizeContextType | undefined>(
  undefined,
);

export const useSidebarSize = () => {
  const context = useContext(SidebarSizeContext);
  if (context === undefined) {
    throw new Error("useSidebarSize must be used within a SidebarWrapper");
  }
  return context;
};

export const SidebarWrapper: React.FC<SidebarWrapperProps> = ({
  ref,
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
  const [isResizing, setIsResizing] = useState(false);
  const isResizingRef = useRef(false);
  const sidebarRef = useRef<HTMLElement>(null);
  const initialMouseXRef = useRef(0);
  const initialWidthRef = useRef(initialWidth);

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

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      handleMove(e.clientX);
    },
    [handleMove],
  );

  const handleTouchMove = useCallback(
    (e: TouchEvent) => {
      if (e.touches.length === 1) {
        handleMove(e.touches[0]?.clientX ?? 0);
      }
    },
    [handleMove],
  );

  const handleResizeEnd = useCallback(() => {
    if (!isResizingRef.current) return;
    isResizingRef.current = false;
    setIsResizing(false);

    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleResizeEnd);
    document.removeEventListener("touchmove", handleTouchMove);
    document.removeEventListener("touchend", handleResizeEnd);
  }, [handleMouseMove, handleTouchMove]);

  const handleResizeStart = useCallback(
    (clientX: number) => {
      if (!sidebarRef.current) {
        console.warn("Sidebar ref not available at resize start");
        return;
      }
      if (isResizingRef.current) return;

      isResizingRef.current = true;
      setIsResizing(true);
      initialMouseXRef.current = clientX;
      initialWidthRef.current = sidebarRef.current.offsetWidth;

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleResizeEnd);
      document.addEventListener("touchmove", handleTouchMove, {
        passive: false,
      });
      document.addEventListener("touchend", handleResizeEnd);
    },
    [handleMouseMove, handleTouchMove, handleResizeEnd],
  );

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    handleResizeStart(e.clientX);
    e.preventDefault();
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1) {
      handleResizeStart(e.touches[0]?.clientX ?? 0);
    }
  };

  useEffect(() => {
    return () => {
      if (isResizingRef.current) {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleResizeEnd);
        document.removeEventListener("touchmove", handleTouchMove);
        document.removeEventListener("touchend", handleResizeEnd);
      }
    };
  }, [handleMouseMove, handleTouchMove, handleResizeEnd]);

  useEffect(() => {
    const bodyStyle = document.body.style;
    const originalUserSelect = bodyStyle.userSelect;

    if (isResizing) {
      bodyStyle.userSelect = "none";

      return () => {
        bodyStyle.userSelect = originalUserSelect;
      };
    }
  }, [isResizing]);

  return (
    <aside
      ref={ref || sidebarRef}
      style={{ width: `${width}px` }}
      className={cn(
        "fixed right-0 top-0 h-full flex flex-col border-x border-border bg-popover shadow-lg transition-transform duration-300 ease-in-out z-40 touch-none",
        {
          "translate-x-0": isOpen,
          "translate-x-full": !isOpen,
        },
        className,
      )}
    >
      {/* Resize Handle */}
      <div
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        className="absolute left-0 top-0 h-full w-4 cursor-col-resize group -translate-x-1/2"
        aria-label="Resize sidebar"
        role="separator"
        tabIndex={0}
      >
        <div className="h-full w-[2px] bg-transparent group-hover:bg-primary transition-colors duration-200 mx-auto pointer-events-none"></div>
      </div>

      {/* Header */}
      <header className="flex items-center justify-between border-b border-border shrink-0 px-4 py-2 w-full">
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
      <div className="flex-1 overflow-y-auto ">
        <SidebarSizeContext.Provider value={{ width }}>
          {children}
        </SidebarSizeContext.Provider>
      </div>
    </aside>
  );
};
