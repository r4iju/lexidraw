import { cn } from "~/lib/utils";

/** Where content will be, shown only once it has kept a reader waiting. */
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-skeleton rounded-md bg-foreground/6", className)}
      {...props}
    />
  );
}

export { Skeleton };
