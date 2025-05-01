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

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isResizingRef.current) return;
      const currentMouseX = e.clientX;
      const deltaX = initialMouseXRef.current - currentMouseX;
      let newWidth = initialWidthRef.current + deltaX;

      if (minWidth !== undefined) {
        newWidth = Math.max(minWidth, newWidth);
      }
      if (maxWidth !== undefined) {
        newWidth = Math.min(maxWidth, newWidth);
      }

      setWidth(newWidth);
    },
    [minWidth, maxWidth],
  );

  const handleMouseUp = useCallback(() => {
    isResizingRef.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!sidebarRef.current) return;
      isResizingRef.current = true;
      initialMouseXRef.current = e.clientX;
      initialWidthRef.current = sidebarRef.current.offsetWidth;
      e.preventDefault();
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [handleMouseMove, handleMouseUp],
  );

  useEffect(() => {
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <aside
      ref={sidebarRef}
      style={{ width: `${width}px` }}
      className={cn(
        "fixed right-0 top-0 h-full flex flex-col border-l bg-popover shadow-lg transition-transform duration-300 ease-in-out z-40",
        {
          "translate-x-0": isOpen,
          "translate-x-full": !isOpen,
        },
        className,
      )}
    >
      <div
        onMouseDown={handleMouseDown}
        className="absolute left-0 top-0 h-full w-2 cursor-col-resize group"
        style={{ transform: "translateX(-50%)" }}
      >
        <div className="h-full w-[2px] bg-transparent group-hover:bg-primary transition-colors duration-200 mx-auto"></div>
      </div>

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
      <div className="flex-1 overflow-y-auto">{children}</div>
    </aside>
  );
};
