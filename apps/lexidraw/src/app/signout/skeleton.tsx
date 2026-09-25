import { Skeleton } from "~/components/ui/skeleton";

export default function FormSkeleton() {
  return (
    <div className="flex justify-end gap-3">
      <Skeleton className="h-10 w-20" />
      <Skeleton className="h-10 w-24" />
    </div>
  );
}
