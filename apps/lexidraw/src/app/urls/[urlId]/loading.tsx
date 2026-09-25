import { AppBar, Crumb } from "~/components/app-bar/app-bar";
import { Skeleton } from "~/components/ui/skeleton";

export default function Loading() {
  return (
    <AppBar
      account={undefined}
      crumbs={
        <Crumb current>
          <Skeleton className="mx-1.5 h-4 w-32" />
        </Crumb>
      }
    />
  );
}
