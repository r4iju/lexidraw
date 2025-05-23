import type { JSX } from "react";

import { cn } from "~/lib/utils";

interface Props {
  className?: string;
  top?: number;
  left: number;
  color: string;
}

export const Pointer = ({
  className,
  color,
  left,
  top = 0.5,
}: Props): JSX.Element => {
  const style = {
    top: `${top * 100}%`,
    left: `${left * 100}%`,
  };

  return (
    <div
      className={cn(
        "absolute box-border size-[28px]",
        "-translate-x-1/2 -translate-y-1/2",
        "bg-transparent border-2 border-white rounded-full",
        "shadow-[0_2px_4px_rgba(0,0,0,0.2)]",
        "transition-transform duration-100 ease-in-out focus:scale-110",
        className,
      )}
      style={style}
    >
      <div
        className="absolute left-0 top-0 right-0 bottom-0 pointer-events-none border-radius-inherit rounded-full"
        style={{ backgroundColor: color, content: "" }}
      />
    </div>
  );
};
