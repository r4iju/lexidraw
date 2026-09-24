import type * as React from "react";
import { cn } from "~/lib/utils";

type RadioProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

/** A native radio drawn in the app's tokens; group them with a shared name. */
export const Radio = ({ className, ...props }: RadioProps) => (
  <input
    type="radio"
    className={cn(
      "size-4 shrink-0 cursor-pointer appearance-none rounded-full border border-input bg-background transition-[border-width] checked:border-[5px] checked:border-primary focus-visible:outline-hidden disabled:cursor-not-allowed",
      className,
    )}
    {...props}
  />
);
