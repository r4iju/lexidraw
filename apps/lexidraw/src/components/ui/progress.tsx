"use client";

import type * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "~/lib/utils";

type ProgressProps = React.ComponentPropsWithRef<typeof ProgressPrimitive.Root>;

const Progress = ({ className, value, max, ref, ...props }: ProgressProps) => {
  const effectiveMax = max ?? 100;
  const percentage = value ? (max ? (value / max) * 100 : value) : 0;
  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn(
        "relative h-4 w-full overflow-hidden rounded-full bg-secondary",
        className,
      )}
      max={effectiveMax}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-primary transition-all"
        style={{
          transform: `translateX(-${100 - percentage}%)`,
        }}
      />
    </ProgressPrimitive.Root>
  );
};
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
