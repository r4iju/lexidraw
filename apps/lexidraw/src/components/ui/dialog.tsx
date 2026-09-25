"use client";

import type * as React from "react";
import { createContext, useContext } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "~/lib/utils";

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

type DialogOverlayProps = React.ComponentPropsWithRef<
  typeof DialogPrimitive.Overlay
>;

const DialogOverlay = ({ className, ...props }: DialogOverlayProps) => (
  <DialogPrimitive.Overlay
    data-backdrop=""
    className={cn(
      "fixed inset-0 z-50 bg-scrim data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
);

DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

/** A dialog opened from inside another shares its backdrop. */
const InsideDialog = createContext(false);

const sizes = {
  sm: "sm:max-w-[400px]",
  md: "sm:max-w-lg",
  lg: "sm:max-w-3xl",
  xl: "sm:max-w-5xl",
  full: "sm:max-w-none sm:w-[95vw] sm:h-[95dvh]",
};

/**
 * A dialog opens in 200ms and closes in 150ms, its backdrop in step; one that
 * is a sheet on a phone takes a sheet's 250ms and 200ms.
 */
const timing = {
  dialog:
    "data-[state=open]:duration-moderate data-[state=open]:ease-enter data-[state=closed]:duration-base data-[state=closed]:ease-exit",
  sheet:
    "max-sm:data-[state=open]:duration-slow max-sm:data-[state=closed]:duration-moderate",
};

/** Small dialogs rise from the bottom of a phone; editors take the screen. */
const phone = {
  sheet: `max-sm:inset-x-0 max-sm:top-auto max-sm:bottom-(--keyboard-inset) max-sm:w-full max-sm:max-h-[calc(var(--dynamic-viewport-height)-var(--keyboard-inset)-3rem)] max-sm:rounded-b-none max-sm:rounded-t-xl max-sm:border-x-0 max-sm:border-b-0 max-sm:p-4 max-sm:pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:data-[state=open]:slide-in-from-bottom max-sm:data-[state=closed]:slide-out-to-bottom max-sm:data-[state=open]:zoom-in-100 max-sm:data-[state=closed]:zoom-out-100 ${timing.sheet}`,
  screen:
    "max-sm:inset-x-0 max-sm:top-0 max-sm:w-full max-sm:h-[calc(var(--dynamic-viewport-height)-var(--keyboard-inset))] max-sm:max-h-none max-sm:rounded-none max-sm:border-0 max-sm:p-4 max-sm:pt-[max(1rem,env(safe-area-inset-top))] max-sm:pb-[max(1rem,env(safe-area-inset-bottom))]",
};

const isTextField = (node: Element | null) =>
  node instanceof HTMLTextAreaElement ||
  (node instanceof HTMLElement && node.isContentEditable) ||
  (node instanceof HTMLInputElement &&
    ![
      "checkbox",
      "radio",
      "button",
      "submit",
      "range",
      "color",
      "file",
    ].includes(node.type));

const coarse = () => window.matchMedia("(pointer: coarse)").matches;

type DialogContentProps = React.ComponentPropsWithRef<
  typeof DialogPrimitive.Content
> & {
  overlayClassName?: string;
  /** sm 400, md 512, lg 768, xl 1024 and full 95% of the screen. */
  size?: keyof typeof sizes;
};

const DialogContent = ({
  className,
  overlayClassName,
  size = "md",
  children,
  ref,
  onOpenAutoFocus,
  ...props
}: DialogContentProps) => {
  const nested = useContext(InsideDialog);
  const asSheet = size !== "xl" && size !== "full";
  return (
    <DialogPortal>
      {!nested && (
        <DialogOverlay
          className={cn(
            timing.dialog,
            asSheet && timing.sheet,
            overlayClassName,
          )}
        />
      )}
      <DialogPrimitive.Content
        ref={(node) => {
          // A field that takes focus on a touch screen raises the keyboard
          // over the dialog before it is read.
          if (node && coarse() && isTextField(document.activeElement)) {
            node.focus();
          }
          if (typeof ref === "function") return ref(node);
          if (ref) ref.current = node;
        }}
        onOpenAutoFocus={(event) => {
          onOpenAutoFocus?.(event);
          if (event.defaultPrevented || !coarse()) return;
          event.preventDefault();
          (event.target as HTMLElement | null)?.focus();
        }}
        className={cn(
          "fixed left-[50%] top-[50%] z-50 grid translate-x-[-50%] translate-y-[-50%] gap-4 elevation-modal p-6 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 rounded-lg outline-hidden",
          "w-[calc(100vw-2rem)] max-h-[calc(var(--dynamic-viewport-height)-2rem)] overflow-y-auto overscroll-contain",
          "max-sm:translate-x-0 max-sm:translate-y-0 max-sm:left-0",
          sizes[size],
          timing.dialog,
          asSheet ? phone.sheet : phone.screen,
          // Long words wrap whole; only a token or URL too long for a line breaks.
          "min-w-0 overflow-x-hidden break-words",
          className,
        )}
        {...props}
      >
        <InsideDialog.Provider value={true}>{children}</InsideDialog.Provider>
        <DialogPrimitive.Close className="absolute right-3 top-3 z-10 rounded-sm size-8 pointer-coarse:size-11 flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground hover:bg-muted focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none max-sm:top-[max(0.75rem,env(safe-area-inset-top))]">
          <X className="size-5" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPortal>
  );
};

DialogContent.displayName = DialogPrimitive.Content.displayName;

type DialogHeaderProps = React.HTMLAttributes<HTMLDivElement>;

const DialogHeader = ({ className, ...props }: DialogHeaderProps) => (
  <div
    className={cn(
      "flex flex-col gap-1.5 text-left min-w-0 max-w-full pr-10 pointer-coarse:pr-12",
      className,
    )}
    {...props}
  />
);

DialogHeader.displayName = "DialogHeader";

type DialogFooterProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Cancel, then the action on the right; on a phone they stack, the action on
 * top, and stay above the keyboard while the dialog scrolls.
 */
const DialogFooter = ({ className, ...props }: DialogFooterProps) => (
  <div
    className={cn(
      "flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end min-w-0 max-w-full",
      "max-sm:sticky max-sm:bottom-0 max-sm:-mx-4 max-sm:mb-[calc(-1*max(1rem,env(safe-area-inset-bottom)))] max-sm:px-4 max-sm:pt-3 max-sm:pb-[max(1rem,env(safe-area-inset-bottom))] max-sm:bg-popover max-sm:border-t max-sm:border-border-subtle",
      className,
    )}
    {...props}
  />
);

DialogFooter.displayName = "DialogFooter";

type DialogTitleProps = React.ComponentPropsWithRef<
  typeof DialogPrimitive.Title
>;

const DialogTitle = ({ className, ...props }: DialogTitleProps) => (
  <DialogPrimitive.Title
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className,
    )}
    {...props}
  />
);

DialogTitle.displayName = DialogPrimitive.Title.displayName;

type DialogDescriptionProps = React.ComponentPropsWithRef<
  typeof DialogPrimitive.Description
>;

const DialogDescription = ({ className, ...props }: DialogDescriptionProps) => (
  <DialogPrimitive.Description
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
);

DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
