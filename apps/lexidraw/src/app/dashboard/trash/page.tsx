import type { Metadata } from "next";
import { Suspense } from "react";
import { AppBar, Crumb } from "~/components/app-bar/app-bar";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";
import { appBarAccount } from "~/server/app-bar-account";
import { api } from "~/trpc/server";
import { GUTTER } from "../utils";
import { TrashList } from "./trash-list";

export const metadata: Metadata = { title: "Trash" };

const crumbs = (
  <Crumb current>
    <span className="truncate px-1.5 font-medium">Trash</span>
  </Crumb>
);

async function SignedInAppBar() {
  return <AppBar account={await appBarAccount()} crumbs={crumbs} />;
}

async function TrashContent() {
  return <TrashList items={await api.entities.trash.query()} />;
}

function TrashSkeleton() {
  return (
    <div
      aria-busy="true"
      className="grid grid-cols-1 divide-y divide-border rounded-lg border border-border bg-card"
    >
      {Array.from({ length: 4 }, (_, index) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
          key={index}
          className="flex h-14 items-center gap-3 pr-2 pl-2 sm:pl-3"
        >
          <Skeleton className="size-10 shrink-0 rounded-md" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-3.5 w-1/3 min-w-24" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-9 w-20" />
        </div>
      ))}
    </div>
  );
}

/** The caller's deleted files, which only they can see or restore. */
export default function TrashPage() {
  return (
    <>
      <Suspense fallback={<AppBar account={undefined} crumbs={crumbs} />}>
        <SignedInAppBar />
      </Suspense>
      <main
        id="main-content"
        tabIndex={-1}
        className="flex min-h-0 w-full flex-1 flex-col overflow-auto"
      >
        <div className={cn(GUTTER, "flex flex-col gap-1 py-3")}>
          <h1 className="flex min-h-10 items-center text-title font-semibold">
            Trash
          </h1>
          <p className="text-sm text-muted-foreground">
            Restoring a file puts it back in its folder, or in Home when that
            folder is gone or you can no longer add to it.
          </p>
        </div>
        <div className={cn(GUTTER, "flex-1 pb-8 pt-2")}>
          <Suspense fallback={<TrashSkeleton />}>
            <TrashContent />
          </Suspense>
        </div>
      </main>
    </>
  );
}
