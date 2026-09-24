import {
  and,
  type drizzle,
  eq,
  isNull,
  ne,
  or,
  schema,
  type SQL,
} from "@packages/drizzle";
import { AccessLevel, PublicAccess } from "@packages/types";
import { TRPCError } from "@trpc/server";

type Db = typeof drizzle;

const entityColumns = {
  id: schema.entities.id,
  title: schema.entities.title,
  appState: schema.entities.appState,
  elements: schema.entities.elements,
  entityType: schema.entities.entityType,
  publicAccess: schema.entities.publicAccess,
  parentId: schema.entities.parentId,
  createdAt: schema.entities.createdAt,
  updatedAt: schema.entities.updatedAt,
  sharedWithId: schema.sharedEntities.userId,
  sharedAccessLevel: schema.sharedEntities.accessLevel,
  ownerId: schema.users.id,
};

export type ReachableEntity = Awaited<ReturnType<typeof findEntity>>;

/**
 * The share row joined in, narrowed to `userId` first, so `sharedAccessLevel`
 * describes this caller's share and nobody else's.
 */
function callersShare(userId: string): SQL | undefined {
  return and(
    eq(schema.sharedEntities.entityId, schema.entities.id),
    eq(schema.sharedEntities.userId, userId),
  );
}

function live(id: string, reach: SQL | undefined): SQL | undefined {
  return and(
    eq(schema.entities.id, id),
    isNull(schema.entities.deletedAt),
    reach,
  );
}

/** The live entity with `id` when `reach` admits `userId`, otherwise null. */
async function findEntity(
  db: Db,
  id: string,
  userId: string,
  reach: SQL | undefined,
) {
  const rows = await db
    .select(entityColumns)
    .from(schema.entities)
    .where(live(id, reach))
    .leftJoin(schema.sharedEntities, callersShare(userId))
    .leftJoin(schema.users, eq(schema.users.id, schema.entities.userId))
    .execute();
  return rows[0] ?? null;
}

/** Who may read an entity: its owner, a share, or anyone when it is not private. */
function readableBy(userId: string): SQL | undefined {
  return or(
    eq(schema.entities.userId, userId),
    eq(schema.sharedEntities.userId, userId),
    ne(schema.entities.publicAccess, PublicAccess.PRIVATE),
  );
}

/**
 * The entity when `userId` may read it: they own it, it is shared with them,
 * or it is not private. `userId` is "" for anonymous callers.
 */
export async function findReadableEntity(db: Db, id: string, userId: string) {
  return findEntity(db, id, userId, readableBy(userId));
}

/**
 * The readable entity's `updatedAt` alone, under the same rule, for a caller
 * that asks often and only needs to know whether the entity moved.
 */
export async function findReadableRevision(db: Db, id: string, userId: string) {
  const rows = await db
    .select({ updatedAt: schema.entities.updatedAt })
    .from(schema.entities)
    .where(live(id, readableBy(userId)))
    .leftJoin(schema.sharedEntities, callersShare(userId))
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
  return findEntity(
    db,
    id,
    userId,
    or(
      eq(schema.entities.userId, userId),
      eq(schema.sharedEntities.accessLevel, AccessLevel.EDIT),
      eq(schema.entities.publicAccess, PublicAccess.EDIT),
    ),
  );
}

/**
 * The directory a new entity goes in, checked before the insert: the foreign
 * key would otherwise fail with the statement in its message, and a parent the
 * caller cannot write to is not theirs to file things under. A parent they
 * cannot reach reads as missing, the way an unreachable entity does. `what`
 * names the thing being created, so the message says what did not happen.
 */
export async function resolveParentDirectory(
  db: Db,
  parentId: string | null | undefined,
  userId: string,
  what: string,
): Promise<string | null> {
  if (parentId === null || parentId === undefined) return null;
  const parent = await findWritableEntity(db, parentId, userId);
  if (parent?.entityType !== "directory") {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No directory "${parentId}" to create the ${what} in`,
    });
  }
  return parent.id;
}

/**
 * The entity when `userId` owns it. Sharing and deleting are the owner's to
 * decide, so an editor gets the same answer as a stranger.
 */
export async function findOwnedEntity(db: Db, id: string, userId: string) {
  return findEntity(db, id, userId, eq(schema.entities.userId, userId));
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
