"use server";

import { EMPTY_CONTENT } from "@packages/lexical-nodes";
import { redirect } from "next/navigation";
import { entityHref } from "~/lib/entity-types";
import { api } from "~/trpc/server";

export type CreatableType = "document" | "drawing" | "directory";

const BLANK: Record<CreatableType, { title: string; elements: string }> = {
  document: { title: "New document", elements: JSON.stringify(EMPTY_CONTENT) },
  drawing: { title: "New drawing", elements: "[]" },
  directory: { title: "New folder", elements: "{}" },
};

/** Creates an empty file or folder in `parentId`, then opens it. */
export async function createEntity(
  entityType: CreatableType,
  parentId: string | null,
) {
  const { title, elements } = BLANK[entityType];
  const created = await api.entities.create.mutate({
    id: crypto.randomUUID(),
    title,
    elements,
    entityType,
    parentId,
  });
  redirect(entityHref(created.entityType, created.id));
}
