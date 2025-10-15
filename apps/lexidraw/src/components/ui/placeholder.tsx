import type * as React from "react";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";

export default function Placeholder({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={cn(
        "absolute text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap inline-block pointer-events-none select-none top-2 left-2",
        className,
      )}
    >
      {children}
    </div>
  );
}
