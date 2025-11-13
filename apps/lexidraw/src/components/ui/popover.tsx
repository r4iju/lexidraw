"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { usePathname, useRouter } from "next/navigation";

import { cn } from "~/lib/utils";

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

type PopoverContentProps = React.ComponentPropsWithRef<
  typeof PopoverPrimitive.Content
>;

const PopoverContent = ({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: PopoverContentProps) => {
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
        context.router.push(pathname);
      }, 200);
    },
  );

  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-72 rounded-md border border-border bg-popover p-4 text-popover-foreground shadow-md outline-hidden data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          className,
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

export { Popover, PopoverTrigger, PopoverContent };
