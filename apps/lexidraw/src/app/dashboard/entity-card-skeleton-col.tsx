import { Card } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";

export function EntityCardSkeletonCol() {
  return (
    <Card className="relative flex flex-row gap-4 rounded-lg p-4 justify-between">
      {/* left side */}
      <div className="flex flex-row items-center gap-4">
        <Skeleton className="size-10 min-w-10 rounded-sm" />
        <Skeleton className="h-5 w-32" />
      </div>

      {/* middle: date + actions */}
      <div className="flex justify-between items-center">
        <Skeleton className="h-4 w-24 hidden md:block" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>
    </Card>
  );
}
