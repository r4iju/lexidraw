import {
  and,
  type drizzle,
  eq,
  inArray,
  isNull,
  ne,
  or,
  schema,
  type SQL,
} from "@packages/drizzle";
import { AccessLevel, PublicAccess } from "@packages/types";
import { TRPCError } from "@trpc/server";

type Db = typeof drizzle;

/** An entity as the access rules see it, without its content. */
const entityFacts = {
  id: schema.entities.id,
  title: schema.entities.title,
  entityType: schema.entities.entityType,
  publicAccess: schema.entities.publicAccess,
  parentId: schema.entities.parentId,
  createdAt: schema.entities.createdAt,
  updatedAt: schema.entities.updatedAt,
  sharedWithId: schema.sharedEntities.userId,
  sharedAccessLevel: schema.sharedEntities.accessLevel,
  ownerId: schema.users.id,
};

const entityColumns = {
  ...entityFacts,
  appState: schema.entities.appState,
  elements: schema.entities.elements,
};

type CallersAccess = {
  ownerId: string | null;
  sharedAccessLevel: string | null;
};

/**
 * Whether `userId` may hand out access to an entity they reached, and so see
 * who else has it: its owner, or someone it was shared with for editing. An
 * entity anyone may edit is not enough; that is a link, not an invitation.
 */
export const canShare = (entity: CallersAccess, userId: string) =>
  entity.ownerId === userId || entity.sharedAccessLevel === AccessLevel.EDIT;

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
 * {@link findReadableEntity} without the content, for a caller that only
 * needs to know what the entity is and where.
 */
export async function findReadableFacts(db: Db, id: string, userId: string) {
  const rows = await db
    .select(entityFacts)
    .from(schema.entities)
    .where(live(id, readableBy(userId)))
    .leftJoin(schema.sharedEntities, callersShare(userId))
    .leftJoin(schema.users, eq(schema.users.id, schema.entities.userId))
    .execute();
  return rows[0] ?? null;
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

/** The directory `id` when `userId` may write into it, otherwise null. */
async function findWritableDirectory(db: Db, id: string, userId: string) {
  const found = await findWritableEntity(db, id, userId);
  return found?.entityType === "directory" ? found : null;
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
  const parent = await findWritableDirectory(db, parentId, userId);
  if (!parent) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No directory "${parentId}" to create the ${what} in`,
    });
  }
  return parent.id;
}

/**
 * The directory `entity` moves to for `userId`, checked before the update:
 * the top of Home, or a directory the caller may write into, under the same
 * rule a create follows. Someone moving a file they do not own also needs its
 * owner to be able to write there, so an editor cannot file someone's work
 * where its owner would lose it. A directory never goes inside itself or one
 * below it, which would take the whole branch out of every listing.
 */
export async function resolveMoveDestination(
  db: Db,
  entity: { id: string; entityType: string; ownerId: string | null },
  parentId: string | null,
  userId: string,
): Promise<string | null> {
  if (parentId === null) return null;
  const parent = await findWritableDirectory(db, parentId, userId);
  const ownerCanWrite =
    entity.ownerId === userId ||
    (await findWritableDirectory(db, parentId, entity.ownerId ?? "")) !== null;
  if (!parent || !ownerCanWrite) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `No directory "${parentId}" to move the ${entity.entityType} into`,
    });
  }
  const above = await parentChain(db, parent.id);
  if (above.some((link) => link.id === entity.id)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "A directory cannot move into itself or a directory inside it",
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

export type EntityAncestor = { id: string; title: string };

/** `id` and the entities above it, nearest first, whoever may read them. */
async function parentChain(
  db: Db,
  id: string | null,
): Promise<{ id: string; parentId: string | null }[]> {
  const chain: { id: string; parentId: string | null }[] = [];
  let currentId = id;
  for (let depth = 0; currentId && depth < MAX_PATH_DEPTH; depth++) {
    const parent = await db
      .select({ id: schema.entities.id, parentId: schema.entities.parentId })
      .from(schema.entities)
      .where(eq(schema.entities.id, currentId))
      .get();
    if (!parent) break;
    chain.push(parent);
    currentId = parent.parentId;
  }
  return chain;
}

/**
 * The title of each of `ids` that `userId` may read, by id. The rest are left
 * out: a folder someone else keeps above a file they shared is theirs, and so
 * is its name.
 */
export async function readableTitles(
  db: Db,
  ids: Iterable<string | null>,
  userId: string,
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids)].filter((id): id is string => !!id);
  if (wanted.length === 0) return new Map();
  const rows = await db
    .selectDistinct({ id: schema.entities.id, title: schema.entities.title })
    .from(schema.entities)
    .where(
      and(
        inArray(schema.entities.id, wanted),
        isNull(schema.entities.deletedAt),
        readableBy(userId),
      ),
    )
    .leftJoin(schema.sharedEntities, callersShare(userId))
    .execute();
  return new Map(rows.map((row) => [row.id, row.title]));
}

/**
 * `rows` as `userId` may see where they are: a `parentId` they may read stays,
 * with its title as `folderTitle`, and one they may not reads as the top of
 * Home. That folder, its id included, is its owner's to keep.
 */
export async function inReadableFolders<
  Row extends { parentId: string | null },
>(
  db: Db,
  rows: Row[],
  userId: string,
): Promise<(Row & { folderTitle: string | null })[]> {
  const titles = await readableTitles(
    db,
    rows.map((row) => row.parentId),
    userId,
  );
  return rows.map((row) => {
    const folderTitle = row.parentId
      ? (titles.get(row.parentId) ?? null)
      : null;
    return {
      ...row,
      parentId: folderTitle === null ? null : row.parentId,
      folderTitle,
    };
  });
}

/**
 * The folders above the entity whose parent is `parentId` that `userId` may
 * read, nearest first. The walk goes through the ones they may not, so a
 * readable folder higher up still shows.
 */
export async function entityAncestors(
  db: Db,
  parentId: string | null,
  userId: string,
): Promise<EntityAncestor[]> {
  const chain = await parentChain(db, parentId);
  const titles = await readableTitles(
    db,
    chain.map((link) => link.id),
    userId,
  );
  return chain.flatMap((link) => {
    const title = titles.get(link.id);
    return title === undefined ? [] : [{ id: link.id, title }];
  });
}

/**
 * The titles of the folders above the entity that `userId` may read, and the
 * entity's own title, joined with "/".
 */
export async function entityPath(
  db: Db,
  entity: { title: string; parentId: string | null },
  userId: string,
): Promise<string> {
  const ancestors = await entityAncestors(db, entity.parentId, userId);
  return [...ancestors.reverse().map((a) => a.title), entity.title].join("/");
}
