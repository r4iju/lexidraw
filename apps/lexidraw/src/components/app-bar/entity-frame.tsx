"use client";

import type { ReactNode } from "react";
import type { AppBarAccount } from "./account-menu";
import { AppBar, Crumb, CrumbLink } from "./app-bar";
import { EditableTitle } from "./editable-title";
import { SaveStatus } from "./save-status";

/** What the app bar over an open entity needs from the server. */
export type EntityFrame = {
  account: AppBarAccount | null;
  isOwner: boolean;
  parentId: string | null;
  /** The folders it sits in, from the top down, without Home. */
  ancestors: { id: string; title: string }[];
};

/** The app bar over an open document or drawing. */
export function EntityAppBar({
  frame,
  entity,
  canRename,
  actions,
  className,
}: {
  frame: EntityFrame;
  entity: { id: string; title: string };
  canRename: boolean;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <AppBar
      account={frame.account}
      className={className}
      crumbs={
        <>
          {frame.ancestors.map((ancestor) => (
            <Crumb key={ancestor.id}>
              <CrumbLink href={`/dashboard/${ancestor.id}`}>
                {ancestor.title || "Untitled"}
              </CrumbLink>
            </Crumb>
          ))}
          <Crumb current>
            <EditableTitle
              id={entity.id}
              title={entity.title}
              canRename={canRename}
            />
          </Crumb>
        </>
      }
      status={<SaveStatus />}
      actions={actions}
    />
  );
}
