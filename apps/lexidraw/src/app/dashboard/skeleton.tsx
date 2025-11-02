import { Skeleton } from "~/components/ui/skeleton";
import { EntityCardSkeleton } from "./entity-card-skeleton";
import { cn } from "~/lib/utils";

type Props = {
  flex?: "flex-row" | "flex-col";
};

export function DashboardSkeleton({ flex = "flex-row" }: Props) {
  return (
    <main className="flex size-full min-h-0 flex-col overflow-auto pb-6 px-4">
      {/* Breadcrumb: each ancestor is droppable */}
      <nav className="flex flex-col space-x-2 md:px-8 py-2 gap-y-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center space-x-2 truncate">
            <Skeleton className="h-6 w-16" />
          </div>
          <Skeleton className="h-10 w-24 rounded-md" />
        </div>
        <div className="flex flex-col-reverse md:flex-col-reverse items-stretch gap-2">
          {/* Search bar */}
          <Skeleton className="h-12 md:h-10 w-full rounded-md" />
          <div className="flex flex-wrap justify-end gap-x-2 gap-y-2 w-full md:w-auto md:self-end">
            {/* Filter buttons */}
            <Skeleton className="h-10 w-20 rounded-md" />
            <div className="flex gap-2">
              <Skeleton className="h-10 w-10 md:w-20 rounded-md" />
              <Skeleton className="h-10 w-10 md:w-20 rounded-md" />
            </div>
            <Skeleton className="h-10 w-10 rounded-md" />
            <Skeleton className="h-10 w-10 rounded-md" />
            <Skeleton className="h-10 w-10 rounded-md" />
          </div>
        </div>
      </nav>

      <div className="flex-1 md:container">
        <section className="w-full">
          <div
            className={cn(
              "grid auto-rows-auto",
              flex === "flex-row" &&
                "gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3",
              flex === "flex-col" && "gap-2 grid-cols-1",
            )}
          >
            {Array.from({ length: 9 }).map((_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: skeleton item
              <EntityCardSkeleton key={index} flex={flex} />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
