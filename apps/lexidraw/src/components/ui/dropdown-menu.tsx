"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { flushSync } from "react-dom";

import { leaveThen } from "~/lib/leave-guard";
import { cn } from "~/lib/utils";
import { usePathname, useRouter } from "next/navigation";
import {
  InSheet,
  floating,
  floatingMotion,
  menuRow,
  sheet,
  useInSheet,
  useSheet,
} from "./overlay";

const DropdownMenuContext = React.createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  router: ReturnType<typeof useRouter>;
} | null>(null);

const DropdownMenu = ({
  children,
  open: openProp,
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>) => {
  const [uncontrolled, setUncontrolled] = React.useState(false);
  const open = openProp ?? uncontrolled;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  };
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => {
    // Reference pathname so linter recognizes this effect depends on it
    void pathname;
    setUncontrolled(false);
  }, [pathname]);

  return (
    <DropdownMenuPrimitive.Root open={open} onOpenChange={setOpen} {...props}>
      <DropdownMenuContext.Provider value={{ open, setOpen, router }}>
        {children}
      </DropdownMenuContext.Provider>
    </DropdownMenuPrimitive.Root>
  );
};

const DropdownMenuTrigger = ({
  children,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>) => {
  const context = React.useContext(DropdownMenuContext);
  if (context === null) {
    throw new Error("DropdownMenuTrigger must be used within a DropdownMenu");
  }
  const { open, setOpen } = context;
  const phone = useSheet();
  const onRelease = React.useRef(false);

  return (
    <DropdownMenuPrimitive.Trigger
      {...props}
      aria-expanded={open}
      // A finger, or any pointer on a phone, opens it as it lifts: opened as
      // it lands, the menu or sheet would be under it for the click after.
      onPointerDown={(event) => {
        props.onPointerDown?.(event);
        onRelease.current = phone || event.pointerType !== "mouse";
        if (onRelease.current) event.preventDefault();
      }}
      onClick={(event) => {
        props.onClick?.(event);
        if (!onRelease.current || event.defaultPrevented) return;
        onRelease.current = false;
        setOpen(!open);
      }}
    >
      {children}
    </DropdownMenuPrimitive.Trigger>
  );
};

DropdownMenuTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName;

const DropdownMenuGroup = DropdownMenuPrimitive.Group;

const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

const SubContext = React.createContext<{
  close: () => void;
  setTrigger: (node: HTMLDivElement | null) => void;
} | null>(null);

const DropdownMenuSub = ({
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Sub>) => {
  const [uncontrolled, setUncontrolled] = React.useState(defaultOpen);
  const open = openProp ?? uncontrolled;
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setUncontrolled(next);
    onOpenChange?.(next);
  };
  const trigger = React.useRef<HTMLDivElement>(null);
  const close = () => {
    // The parent sheet is hidden until the submenu closes; it must show
    // before its trigger can take focus.
    flushSync(() => setOpen(false));
    trigger.current?.focus();
  };
  const setTrigger = (node: HTMLDivElement | null) => {
    trigger.current = node;
  };
  return (
    <SubContext.Provider value={{ close, setTrigger }}>
      <DropdownMenuPrimitive.Sub
        open={open}
        onOpenChange={setOpen}
        {...props}
      />
    </SubContext.Provider>
  );
};

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

type DropdownMenuSubTriggerProps = React.ComponentPropsWithRef<
  typeof DropdownMenuPrimitive.SubTrigger
> & { chevronClassName?: string };

const DropdownMenuSubTrigger = ({
  className,
  chevronClassName,
  children,
  ref,
  onPointerMove,
  onPointerLeave,
  ...props
}: DropdownMenuSubTriggerProps) => {
  const sub = React.useContext(SubContext);
  const inSheet = useInSheet();
  return (
    <DropdownMenuPrimitive.SubTrigger
      ref={(node) => {
        sub?.setTrigger(node);
        if (typeof ref === "function") return ref(node);
        if (ref) ref.current = node;
      }}
      // In a sheet the submenu covers its parent; only a tap opens it.
      onPointerMove={(event) => {
        onPointerMove?.(event);
        if (inSheet) event.preventDefault();
      }}
      onPointerLeave={(event) => {
        onPointerLeave?.(event);
        if (inSheet) event.preventDefault();
      }}
      className={cn(menuRow, "data-[state=open]:bg-accent", className)}
      {...props}
    >
      {children}
      <ChevronRight
        data-chevron=""
        className={cn("ml-auto text-muted-foreground", chevronClassName)}
      />
    </DropdownMenuPrimitive.SubTrigger>
  );
};

DropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName;

type DropdownMenuSubContentProps = React.ComponentPropsWithRef<
  typeof DropdownMenuPrimitive.SubContent
>;

const DropdownMenuSubContent = ({
  className,
  children,
  collisionPadding = 8,
  ...props
}: DropdownMenuSubContentProps) => {
  const inSheet = useInSheet();
  const sub = React.useContext(SubContext);
  return (
    <DropdownMenuPrimitive.SubContent
      data-sheet={inSheet ? "" : undefined}
      collisionPadding={collisionPadding}
      className={cn(
        floating,
        "min-w-32 p-1",
        inSheet
          ? sheet
          : cn(
              floatingMotion,
              "max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto",
            ),
        className,
        inSheet && "w-screen max-w-none",
      )}
      {...props}
    >
      {inSheet && sub && (
        <DropdownMenuPrimitive.Item
          className={cn(menuRow, "text-muted-foreground")}
          onSelect={(event) => {
            event.preventDefault();
            sub.close();
          }}
        >
          <ChevronLeft />
          Back
        </DropdownMenuPrimitive.Item>
      )}
      {children}
    </DropdownMenuPrimitive.SubContent>
  );
};

DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName;

type DropdownMenuContentProps = React.ComponentPropsWithRef<
  typeof DropdownMenuPrimitive.Content
> & {
  /** Whether it may open as a bottom sheet on a phone. */
  sheet?: boolean;
};

const DropdownMenuContent = ({
  className,
  sideOffset = 4,
  collisionPadding = 8,
  sheet: sheetWanted = true,
  children,
  ...props
}: DropdownMenuContentProps) => {
  const asSheet = useSheet(sheetWanted);
  // Close synchronously on navigation-intent inside the menu
  const context = React.useContext(DropdownMenuContext);
  if (context === null) {
    throw new Error("DropdownMenuContent must be used within a DropdownMenu");
  }

  const handleNavigation = React.useEffectEvent(
    (href: string | null | undefined) => {
      if (!href) return;
      // Extract pathname from href (handle both absolute URLs and relative paths)
      const url = new URL(href, window.location.origin);
      const pathname = url.pathname + url.search + url.hash;
      // Close menu first
      context.setOpen(false);
      // Wait for close animation to complete (~200ms) before navigating
      setTimeout(() => {
        leaveThen(() => context.router.push(pathname));
      }, 200);
    },
  );

  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        // Links here navigate after the menu closes; see `lib/leave-guard.ts`.
        data-asks-before-leaving
        data-sheet={asSheet ? "" : undefined}
        className={cn(
          floating,
          "min-w-32 p-1",
          asSheet
            ? sheet
            : cn(
                floatingMotion,
                "max-h-(--radix-dropdown-menu-content-available-height) overflow-y-auto",
              ),
          className,
          asSheet && "w-screen max-w-none",
        )}
        onCloseAutoFocus={(e) => {
          // Avoid focusing trigger after close which can conflict with route change
          e.preventDefault();
        }}
        onClickCapture={(e) => {
          // Call user handler first
          props.onClickCapture?.(e);
          if (e.defaultPrevented) return;
          const el = e.target as HTMLElement | null;
          // A link to a new tab leaves this page alone, so it opens as is.
          if (el?.closest('a[target="_blank"]')) return;
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
            // A link to a new tab leaves this page alone, so it opens as is.
            if (el?.closest('a[target="_blank"]')) return;
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
        onEscapeKeyDown={(e) => {
          props.onEscapeKeyDown?.(e);
          if (!e.defaultPrevented) context.setOpen(false);
        }}
        onInteractOutside={(e) => {
          props.onInteractOutside?.(e);
          if (!e.defaultPrevented) context.setOpen(false);
        }}
        {...props}
      >
        <InSheet.Provider value={asSheet}>{children}</InSheet.Provider>
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
};

DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

type DropdownMenuItemProps = React.ComponentPropsWithRef<
  typeof DropdownMenuPrimitive.Item
>;

const DropdownMenuItem = ({ className, ...props }: DropdownMenuItemProps) => (
  <DropdownMenuPrimitive.Item className={cn(menuRow, className)} {...props} />
);

DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

type DropdownMenuCheckboxItemProps = React.ComponentPropsWithRef<
  typeof DropdownMenuPrimitive.CheckboxItem
>;

const DropdownMenuCheckboxItem = ({
  className,
  children,
  checked,
  ...props
}: DropdownMenuCheckboxItemProps) => (
  <DropdownMenuPrimitive.CheckboxItem
    className={cn(menuRow, className)}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex size-4 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
);

DropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName;

type DropdownMenuRadioItemProps = React.ComponentPropsWithRef<
  typeof DropdownMenuPrimitive.RadioItem
>;

const DropdownMenuRadioItem = ({
  className,
  children,
  ...props
}: DropdownMenuRadioItemProps) => (
  <DropdownMenuPrimitive.RadioItem
    className={cn(menuRow, className)}
    {...props}
  >
    <span className="absolute left-2 flex size-4 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
);

DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

type DropdownMenuLabelProps = React.ComponentPropsWithRef<
  typeof DropdownMenuPrimitive.Label
>;

const DropdownMenuLabel = ({ className, ...props }: DropdownMenuLabelProps) => (
  <DropdownMenuPrimitive.Label
    className={cn(
      "px-2 py-1.5 text-label font-medium text-muted-foreground",
      className,
    )}
    {...props}
  />
);

DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

type DropdownMenuSeparatorProps = React.ComponentPropsWithRef<
  typeof DropdownMenuPrimitive.Separator
>;

const DropdownMenuSeparator = ({
  className,
  ...props
}: DropdownMenuSeparatorProps) => (
  <DropdownMenuPrimitive.Separator
    className={cn("-mx-1 my-1 h-px bg-border", className)}
    {...props}
  />
);

DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

const DropdownMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn(
        "ml-auto pl-4 text-xs tracking-widest text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
};
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
};
