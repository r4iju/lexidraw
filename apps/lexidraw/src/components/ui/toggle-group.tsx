"use client";

import * as React from "react";
import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import type { VariantProps } from "class-variance-authority";

import { cn } from "~/lib/utils";
import { toggleVariants } from "~/components/ui/toggle";

const ToggleGroupContext = React.createContext<
  VariantProps<typeof toggleVariants>
>({
  size: "default",
  variant: "default",
});

type ToggleGroupProps = React.ComponentPropsWithRef<
  typeof ToggleGroupPrimitive.Root
> &
  VariantProps<typeof toggleVariants>;

const ToggleGroup = ({
  className,
  variant,
  size,
  children,
  ...props
}: ToggleGroupProps) => (
  <ToggleGroupPrimitive.Root
    className={cn("flex items-center justify-center gap-1", className)}
    {...props}
  >
    <ToggleGroupContext.Provider value={{ variant, size }}>
      {children}
    </ToggleGroupContext.Provider>
  </ToggleGroupPrimitive.Root>
);

ToggleGroup.displayName = ToggleGroupPrimitive.Root.displayName;

type ToggleGroupItemProps = React.ComponentPropsWithRef<
  typeof ToggleGroupPrimitive.Item
> &
  VariantProps<typeof toggleVariants>;

const ToggleGroupItem = ({
  className,
  children,
  variant,
  size,
  ...props
}: ToggleGroupItemProps) => {
  const context = React.useContext(ToggleGroupContext);

  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        toggleVariants({
          variant: context.variant || variant,
          size: context.size || size,
        }),
        className,
      )}
      {...props}
    >
      {children}
    </ToggleGroupPrimitive.Item>
  );
};

ToggleGroupItem.displayName = ToggleGroupPrimitive.Item.displayName;

export { ToggleGroup, ToggleGroupItem };
