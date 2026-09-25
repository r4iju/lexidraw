import type * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { LoaderCircleIcon } from "lucide-react";

import { cn } from "~/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-md text-label font-medium ring-offset-background transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90",
        destructive:
          "border border-destructive bg-transparent text-destructive hover:bg-accent",
        "destructive-confirm":
          "bg-destructive-bg text-destructive-foreground hover:bg-destructive-bg/90",
        outline:
          "border border-input bg-transparent hover:bg-accent hover:text-accent-foreground",
        on: "state-on hover:bg-on",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2 pointer-coarse:h-11",
        sm: "h-9 rounded-md px-3 pointer-coarse:h-11",
        lg: "h-11 rounded-md px-8",
        icon: "size-10 pointer-coarse:size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

// with ref
export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    ref?: React.Ref<HTMLButtonElement>;
  } & (
    | { asChild: true; pending?: never }
    | {
        asChild?: false;
        /**
         * Working: a spinner shows over the label, which keeps the button's
         * size and its name. A button that can be pending says so from the
         * start, even as false, so its content is laid out the same either
         * way.
         */
        pending?: boolean;
      }
  );

const Button = ({
  className,
  variant,
  size,
  asChild,
  ref,
  pending,
  children,
  ...props
}: ButtonProps) => {
  if (asChild || pending === undefined) {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        data-variant={variant ?? "default"}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      >
        {children}
      </Comp>
    );
  }
  return (
    <button
      ref={ref}
      data-variant={variant ?? "default"}
      aria-busy={pending || undefined}
      className={cn("relative", buttonVariants({ variant, size, className }))}
      {...props}
    >
      <span
        className={cn(
          "inline-flex items-center justify-center gap-[inherit]",
          pending && "opacity-0",
        )}
      >
        {children}
      </span>
      {pending && (
        <LoaderCircleIcon
          aria-hidden="true"
          className="absolute inset-0 m-auto size-4 animate-spin"
        />
      )}
    </button>
  );
};

Button.displayName = "Button";

export { Button, buttonVariants };
