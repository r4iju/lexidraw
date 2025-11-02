import { Card } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

type Props = {
  flex: "flex-row" | "flex-col";
};

export function EntityCardSkeleton({ flex }: Props) {
  return (
    <Card
      className={cn(
        "relative flex gap-4 rounded-lg p-4 justify-between",
        flex === "flex-row" && "flex-col",
        flex === "flex-col" && "flex-row",
      )}
    >
      {/* left side - only visible in flex-col */}
      <div
        className={cn(
          "flex flex-row items-center gap-4",
          flex === "flex-row" && "hidden",
        )}
      >
        <Skeleton className="size-10 min-w-10 rounded-sm" />
        <Skeleton className="h-5 w-32" />
      </div>

      {/* middle: date + actions */}
      <div className="flex justify-between items-center">
        <Skeleton
          className={cn(
            "h-4 w-24",
            flex === "flex-row" ? "block" : "hidden md:block",
          )}
        />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>

      {/* right side (if flex-row) */}
      <div
        className={cn(
          "items-center gap-4",
          flex === "flex-row" ? "flex flex-col" : "hidden",
        )}
      >
        <Skeleton className="h-6 w-40" />
        <Skeleton
          className="w-full rounded-lg"
          style={{ aspectRatio: "4 / 3" }}
        />
      </div>

      {/* "open" button if flex-row */}
      {flex === "flex-row" && (
        <Skeleton className="mt-2 h-10 w-full rounded-md" />
      )}
    </Card>
  );
}
