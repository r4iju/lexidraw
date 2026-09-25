import { Skeleton } from "~/components/ui/skeleton";

export default function FormSkeleton() {
  return (
    <div className="space-y-8 py-2">
      <Skeleton className="h-[42px] w-full" />
      {Array.from({ length: 2 }, (_, i) => (
        <Skeleton
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholder fields
          key={i}
          className="h-[42px] w-full"
        />
      ))}
      <Skeleton className="h-[42px] w-full" />
    </div>
  );
}
