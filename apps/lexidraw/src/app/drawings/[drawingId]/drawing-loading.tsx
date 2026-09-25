import { AppBar, Crumb } from "~/components/app-bar/app-bar";
import { Skeleton } from "~/components/ui/skeleton";

/** Where a drawing's canvas will be, in the colour it opens in. */
export function Canvas() {
  return <div data-canvas className="absolute inset-0 bg-drawing-canvas" />;
}

/** A drawing while it opens: its app bar over the canvas it will fill. */
export function DrawingLoading() {
  return (
    <main
      data-loading="drawing"
      aria-busy="true"
      className="flex min-h-0 w-full flex-1 flex-col"
    >
      <AppBar
        account={undefined}
        crumbs={
          <Crumb current>
            <Skeleton className="mx-1.5 h-4 w-32" />
          </Crumb>
        }
      />
      <div className="relative min-h-0 flex-1">
        <Canvas />
      </div>
    </main>
  );
}
