"use client";

import * as React from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { usePathname } from "next/navigation";

import { cn } from "~/lib/utils";

const PopoverContext = React.createContext<{
  onOpenChange: (open: boolean) => void;
} | null>(null);

const Popover = ({
  children,
  open,
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof PopoverPrimitive.Root>) => {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const pathname = usePathname();

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
      <PopoverContext.Provider value={{ onOpenChange: handleOpenChange }}>
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
  const closeNow = React.useEffectEvent(() => {
    context?.onOpenChange(false);
  });

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
          if (
            el?.closest(
              "a[href], button[role='menuitem'], a[role='menuitem'], [data-navigate]",
            )
          ) {
            closeNow();
          }
        }}
        onKeyDownCapture={(e) => {
          props.onKeyDownCapture?.(e);
          if (e.defaultPrevented) return;
          if (
            (e.key === "Enter" || e.key === " ") &&
            (e.target as HTMLElement | null)?.closest(
              "a[href], button[role='menuitem'], a[role='menuitem'], [data-navigate]",
            )
          ) {
            closeNow();
          }
        }}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
};

PopoverContent.displayName = PopoverPrimitive.Content.displayName;

export { Popover, PopoverTrigger, PopoverContent };
