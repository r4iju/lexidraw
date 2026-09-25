"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "~/lib/utils";
import { floating, floatingMotion, menuRow, sheet, useSheet } from "./overlay";

type SelectProps = React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root>;

const SelectContext = React.createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
} | null>(null);

const Select = ({ children, ...props }: SelectProps) => {
  // If open is not controlled, we'll manage it internally
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isControlled = props.open !== undefined;
  const open: boolean = isControlled ? (props.open as boolean) : internalOpen;
  const onOpenChange = isControlled
    ? props.onOpenChange
    : (newOpen: boolean) => {
        setInternalOpen(newOpen);
      };

  return (
    <SelectPrimitive.Root {...props} open={open} onOpenChange={onOpenChange}>
      <SelectContext.Provider
        value={{
          open,
          setOpen: (newOpen: boolean) => {
            if (isControlled) {
              props.onOpenChange?.(newOpen);
            } else {
              setInternalOpen(newOpen);
            }
          },
        }}
      >
        {children}
      </SelectContext.Provider>
    </SelectPrimitive.Root>
  );
};

const SelectGroup = SelectPrimitive.Group;

const SelectValue = SelectPrimitive.Value;

type SelectTriggerProps = React.ComponentPropsWithRef<
  typeof SelectPrimitive.Trigger
>;

const SelectTrigger = ({
  className,
  children,
  ...props
}: SelectTriggerProps) => (
  <SelectPrimitive.Trigger
    className={cn(
      "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown className="h-4 w-4 opacity-50" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
);

SelectTrigger.displayName = SelectPrimitive.Trigger.displayName;

type SelectScrollUpButtonProps = React.ComponentPropsWithRef<
  typeof SelectPrimitive.ScrollUpButton
>;

const SelectScrollUpButton = ({
  className,
  ...props
}: SelectScrollUpButtonProps) => (
  <SelectPrimitive.ScrollUpButton
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className,
    )}
    {...props}
  >
    <ChevronUp className="h-4 w-4" />
  </SelectPrimitive.ScrollUpButton>
);

SelectScrollUpButton.displayName = SelectPrimitive.ScrollUpButton.displayName;

type SelectScrollDownButtonProps = React.ComponentPropsWithRef<
  typeof SelectPrimitive.ScrollDownButton
>;

const SelectScrollDownButton = ({
  className,
  ...props
}: SelectScrollDownButtonProps) => (
  <SelectPrimitive.ScrollDownButton
    className={cn(
      "flex cursor-default items-center justify-center py-1",
      className,
    )}
    {...props}
  >
    <ChevronDown className="h-4 w-4" />
  </SelectPrimitive.ScrollDownButton>
);

SelectScrollDownButton.displayName =
  SelectPrimitive.ScrollDownButton.displayName;

type SelectContentProps = React.ComponentPropsWithRef<
  typeof SelectPrimitive.Content
> & {
  /** Whether it may open as a bottom sheet on a phone. */
  sheet?: boolean;
};

const SelectContent = ({
  className,
  children,
  position = "popper",
  collisionPadding = 8,
  sheet: sheetWanted = true,
  ...props
}: SelectContentProps) => {
  const asSheet = useSheet(sheetWanted) && position === "popper";
  const context = React.useContext(SelectContext);
  if (context === null) {
    throw new Error("SelectContent must be used within Select");
  }

  const closeNow = React.useEffectEvent(() => context.setOpen(false));

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-sheet={asSheet ? "" : undefined}
        className={cn(
          floating,
          "relative min-w-32 overflow-hidden",
          asSheet
            ? sheet
            : cn(
                floatingMotion,
                "max-h-(--radix-select-content-available-height)",
                position === "popper" &&
                  "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
              ),
          className,
          asSheet && "w-screen max-w-none",
        )}
        position={position}
        collisionPadding={position === "popper" ? collisionPadding : undefined}
        onClickCapture={(e) => {
          props.onClickCapture?.(e);
          if (e.defaultPrevented) return;
          const el = e.target as HTMLElement | null;
          // Don't close on [role='option'] - let Radix UI handle selection
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
          if (e.key === "Enter" || e.key === " ") {
            const el = e.target as HTMLElement | null;
            // Don't close on [role='option'] - let Radix UI handle selection
            if (
              el?.closest(
                "a[href], button[role='menuitem'], a[role='menuitem'], [data-navigate]",
              )
            ) {
              closeNow();
            }
          }
        }}
        onEscapeKeyDown={(e) => {
          props.onEscapeKeyDown?.(e);
          if (!e.defaultPrevented) closeNow();
        }}
        onPointerDownOutside={(e) => {
          props.onPointerDownOutside?.(e);
          if (!e.defaultPrevented) closeNow();
        }}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          className={cn(
            "p-1",
            position === "popper" &&
              !asSheet &&
              "h-(--radix-select-trigger-height) w-full min-w-(--radix-select-trigger-width)",
          )}
        >
          {children}
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
};

SelectContent.displayName = SelectPrimitive.Content.displayName;

type SelectLabelProps = React.ComponentPropsWithRef<
  typeof SelectPrimitive.Label
>;

const SelectLabel = ({ className, ...props }: SelectLabelProps) => (
  <SelectPrimitive.Label
    className={cn(
      "py-1.5 pl-8 pr-2 text-label font-medium text-muted-foreground",
      className,
    )}
    {...props}
  />
);

SelectLabel.displayName = SelectPrimitive.Label.displayName;

type SelectItemProps = React.ComponentPropsWithRef<typeof SelectPrimitive.Item>;

const SelectItem = ({ className, children, ...props }: SelectItemProps) => (
  <SelectPrimitive.Item className={cn(menuRow, "w-full", className)} {...props}>
    <span className="absolute left-2 flex size-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
);

SelectItem.displayName = SelectPrimitive.Item.displayName;

type SelectSeparatorProps = React.ComponentPropsWithRef<
  typeof SelectPrimitive.Separator
>;

const SelectSeparator = ({ className, ...props }: SelectSeparatorProps) => (
  <SelectPrimitive.Separator
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
);

SelectSeparator.displayName = SelectPrimitive.Separator.displayName;

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
};
