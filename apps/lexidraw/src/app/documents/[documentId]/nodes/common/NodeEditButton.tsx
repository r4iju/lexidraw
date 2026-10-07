import { Pencil } from "lucide-react";
import type { Ref } from "react";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

/**
 * Opens a block's editor. It shows once the block is selected, or on hover
 * with a mouse, so that blocks read as content rather than controls; on
 * touch, selecting the block is the tap before it.
 *
 * Its parent needs `group/node` and a position.
 */
export function NodeEditButton({
  label,
  visible,
  onClick,
  ref,
  className,
  iconOnly,
}: {
  /** What the button edits, as in "Edit drawing". */
  label: string;
  visible: boolean;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
  className?: string;
  /** A 24px square without its word, for media too small for one. */
  iconOnly?: boolean;
}) {
  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn(
        "absolute top-1 right-1 z-10 h-6 gap-1 px-2 text-xs [&_svg]:size-3.5 bg-media-overlay/65 text-media-overlay-foreground backdrop-blur-xs transition-opacity hover:bg-media-overlay/80 hover:text-media-overlay-foreground focus-visible:opacity-100 pointer-coarse:size-11 pointer-coarse:p-0 print:hidden",
        iconOnly && "w-6 px-0",
        visible
          ? "opacity-100"
          : "pointer-events-none opacity-0 pointer-fine:group-hover/node:pointer-events-auto pointer-fine:group-hover/node:opacity-100",
        className,
      )}
    >
      <Pencil />
      <span className={iconOnly ? "sr-only" : "pointer-coarse:sr-only"}>
        Edit
      </span>
    </Button>
  );
}
