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
import { Maximize2, Minimize2, X } from "lucide-react";
import { useLayoutClass } from "~/hooks/use-media-query";
import { cn } from "~/lib/utils";
import { drawerMotion, scrimMotion, sheetMotion } from "./overlay";

interface SidebarWrapperProps {
  onClose: () => void;
  title: string;
  className?: string;
  initialWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  children: React.ReactNode;
  onWidthChange?: (width: number) => void;
  /** Whether the reader may drag its edge; otherwise it keeps initialWidth. */
  resizable?: boolean;
  /** Its width as a drawer over the page on a tablet. */
  drawerWidth?: number;
  /** How tall it opens as a sheet on a phone; half can be pulled up to near full. */
  phoneHeight?: "half" | "full";
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
      resizable = true,
      drawerWidth = 360,
      phoneHeight = "half",
    },
    ref: ForwardedRef<HTMLElement>,
  ) => {
    const [width, setWidth] = useState(initialWidth);
    const [isResizing, setIsResizing] = useState(false);
    const isResizingRef = useRef(false);
    const componentSidebarRef = useRef<HTMLElement>(null);
    const initialMouseXRef = useRef(0);
    const initialWidthRef = useRef(initialWidth);
    const layout = useLayoutClass();
    const docked = layout === "desktop";
    const [tall, setTall] = useState(phoneHeight === "full");
    // Closing plays the way out first; the page unmounts it once it has.
    const [closing, setClosing] = useState(false);
    const close = useCallback(() => setClosing(true), []);
    // Waits on the browser's animations of the sidebar's way out.
    useEffect(() => {
      if (!closing) return;
      let cancelled = false;
      const animations = componentSidebarRef.current?.getAnimations?.() ?? [];
      void Promise.allSettled(animations.map(({ finished }) => finished)).then(
        () => {
          if (!cancelled) onClose();
        },
      );
      return () => {
        cancelled = true;
      };
    }, [closing, onClose]);

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

    const handleResizeEndRef = useRef<() => void>(() => {});
    const handleResizeEndListener = useCallback(() => {
      handleResizeEndRef.current();
    }, []);

    const handleResizeEnd = useCallback(() => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      setIsResizing(false);

      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleResizeEndListener);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("touchend", handleResizeEndListener);
    }, [handleMouseMove, handleResizeEndListener, handleTouchMove]);

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
        document.addEventListener("mouseup", handleResizeEndListener);
        document.addEventListener("touchmove", handleTouchMove, {
          passive: false,
        });
        document.addEventListener("touchend", handleResizeEndListener);
      },
      [handleMouseMove, handleResizeEndListener, handleTouchMove],
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

    // Focus moves in as it opens, and back to where it was as it closes.
    useEffect(() => {
      const sidebar = componentSidebarRef.current;
      // Opened from a menu, focus goes back to the menu's button, and comes
      // in only once the menu, which holds focus while it closes, is gone.
      const fromMenu = document.activeElement?.closest('[role="menu"]');
      const previous = fromMenu
        ? document.querySelector('[aria-haspopup="menu"][data-state="open"]')
        : document.activeElement;
      sidebar?.focus({ preventScroll: true });
      const menuGone = new MutationObserver(() => {
        if (document.querySelector('[role="menu"]')) return;
        menuGone.disconnect();
        if (!sidebar?.contains(document.activeElement))
          sidebar?.focus({ preventScroll: true });
      });
      if (fromMenu)
        menuGone.observe(document.body, { childList: true, subtree: true });
      return () => {
        menuGone.disconnect();
        const focus = document.activeElement;
        if (focus === document.body || sidebar?.contains(focus)) {
          (previous as HTMLElement | null)?.focus?.({ preventScroll: true });
        }
      };
    }, []);

    useEffect(() => {
      return () => {
        if (isResizingRef.current) {
          document.removeEventListener("mousemove", handleMouseMove);
          document.removeEventListener("mouseup", handleResizeEndListener);
          document.removeEventListener("touchmove", handleTouchMove);
          document.removeEventListener("touchend", handleResizeEndListener);
        }
      };
    }, [handleMouseMove, handleResizeEndListener, handleTouchMove]);

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

    // Toasts centre on the page beside a docked sidebar.
    useEffect(() => {
      if (!docked) return;
      const root = document.documentElement;
      root.style.setProperty("--docked-sidebar-width", `${width}px`);
      return () => {
        root.style.removeProperty("--docked-sidebar-width");
      };
    }, [docked, width]);

    const shownWidth = docked
      ? width
      : layout === "tablet"
        ? drawerWidth
        : window.innerWidth;

    return (
      <>
        {!docked && (
          <button
            type="button"
            tabIndex={-1}
            aria-label={`Close ${title}`}
            onClick={close}
            data-state={closing ? "closed" : "open"}
            className={cn(
              "fixed inset-0 z-40 bg-scrim print:hidden",
              scrimMotion,
              tall && layout === "phone" && phoneHeight === "full" && "hidden",
            )}
          />
        )}
        <aside
          ref={(node) => {
            if (typeof ref === "function") {
              ref(node);
            } else if (ref) {
              ref.current = node;
            }
            componentSidebarRef.current = node;
          }}
          aria-label={title}
          tabIndex={-1}
          onKeyDown={(event) => {
            // Menus opened from inside it are portaled out, and close first.
            if (
              event.key === "Escape" &&
              event.currentTarget.contains(event.target as Node)
            ) {
              event.stopPropagation();
              close();
            }
          }}
          style={{ width: layout === "phone" ? undefined : `${shownWidth}px` }}
          data-state={closing ? "closed" : "open"}
          className={cn(
            "flex flex-col bg-card outline-hidden",
            layout === "phone" ? sheetMotion : drawerMotion,
            // Docked beside the page, pinned under its toolbar as it scrolls.
            docked &&
              "sticky top-(--page-toolbar-height,0px) h-[calc(var(--dynamic-viewport-height)-var(--page-toolbar-height,0px))] shrink-0 border-l border-border pb-[env(safe-area-inset-bottom)]",
            layout === "tablet" &&
              "fixed inset-y-0 right-0 z-40 max-w-[calc(100vw-3rem)] border-l border-border shadow-(--elevation-modal) pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
            layout === "phone" &&
              cn(
                "fixed inset-x-0 bottom-(--keyboard-inset) z-40 border-t border-border shadow-(--elevation-modal)",
                tall
                  ? phoneHeight === "full"
                    ? "top-0 pt-[env(safe-area-inset-top)]"
                    : "h-[calc(var(--dynamic-viewport-height)-var(--keyboard-inset)-3rem)] rounded-t-xl"
                  : "h-[50dvh] rounded-t-xl",
                "pb-[max(0px,env(safe-area-inset-bottom))]",
              ),
            className,
          )}
        >
          {resizable && docked && (
            // biome-ignore lint/a11y/useSemanticElements: todo: fix semantic elements
            <div
              onMouseDown={handleMouseDown}
              onTouchStart={handleTouchStart}
              className="absolute left-0 top-0 h-full w-4 cursor-col-resize group -translate-x-1/2 touch-none"
              // biome-ignore lint/a11y/useAriaPropsForRole: todo: fix aria props for role
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              tabIndex={0}
            >
              <div className="h-full w-[2px] bg-transparent group-hover:bg-primary transition-colors mx-auto pointer-events-none"></div>
            </div>
          )}

          <header className="flex items-center gap-1 border-b border-border shrink-0 px-4 py-2 w-full">
            <h2 className="text-lg font-semibold truncate mr-auto">{title}</h2>
            {layout === "phone" && phoneHeight === "half" && (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setTall((was) => !was)}
                aria-label={tall ? "Shrink" : "Expand"}
                aria-expanded={tall}
              >
                {tall ? (
                  <Minimize2 className="size-5" />
                ) : (
                  <Maximize2 className="size-5" />
                )}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={close}
              aria-label={`Close ${title}`}
            >
              <X className="h-5 w-5" />
            </Button>
          </header>

          <div
            data-label="sidebar-content"
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
          >
            <SidebarSizeContext.Provider value={{ width: shownWidth }}>
              {children}
            </SidebarSizeContext.Provider>
          </div>
        </aside>
      </>
    );
  },
);

SidebarWrapper.displayName = "SidebarWrapper";
