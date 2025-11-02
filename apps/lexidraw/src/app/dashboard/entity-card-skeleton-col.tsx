import { Card } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";

export function EntityCardSkeletonCol() {
  return (
    <Card className="relative grid grid-cols-[auto_1fr_auto] gap-4 rounded-lg p-0 items-center">
      {/* thumbnail column */}
      <Skeleton className="h-18.5 aspect-4/3 shrink-0 rounded-none" />

      {/* title column */}
      <Skeleton className="h-5 w-full" />

      {/* date + actions column */}
      <div className="flex justify-between items-center gap-4 px-4 py-4 max-w-[200px]">
        <Skeleton className="h-4 w-24 hidden md:block" />
        <div className="flex items-center gap-2 shrink-0">
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>
    </Card>
  );
}
