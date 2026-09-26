"use server";

import { redirect } from "next/navigation";
import { entityHref } from "~/lib/entity-types";
import { api } from "~/trpc/server";

export type CreatableType = "document" | "drawing" | "directory";

/** Creates an empty file or folder in `parentId`, then opens it. */
export async function createEntity(
  entityType: CreatableType,
  parentId: string | null,
) {
  const created = await api.entities.create.mutate({
    id: crypto.randomUUID(),
    entityType,
    parentId,
  });
  redirect(entityHref(created.entityType, created.id));
}
