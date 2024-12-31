"use client";

import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";

import { cn } from "~/lib/utils";

type ProgressProps = React.ComponentPropsWithRef<typeof ProgressPrimitive.Root>;

const Progress = ({ className, value, max, ref, ...props }: ProgressProps) => {
  console.log("progress", { max, value });
  return (
    <ProgressPrimitive.Root
      ref={ref}
      className={cn(
        "relative h-4 w-full overflow-hidden rounded-full bg-secondary",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full w-full flex-1 bg-primary transition-all"
        style={{
          transform: `translateX(-${max ? 100 - (value ? (value / max) * 100 : 0) : 0}%)`,
        }}
      />
    </ProgressPrimitive.Root>
  );
};
Progress.displayName = ProgressPrimitive.Root.displayName;

export { Progress };
