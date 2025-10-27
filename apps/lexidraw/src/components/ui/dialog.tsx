"use client";

import type * as React from "react";
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
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
);

DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogContentProps = React.ComponentPropsWithRef<
  typeof DialogPrimitive.Content
> & {
  overlayClassName?: string;
};

const DialogContent = ({
  className,
  overlayClassName,
  children,
  ...props
}: DialogContentProps) => (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    <DialogPrimitive.Content
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid translate-x-[-50%] translate-y-[-50%] gap-4 border border-border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-lg",
        // Viewport clamping and containment
        "w-[calc(100dvw-32px)] max-w-full md:max-w-lg max-h-[calc(100dvh-32px)]",
        // Prevent horizontal bleed and force wrapping for long tokens
        "min-w-0 overflow-x-hidden break-words break-all",
        className,
      )}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm size-7 flex items-center justify-center opacity-70 ring-offset-background transition-all hover:opacity-100 hover:bg-muted focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
        <X className="size-5" />
        <span className="sr-only">Close</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
);

DialogContent.displayName = DialogPrimitive.Content.displayName;

type DialogHeaderProps = React.HTMLAttributes<HTMLDivElement>;

const DialogHeader = ({ className, ...props }: DialogHeaderProps) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left min-w-0 max-w-full overflow-x-hidden",
      className,
    )}
    {...props}
  />
);

DialogHeader.displayName = "DialogHeader";

type DialogFooterProps = React.HTMLAttributes<HTMLDivElement>;

const DialogFooter = ({ className, ...props }: DialogFooterProps) => (
  <div
    className={cn(
      "flex flex-row justify-between gap-x-2 min-w-0 max-w-full overflow-x-hidden",
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
