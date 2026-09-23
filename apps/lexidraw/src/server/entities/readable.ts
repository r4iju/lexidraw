import {
  and,
  type drizzle,
  eq,
  isNull,
  ne,
  or,
  schema,
} from "@packages/drizzle";
import { AccessLevel, PublicAccess } from "@packages/types";

type Db = typeof drizzle;

/**
 * The entity when `userId` may read it: they own it, it is shared with them,
 * or it is not private. `userId` is "" for anonymous callers.
 */
export async function findReadableEntity(db: Db, id: string, userId: string) {
  const rows = await db
    .select({
      id: schema.entities.id,
      title: schema.entities.title,
      appState: schema.entities.appState,
      elements: schema.entities.elements,
      entityType: schema.entities.entityType,
      publicAccess: schema.entities.publicAccess,
      parentId: schema.entities.parentId,
      updatedAt: schema.entities.updatedAt,
      sharedWithId: schema.sharedEntities.userId,
      sharedAccessLevel: schema.sharedEntities.accessLevel,
      ownerId: schema.users.id,
    })
    .from(schema.entities)
    .where(
      and(
        eq(schema.entities.id, id),
        isNull(schema.entities.deletedAt),
        or(
          eq(schema.entities.userId, userId),
          eq(schema.sharedEntities.userId, userId),
          ne(schema.entities.publicAccess, PublicAccess.PRIVATE),
        ),
      ),
    )
    .leftJoin(
      schema.sharedEntities,
      and(
        eq(schema.sharedEntities.entityId, schema.entities.id),
        eq(schema.sharedEntities.userId, userId),
      ),
    )
    .leftJoin(schema.users, eq(schema.users.id, schema.entities.userId))
    .execute();
  return rows[0] ?? null;
}

/**
 * The entity when `userId` may write it: they own it, it is shared with them
 * for editing, or anyone may edit it. Read-only shares and `READ` public
 * access do not qualify, so a reader is told the entity does not exist rather
 * than that it exists and is out of reach.
 */
export async function findWritableEntity(db: Db, id: string, userId: string) {
  const rows = await db
    .select({
      id: schema.entities.id,
      title: schema.entities.title,
      appState: schema.entities.appState,
      elements: schema.entities.elements,
      entityType: schema.entities.entityType,
      publicAccess: schema.entities.publicAccess,
      parentId: schema.entities.parentId,
      updatedAt: schema.entities.updatedAt,
      sharedWithId: schema.sharedEntities.userId,
      sharedAccessLevel: schema.sharedEntities.accessLevel,
      ownerId: schema.users.id,
    })
    .from(schema.entities)
    .where(
      and(
        eq(schema.entities.id, id),
        isNull(schema.entities.deletedAt),
        or(
          eq(schema.entities.userId, userId),
          eq(schema.sharedEntities.accessLevel, AccessLevel.EDIT),
          eq(schema.entities.publicAccess, PublicAccess.EDIT),
        ),
      ),
    )
    .leftJoin(
      schema.sharedEntities,
      and(
        eq(schema.sharedEntities.entityId, schema.entities.id),
        eq(schema.sharedEntities.userId, userId),
      ),
    )
    .leftJoin(schema.users, eq(schema.users.id, schema.entities.userId))
    .execute();
  return rows[0] ?? null;
}

// Directory nesting is user-made, so the walk is bounded rather than trusted.
const MAX_PATH_DEPTH = 64;

export type EntityAncestor = {
  id: string;
  title: string;
  parentId: string | null;
};

/** Ancestors of the entity whose parent is `parentId`, nearest first. */
export async function entityAncestors(
  db: Db,
  parentId: string | null,
): Promise<EntityAncestor[]> {
  const ancestors: EntityAncestor[] = [];
  let currentId = parentId;
  for (let depth = 0; currentId && depth < MAX_PATH_DEPTH; depth++) {
    const parent = await db
      .select({
        id: schema.entities.id,
        title: schema.entities.title,
        parentId: schema.entities.parentId,
      })
      .from(schema.entities)
      .where(eq(schema.entities.id, currentId))
      .get();
    if (!parent) break;
    ancestors.push(parent);
    currentId = parent.parentId;
  }
  return ancestors;
}

/** Ancestor directory titles and the entity's own title, joined with "/". */
export async function entityPath(
  db: Db,
  entity: { title: string; parentId: string | null },
): Promise<string> {
  const ancestors = await entityAncestors(db, entity.parentId);
  return [...ancestors.reverse().map((a) => a.title), entity.title].join("/");
}

export async function entityTagNames(db: Db, id: string): Promise<string[]> {
  const rows = await db
    .select({ name: schema.tags.name })
    .from(schema.entityTags)
    .innerJoin(schema.tags, eq(schema.entityTags.tagId, schema.tags.id))
    .where(eq(schema.entityTags.entityId, id))
    .orderBy(schema.tags.name)
    .execute();
  return rows.map((row) => row.name);
}
