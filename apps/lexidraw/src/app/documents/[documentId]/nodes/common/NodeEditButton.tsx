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
}: {
  /** What the button edits, as in "Edit drawing". */
  label: string;
  visible: boolean;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
  className?: string;
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
        "absolute top-1 right-1 z-10 gap-1.5 bg-media-overlay/65 text-media-overlay-foreground backdrop-blur-xs transition-opacity hover:bg-media-overlay/80 hover:text-media-overlay-foreground focus-visible:opacity-100 pointer-coarse:size-11 pointer-coarse:p-0 print:hidden",
        visible
          ? "opacity-100"
          : "pointer-events-none opacity-0 pointer-fine:group-hover/node:pointer-events-auto pointer-fine:group-hover/node:opacity-100",
        className,
      )}
    >
      <Pencil />
      <span className="pointer-coarse:sr-only">Edit</span>
    </Button>
  );
}
