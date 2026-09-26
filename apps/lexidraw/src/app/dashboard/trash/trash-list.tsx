import { Trash2Icon } from "lucide-react";
import { LocalTime } from "~/components/ui/local-time";
import { EntityTypeIcon, entityTypeLabel } from "~/lib/entity-types";
import type { RouterOutputs } from "~/trpc/shared";
import { EmptyMessage } from "../empty-state";
import { ThemedThumbnail } from "../themed-thumbnail";
import { RestoreButton } from "./restore-button";

type Props = { items: RouterOutputs["entities"]["trash"] };

/** The caller's deleted files, last deleted first, each with a way back. */
export function TrashList({ items }: Props) {
  if (items.length === 0)
    return (
      <EmptyMessage
        icon={<Trash2Icon />}
        title="The Trash is empty"
        body="Files you delete wait here until you restore them."
      />
    );
  return (
    <ul className="grid grid-cols-1 divide-y divide-border rounded-lg border border-border bg-card">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex h-14 items-center gap-3 pr-2 pl-2 sm:pl-3"
        >
          <div className="relative size-10 shrink-0 overflow-hidden rounded-md border border-border bg-card">
            <ThemedThumbnail
              light={item.screenShotLight}
              dark={item.screenShotDark}
              alt=""
              sizes="40px"
              fallback={
                <span className="grid size-full place-items-center text-muted-foreground">
                  <EntityTypeIcon type={item.entityType} className="size-4" />
                </span>
              }
            />
          </div>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-row font-medium">{item.title}</span>
            <span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-caption text-muted-foreground">
              <span>{entityTypeLabel(item.entityType)}</span>
              <span aria-hidden="true">·</span>
              <span className="truncate">
                Deleted <LocalTime value={item.deletedAt} format="ago" />
              </span>
            </span>
          </span>
          <RestoreButton file={item} />
        </li>
      ))}
    </ul>
  );
}
