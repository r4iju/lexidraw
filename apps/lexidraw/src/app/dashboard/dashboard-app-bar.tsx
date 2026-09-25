"use client";

import { EditableTitle } from "~/components/app-bar/editable-title";
import { AppBar, Crumb, CrumbLink } from "~/components/app-bar/app-bar";
import type { AppBarAccount } from "~/components/app-bar/account-menu";
import type { EntityAccess } from "~/lib/entity-access";
import { Drop } from "./drop";

type Folder = {
  id: string;
  title: string;
  /** The ones above it the viewer can open, from the top down, without Home. */
  ancestors: { id: string; title: string; access: EntityAccess }[];
  canRename: boolean;
};

/**
 * The app bar over Home and a folder. Home and every folder in the
 * breadcrumb take what is dropped on them, as the listing's folders do.
 */
export function DashboardAppBar({
  account,
  folder,
  query,
}: {
  account: AppBarAccount | null;
  folder?: Folder;
  /** The listing's view, kept when going up a level. */
  query: string;
}) {
  const suffix = query ? `?${query}` : "";
  return (
    <AppBar
      account={account}
      wrapHome={
        folder ? (home) => <Drop folder={null}>{home}</Drop> : undefined
      }
      crumbs={
        folder && (
          <>
            {folder.ancestors.map((ancestor) => (
              <Crumb key={ancestor.id}>
                <Drop folder={ancestor}>
                  <CrumbLink href={`/dashboard/${ancestor.id}${suffix}`}>
                    {ancestor.title || "Untitled"}
                  </CrumbLink>
                </Drop>
              </Crumb>
            ))}
            <Crumb current>
              <EditableTitle
                id={folder.id}
                title={folder.title}
                canRename={folder.canRename}
              />
            </Crumb>
          </>
        )
      }
    />
  );
}
