import { Card } from "~/components/ui/card";
import { Skeleton } from "~/components/ui/skeleton";

export function EntityCardSkeletonRow() {
  return (
    <Card className="relative flex flex-col gap-4 rounded-lg p-4 justify-between">
      {/* middle: date + actions */}
      <div className="flex justify-between items-center">
        <Skeleton className="h-4 w-24 block" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-md" />
        </div>
      </div>

      {/* right side */}
      <div className="flex flex-col items-center gap-4">
        <Skeleton className="h-6 w-40" />
        <Skeleton
          className="w-full rounded-lg"
          style={{ aspectRatio: "4 / 3" }}
        />
      </div>
    </Card>
  );
}
