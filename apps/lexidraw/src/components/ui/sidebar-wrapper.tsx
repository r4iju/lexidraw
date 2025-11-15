"use client";

import type React from "react";
import {
  useState,
  useCallback,
  useRef,
  useEffect,
  createContext,
  useContext,
  forwardRef,
  type ForwardedRef,
} from "react";
import { Button } from "~/components/ui/button";
import { X } from "lucide-react";
import { cn } from "~/lib/utils";

interface SidebarWrapperProps {
  onClose: () => void;
  title: string;
  className?: string;
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  children: React.ReactNode;
  onWidthChange?: (width: number) => void;
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

export const SidebarWrapper = forwardRef<HTMLElement, SidebarWrapperProps>(
  (
    {
      onClose,
      title,
      children,
      className,
      initialWidth = 360,
      minWidth = 200,
      maxWidth = 800,
      onWidthChange,
    },
    ref: ForwardedRef<HTMLElement>,
  ) => {
    const [width, setWidth] = useState(initialWidth);
    const [isResizing, setIsResizing] = useState(false);
    const isResizingRef = useRef(false);
    const componentSidebarRef = useRef<HTMLElement>(null);
    const initialMouseXRef = useRef(0);
    const initialWidthRef = useRef(initialWidth);
    const [isMobile, setIsMobile] = useState(false);

    const MOBILE_BREAKPOINT = 768; // Standard tablet breakpoint

    useEffect(() => {
      const checkMobile = () => {
        const isNowMobile = window.innerWidth < MOBILE_BREAKPOINT;
        setIsMobile(isNowMobile);
        if (isNowMobile) {
          setWidth(window.innerWidth);
        } else {
          // Restore initial/persisted width if provided, otherwise use default
          // We might need a more sophisticated way to remember the last desktop width
          // if the user resizes, then goes mobile, then back to desktop.
          // For now, let's reset to initialWidth or the current width if it was changed by resizing.
          setWidth((prevWidth) =>
            prevWidth === window.innerWidth ? initialWidth : prevWidth,
          );
        }
      };

      checkMobile(); // Initial check
      window.addEventListener("resize", checkMobile);
      return () => window.removeEventListener("resize", checkMobile);
    }, [initialWidth]);

    const handleMove = useCallback(
      (clientX: number) => {
        if (!isResizingRef.current || isMobile) return;

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
      [minWidth, maxWidth, isMobile],
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

    const handleResizeEndRef = useRef<() => void>();

    const handleResizeEnd = useCallback(() => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      setIsResizing(false);

      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleResizeEndRef.current!);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleResizeEndRef.current!);
    }, [handleMouseMove, handleTouchMove]);

    useEffect(() => {
      handleResizeEndRef.current = handleResizeEnd;
    }, [handleResizeEnd]);

    const handleResizeStart = useCallback(
      (clientX: number) => {
        if (!componentSidebarRef.current) {
          console.warn("Sidebar ref not available at resize start");
          return;
        }
        if (isResizingRef.current) return;

        isResizingRef.current = true;
        setIsResizing(true);
        initialMouseXRef.current = clientX;
        initialWidthRef.current = componentSidebarRef.current.offsetWidth;

        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleResizeEndRef.current!);
        document.addEventListener("touchmove", handleTouchMove, {
          passive: false,
        });
        document.addEventListener("touchend", handleResizeEndRef.current!);
      },
      [handleMouseMove, handleTouchMove],
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
      if (isMobile) {
        setWidth(window.innerWidth);
      }
    }, [isMobile]);

    useEffect(() => {
      return () => {
        if (isResizingRef.current) {
          document.removeEventListener("mousemove", handleMouseMove);
          document.removeEventListener("mouseup", handleResizeEndRef.current!);
          document.removeEventListener("touchmove", handleTouchMove);
          document.removeEventListener("touchend", handleResizeEndRef.current!);
        }
      };
    }, [handleMouseMove, handleTouchMove]);

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

    useEffect(() => {
      if (onWidthChange) {
        onWidthChange(width);
      }
    }, [width, onWidthChange]);

    return (
      <aside
        ref={(node) => {
          if (typeof ref === "function") {
            ref(node);
          } else if (ref) {
            ref.current = node;
          }
          componentSidebarRef.current = node;
        }}
        style={{ width: `${width}px` }}
        className={cn(
          "sticky top-0 h-full flex flex-col border-l border-border bg-popover shadow-lg touch-none",
          className,
        )}
      >
        {/* Resize Handle */}
        {!isMobile && (
          // biome-ignore lint/a11y/useSemanticElements: todo: fix semantic elements
          <div
            onMouseDown={handleMouseDown}
            onTouchStart={handleTouchStart}
            className="absolute left-0 top-0 h-full w-4 cursor-col-resize group -translate-x-1/2"
            // biome-ignore lint/a11y/useAriaPropsForRole: todo: fix aria props for role
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize sidebar"
            tabIndex={0}
          >
            <div className="h-full w-[2px] bg-transparent group-hover:bg-primary transition-colors duration-200 mx-auto pointer-events-none"></div>
          </div>
        )}

        {/* Header */}
        <header className="flex items-center justify-between border-b border-border shrink-0 pl-12 md:pl-4 px-4 py-2 w-full">
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
        <div data-label="sidebar-content" className="flex-1 overflow-y-auto ">
          <SidebarSizeContext.Provider value={{ width }}>
            {children}
          </SidebarSizeContext.Provider>
        </div>
      </aside>
    );
  },
);

SidebarWrapper.displayName = "SidebarWrapper";
