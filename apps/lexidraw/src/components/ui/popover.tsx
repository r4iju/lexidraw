"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { usePathname, useRouter } from "next/navigation";

import { leaveThen } from "~/lib/leave-guard";
import { cn } from "~/lib/utils";
import { floating, floatingMotion, sheet, useSheet } from "./overlay";

const PopoverContext = React.createContext<{
  onOpenChange: (open: boolean) => void;
  router: ReturnType<typeof useRouter>;
} | null>(null);

const Popover = ({
  children,
  open,
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>) => {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const pathname = usePathname();
  const router = useRouter();

  const isControlled = open !== undefined;
  const currentOpen = isControlled ? open : internalOpen;
  const handleOpenChange = React.useCallback(
    (value: boolean) => {
      if (isControlled) {
        onOpenChange?.(value);
      } else {
        setInternalOpen(value);
      }
    },
    [isControlled, onOpenChange],
  );

  React.useEffect(() => {
    void pathname;
    handleOpenChange(false);
  }, [pathname, handleOpenChange]);

  return (
    <PopoverPrimitive.Root
      open={currentOpen}
      onOpenChange={handleOpenChange}
      {...props}
    >
      <PopoverContext.Provider
        value={{ onOpenChange: handleOpenChange, router }}
      >
        {children}
      </PopoverContext.Provider>
    </PopoverPrimitive.Root>
  );
};

const PopoverTrigger = PopoverPrimitive.Trigger;

const PopoverAnchor = PopoverPrimitive.Anchor;

type PopoverContentProps = React.ComponentPropsWithRef<
  typeof PopoverPrimitive.Content
> & {
  /**
   * How it opens on a phone: as a bottom sheet, a half-height one, or beside
   * its trigger (`false`) for content tied to what it points at.
   */
  sheet?: boolean | "half";
};

const PopoverContent = ({
  className,
  align = "center",
  sideOffset = 4,
  collisionPadding = 8,
  sheet: sheetWanted = true,
  ...props
}: PopoverContentProps) => {
  const asSheet = useSheet(sheetWanted !== false);
  const context = React.useContext(PopoverContext);

  const handleNavigation = React.useEffectEvent(
    (href: string | null | undefined) => {
      if (!href || !context) return;
      // Extract pathname from href (handle both absolute URLs and relative paths)
      const url = new URL(href, window.location.origin);
      const pathname = url.pathname + url.search + url.hash;
      // Close popover first
      context.onOpenChange(false);
      // Wait for close animation to complete (~200ms) before navigating
      setTimeout(() => {
        leaveThen(() => context.router.push(pathname));
      }, 200);
    },
  );

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        // Links here navigate after the popover closes; see `lib/leave-guard.ts`.
        data-asks-before-leaving
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        data-sheet={asSheet ? "" : undefined}
        className={cn(
          floating,
          "w-72 p-4",
          asSheet
            ? sheet
            : cn(
                floatingMotion,
                "max-h-(--radix-popover-content-available-height) overflow-y-auto",
              ),
          className,
          asSheet &&
            "w-screen max-w-none pb-[max(1rem,env(safe-area-inset-bottom))]",
          asSheet && sheetWanted === "half" && "h-[50dvh]",
        )}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onClickCapture={(e) => {
          props.onClickCapture?.(e);
          if (e.defaultPrevented) return;
          const el = e.target as HTMLElement | null;
          const linkEl = el?.closest<HTMLAnchorElement>("a[href]");
          const buttonEl = el?.closest<HTMLButtonElement>(
            "button[role='menuitem'], a[role='menuitem'], [data-navigate]",
          );
          if (linkEl) {
            e.preventDefault();
            e.stopPropagation();
            handleNavigation(linkEl.href);
          } else if (buttonEl) {
            const href =
              buttonEl.getAttribute("href") || buttonEl.dataset.navigate;
            if (href) {
              e.preventDefault();
              e.stopPropagation();
              handleNavigation(href);
            }
          }
        }}
        onKeyDownCapture={(e) => {
          props.onKeyDownCapture?.(e);
          if (e.defaultPrevented) return;
          if (e.key === "Enter" || e.key === " ") {
            const el = e.target as HTMLElement | null;
            const linkEl = el?.closest<HTMLAnchorElement>("a[href]");
            const buttonEl = el?.closest<HTMLButtonElement>(
              "button[role='menuitem'], a[role='menuitem'], [data-navigate]",
            );
            if (linkEl) {
              e.preventDefault();
              e.stopPropagation();
              handleNavigation(linkEl.href);
            } else if (buttonEl) {
              const href =
                buttonEl.getAttribute("href") || buttonEl.dataset.navigate;
              if (href) {
                e.preventDefault();
                e.stopPropagation();
                handleNavigation(href);
              }
            }
          }
        }}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
};

PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverAnchor, PopoverTrigger, PopoverContent };
