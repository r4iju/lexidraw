import { Skeleton } from "~/components/ui/skeleton";

export default function AdminEntitiesSkeleton() {
  return (
    <div className="rounded-md border border-border">
      <div className="border-b border-border p-4 text-sm font-medium">
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="overflow-x-auto p-2">
        <div className="grid grid-cols-6 gap-2 px-2 py-3">
          <Skeleton className="h-4 w-24 col-span-1" />
          <Skeleton className="h-4 w-40 col-span-1" />
          <Skeleton className="h-4 w-28 col-span-1" />
          <Skeleton className="h-4 w-28 col-span-1" />
          <Skeleton className="h-4 w-28 col-span-1" />
          <Skeleton className="h-4 w-20 col-span-1" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: 10 }).map((_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton items
            <div key={i} className="grid grid-cols-6 gap-2 px-2 py-3">
              <Skeleton className="h-4 w-56 col-span-2" />
              <Skeleton className="h-4 w-40 col-span-1" />
              <Skeleton className="h-4 w-24 col-span-1" />
              <Skeleton className="h-4 w-28 col-span-1" />
              <Skeleton className="h-4 w-20 col-span-1" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
