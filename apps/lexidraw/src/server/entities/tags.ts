import * as schema from "@packages/drizzle/drizzle-schema";
import { and, eq, inArray } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { v4 as uuidV4 } from "uuid";

// The schema module rather than the @packages/drizzle barrel, so the document
// store can use this without building the Turso client on import.
type Db = LibSQLDatabase<typeof schema>;

/**
 * Makes `names` the tags `userId` has on `entityId`. Tags are per user:
 * another user's associations with the entity are neither read nor touched.
 */
export async function replaceOwnTags(
  db: Db,
  entityId: string,
  userId: string,
  names: string[],
): Promise<void> {
  const tagNames = [...new Set(names)];
  const ownAssociations = and(
    eq(schema.entityTags.entityId, entityId),
    eq(schema.entityTags.userId, userId),
  );

  if (tagNames.length === 0) {
    await db.delete(schema.entityTags).where(ownAssociations).execute();
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .insert(schema.tags)
      .values(tagNames.map((name) => ({ id: uuidV4(), name })))
      .onConflictDoNothing()
      .execute();

    const allTags = await tx
      .select({ id: schema.tags.id, name: schema.tags.name })
      .from(schema.tags)
      .where(inArray(schema.tags.name, tagNames))
      .execute();
    const tagNameToId = new Map(allTags.map((tag) => [tag.name, tag.id]));
    const newTagIds = tagNames.map((name) => {
      const tagId = tagNameToId.get(name);
      if (!tagId)
        throw new Error(`Failed to find tag ID for tag name: ${name}`);
      return tagId;
    });

    const currentAssociations = await tx
      .select({ tagId: schema.entityTags.tagId })
      .from(schema.entityTags)
      .where(ownAssociations)
      .execute();
    const currentTagIds = new Set(
      currentAssociations.map((association) => association.tagId),
    );

    const tagsToAdd = newTagIds.filter((tagId) => !currentTagIds.has(tagId));
    const tagsToRemove = [...currentTagIds].filter(
      (tagId) => !newTagIds.includes(tagId),
    );

    if (tagsToRemove.length > 0) {
      await tx
        .delete(schema.entityTags)
        .where(
          and(ownAssociations, inArray(schema.entityTags.tagId, tagsToRemove)),
        )
        .execute();
    }
    if (tagsToAdd.length > 0) {
      await tx
        .insert(schema.entityTags)
        .values(tagsToAdd.map((tagId) => ({ entityId, tagId, userId })))
        .execute();
    }
  });
}
