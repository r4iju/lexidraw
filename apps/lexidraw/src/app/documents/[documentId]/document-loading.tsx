import { AppBar, Crumb } from "~/components/app-bar/app-bar";
import {
  EntityAppBar,
  type EntityFrame,
} from "~/components/app-bar/entity-frame";
import { Skeleton } from "~/components/ui/skeleton";
import { cn } from "~/lib/utils";

const GUTTER = cn(
  "pl-[max(--spacing(4),env(safe-area-inset-left))] pr-[max(--spacing(4),env(safe-area-inset-right))]",
  "sm:pl-[max(--spacing(6),env(safe-area-inset-left))] sm:pr-[max(--spacing(6),env(safe-area-inset-right))]",
  "lg:pl-[max(--spacing(8),env(safe-area-inset-left))] lg:pr-[max(--spacing(8),env(safe-area-inset-right))]",
);

/** The width of each placeholder line, so the page reads as paragraphs. */
const LINES = ["92%", "100%", "96%", "64%", "", "100%", "88%", "94%", "40%"];

/**
 * A document while it opens: the page's frame and column, laid out as the
 * editor lays them out, so nothing moves when the text arrives. What is known
 * already (the app bar, the title) is shown; the rest is placeholders.
 */
export function DocumentLoading({
  entity,
  frame,
}: {
  entity?: { id: string; title: string };
  frame?: EntityFrame;
}) {
  return (
    <div
      data-loading="document"
      data-scroll-root="page"
      aria-busy="true"
      className="page-frame flex min-h-dvh flex-col"
    >
      <div className="sticky top-0 z-10 w-full shrink-0 bg-card pt-[env(safe-area-inset-top)] print:hidden">
        {frame && entity ? (
          <EntityAppBar
            frame={frame}
            entity={entity}
            canRename={false}
            compactOnPhone
          />
        ) : (
          <AppBar
            account={undefined}
            crumbs={
              <Crumb current>
                <Skeleton className="mx-1.5 h-4 w-32" />
              </Crumb>
            }
          />
        )}
        {/* The formatting strip, which a signed-out reader goes without. */}
        <div
          className={cn(
            "flex items-center border-b border-border py-1 max-sm:hidden",
            GUTTER,
            frame && !frame.account && "hidden",
          )}
        >
          <div className="h-10 pointer-coarse:h-12" />
        </div>
      </div>
      <div className="flex flex-1 items-start bg-background">
        <div className="flex min-w-0 flex-1 flex-col self-stretch">
          <main id="main-content" className="document-viewport relative">
            <header className="document-header">
              <h1 className="document-title">
                {entity ? entity.title : <Skeleton className="h-[1lh] w-3/5" />}
              </h1>
            </header>
            <div className="relative">
              <div className="document-content">
                <div className="flex flex-col">
                  {LINES.map((width, index) => (
                    <Skeleton
                      // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list
                      key={index}
                      className={cn(
                        "my-[0.2lh] h-[0.6lh] rounded-sm",
                        !width && "invisible",
                      )}
                      style={{ width }}
                    />
                  ))}
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
