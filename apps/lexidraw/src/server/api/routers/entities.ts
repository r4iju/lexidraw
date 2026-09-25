import { queueThumbnail } from "~/server/entities/queue-thumbnail";
import { issueRoomToken } from "~/server/auth/room-token";
import { z } from "zod";
import {
  revalidateEntities,
  revalidateEntitiesAndParents,
} from "../entity-cache";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { CreateEntity, SaveEntity } from "./entities-schema";
import { PublicAccess, AccessLevel } from "@packages/types";
import { TRPCError } from "@trpc/server";
import {
  and,
  desc,
  eq,
  exists,
  isNull,
  or,
  schema,
  sql,
  inArray,
  type drizzle,
} from "@packages/drizzle";
import type { AppState } from "@excalidraw/excalidraw/types";
import { v4 as uuidV4 } from "uuid";
import { ownTagNames, replaceOwnTags } from "~/server/entities/tags";
import { extractAndSanitizeArticle } from "~/server/extractors/article";
import { entityText, snippetAround } from "~/lib/entity-text";
import env from "@packages/env";
import { put } from "@vercel/blob";
import {
  generateClientTokenFromReadWriteToken,
  type GenerateClientTokenOptions,
} from "@vercel/blob/client";
import { headers } from "next/headers";
import {
  drizzleDocumentStore,
  nextUpdatedAt,
} from "~/server/documents/document-store";
import { StaleDocumentError } from "~/server/documents/conflict";
import {
  canEdit,
  entityAncestors,
  findOwnedEntity,
  findReadableEntity,
  findReadableFacts,
  inReadableFolders,
  findReadableRevision,
  findWritableEntity,
  resolveMoveDestination,
  resolveParentDirectory,
} from "~/server/entities/readable";
import { storeThumbnail, thumbnailPathname } from "~/server/entities/thumbnail";
import {
  accessLevelOut,
  entityTypeOut,
  isoDate,
  queryBoolean,
  stringList,
} from "../rest-schemas";

/**
 * What `load` returns, declared so the REST transport can describe it.
 * `appState` and `elements` are the stored JSON blobs, kept as the opaque
 * strings they are on the wire. `entityType` is here because a caller holding
 * only an id — the CLI before a delete, say — has no other way to learn what
 * the id names before acting on it.
 */
const loadOutput = z.object({
  id: z.string(),
  title: z.string(),
  entityType: entityTypeOut,
  appState: z.string().nullable(),
  elements: z.string(),
  publicAccess: z.enum(PublicAccess),
  // Whether it is shared with anyone.
  shared: z.boolean(),
  accessLevel: z.enum(AccessLevel),
  // The revision the content is, so an open editor can tell when it moved.
  updatedAt: isoDate,
});

/** What `list` returns: one row per entity the dashboard draws. */
const entityListItem = z.object({
  id: z.string(),
  title: z.string(),
  entityType: entityTypeOut,
  createdAt: isoDate,
  updatedAt: isoDate,
  screenShotLight: z.string(),
  screenShotDark: z.string(),
  thumbnailStatus: z.enum(["pending", "ready", "error"]).nullable(),
  thumbnailVersion: z.string().nullable(),
  thumbnailUpdatedAt: isoDate.nullable(),
  // Whether it is the caller's, rather than whose it is: someone it was
  // shared with has no use for the owner's id.
  isOwner: z.boolean(),
  publicAccess: z.enum(PublicAccess),
  parentId: z.string().nullable(),
  favoritedAt: isoDate.nullable(),
  archivedAt: isoDate.nullable(),
  sharedWithCount: z.number(),
  tags: z.array(z.string()),
  childCount: z.number(),
});

/**
 * What `search` returns: enough to render a hit, say where it is and why it
 * matched, and navigate to it.
 */
const entitySearchResult = z.object({
  id: z.string(),
  title: z.string(),
  entityType: entityTypeOut,
  screenShotLight: z.string(),
  screenShotDark: z.string(),
  updatedAt: isoDate,
  parentId: z.string().nullable(),
  /**
   * The folder the entity is in; null at the top of Home, or when the caller
   * cannot open that folder.
   */
  folderTitle: z.string().nullable(),
  /** The text around a match in the content; null for a title or tag hit. */
  snippet: z.string().nullable(),
});

/** The identity of an entity, as the write paths report it back. */
const entitySummary = z.object({
  id: z.string(),
  title: z.string(),
  entityType: entityTypeOut,
  parentId: z.string().nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

const notFound = () =>
  new TRPCError({ code: "NOT_FOUND", message: "Entity not found" });

/** The entity `userId` may write, or not found when there is none. */
async function writableOrNotFound(
  db: typeof drizzle,
  id: string,
  userId: string,
) {
  const entity = await findWritableEntity(db, id, userId);
  if (!entity) throw notFound();
  return entity;
}

/**
 * The cookie `userId` keeps for the site `url` is on, which a fetch made on
 * their behalf carries. The caller's own, never the entity owner's: an editor
 * fetching into someone's document signs in as themselves.
 */
async function cookieFor(db: typeof drizzle, userId: string, url: string) {
  const [user] = await db
    .select({ config: schema.users.config })
    .from(schema.users)
    .where(eq(schema.users.id, userId));
  const host = new URL(url).host.replace("www.", "");
  return user?.config?.cookies?.find((cookie) => cookie.name === host);
}

const shareNotFound = () =>
  new TRPCError({ code: "NOT_FOUND", message: "Share not found" });

const sortByString = (sortOrder: "asc" | "desc", a: string, b: string) =>
  sortOrder === "asc" ? a.localeCompare(b) : b.localeCompare(a);

const sortByNumber = (sortOrder: "asc" | "desc", a: number, b: number) =>
  sortOrder === "asc" ? a - b : b - a;

const sortByDate = (sortOrder: "asc" | "desc", a: Date, b: Date) =>
  sortOrder === "asc" ? a.getTime() - b.getTime() : b.getTime() - a.getTime();

const isString = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number";
const isDate = (value: unknown): value is Date => value instanceof Date;

const sortArrOfObjects = <T extends Record<string, unknown>, K extends keyof T>(
  arr: T[],
  sortOrder: "asc" | "desc",
  sortBy: K,
): T[] => {
  return arr.toSorted((a, b) => {
    const valueA = a[sortBy];
    const valueB = b[sortBy];

    if (isString(valueA) && isString(valueB)) {
      return sortByString(sortOrder, valueA, valueB);
    }

    if (isNumber(valueA) && isNumber(valueB)) {
      return sortByNumber(sortOrder, valueA, valueB);
    }

    if (isDate(valueA) && isDate(valueB)) {
      return sortByDate(sortOrder, valueA, valueB);
    }

    return 0;
  });
};

export const entityRouter = createTRPCRouter({
  create: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/entities",
        tags: ["entities"],
        summary: "Create an entity; returns the existing one on a repeat",
        protect: true,
        // A POST has no 404 by default, and both the 404 a missing parent
        // directory earns and the 409 on a taken id are this path's own.
        errorResponses: [400, 401, 403, 404, 409, 500],
      },
    })
    .input(CreateEntity)
    .output(entitySummary)
    .mutation(async ({ input, ctx }) => {
      const parentId = await resolveParentDirectory(
        ctx.drizzle,
        input.parentId,
        ctx.session.user.id,
        input.entityType,
      );
      const [created] = await ctx.drizzle
        .insert(schema.entities)
        .values({
          id: input.id,
          createdAt: new Date(),
          updatedAt: new Date(),
          deletedAt: undefined,
          title: input.title,
          userId: ctx.session?.user.id,
          entityType: input.entityType,
          publicAccess: PublicAccess.PRIVATE,
          elements: input.elements,
          parentId,
          appState: JSON.stringify({}),
        })
        .onConflictDoNothing()
        .returning({
          id: schema.entities.id,
          title: schema.entities.title,
          entityType: schema.entities.entityType,
          parentId: schema.entities.parentId,
          createdAt: schema.entities.createdAt,
          updatedAt: schema.entities.updatedAt,
        });
      if (created) {
        await queueThumbnail(ctx.drizzle, {
          ...created,
          elements: input.elements,
          appState: "{}",
        });
        await revalidateEntitiesAndParents(
          ctx.drizzle,
          created.id,
          created.parentId,
        );
        return created;
      }

      // The id is taken. A retried create gets the owner their own entity
      // back; anyone else learns only that the id is gone, never whose it is.
      const existing = await findOwnedEntity(
        ctx.drizzle,
        input.id,
        ctx.session.user.id,
      );
      if (!existing) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An entity with this id already exists",
        });
      }
      return {
        id: existing.id,
        title: existing.title,
        entityType: existing.entityType,
        parentId: existing.parentId,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      };
    }),
  save: publicProcedure
    .meta({
      openapi: {
        method: "PUT",
        path: "/entities/{id}",
        tags: ["entities"],
        summary: "Replace the stored content of an entity",
        protect: true,
        // The 409 is the precondition's.
        errorResponses: [400, 401, 403, 404, 409, 500],
      },
    })
    .input(SaveEntity)
    .output(z.object({ id: z.string(), updatedAt: isoDate }))
    .mutation(async ({ input, ctx }) => {
      const entity = await findWritableEntity(
        ctx.drizzle,
        input.id,
        ctx.session?.user.id ?? "",
      );
      if (!entity) throw notFound();
      const parentId =
        input.parentId === undefined || input.parentId === entity.parentId
          ? undefined
          : await resolveMoveDestination(
              ctx.drizzle,
              entity,
              input.parentId,
              ctx.session?.user.id ?? "",
            );

      // Omitting appState leaves the stored one alone; only an explicit null
      // clears it.
      let appState: string | null | undefined;
      if (input.appState === null) {
        appState = null;
      } else if (input.appState !== undefined) {
        const parsedAppState = JSON.parse(input.appState) as AppState;
        appState = JSON.stringify({
          ...parsedAppState,
          collaborators:
            parsedAppState.collaborators instanceof Map
              ? Object.fromEntries(parsedAppState.collaborators.entries())
              : undefined,
        });
      }

      const saved = await ctx.drizzle
        .update(schema.entities)
        .set({
          id: input.id,
          title: input.title,
          ...(appState !== undefined ? { appState } : {}),
          elements: input.elements,
          ...(parentId !== undefined ? { parentId } : {}),
          // Strictly increasing, so a compare-and-set caller can tell this save
          // apart from its own; see nextUpdatedAt.
          updatedAt: nextUpdatedAt(),
          // move thumbnail status bump here to avoid a second UPDATE
          // and ensure the UPDATE has at least one column always
          thumbnailStatus: "pending",
        })
        .where(
          and(
            eq(schema.entities.id, input.id),
            isNull(schema.entities.deletedAt),
            // The same compare-and-set as the document and drawing writes.
            input.ifUnmodifiedSince === undefined
              ? undefined
              : eq(
                  schema.entities.updatedAt,
                  new Date(input.ifUnmodifiedSince),
                ),
          ),
        )
        .returning();
      if (!saved[0]) {
        const current = await drizzleDocumentStore(
          ctx.drizzle,
          ctx.session?.user.id ?? "",
        ).read(input.id);
        if (!current) throw notFound();
        const stale = new StaleDocumentError(
          current.updatedAt,
          entity.entityType === "drawing" ? "Drawing" : "Document",
        );
        throw new TRPCError({
          code: "CONFLICT",
          message: stale.message,
          cause: stale,
        });
      }
      const entityUpdatedAt = saved[0].updatedAt;
      await queueThumbnail(ctx.drizzle, saved[0]);

      // Both directories, because `parentId` may have moved the entity out of
      // the one it was listed in, and the listings above them with it.
      await revalidateEntitiesAndParents(
        ctx.drizzle,
        input.id,
        entity.parentId,
        input.parentId,
      );
      // The new mark for a compare-and-set caller; see nextUpdatedAt.
      return { id: input.id, updatedAt: entityUpdatedAt };
    }),
  search: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        // Registered before /entities/{id} so the literal segment wins.
        path: "/entities/search",
        tags: ["entities"],
        summary: "Search entities by title",
        protect: true,
      },
    })
    .input(z.object({ query: z.string() }))
    .output(z.array(entitySearchResult))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (input.query.trim() === "") {
        return [];
      }
      const searchQuery = `%${input.query}%`;

      const results = await ctx.drizzle
        .selectDistinct({
          id: schema.entities.id,
          title: schema.entities.title,
          entityType: schema.entities.entityType,
          screenShotLight: schema.entities.screenShotLight,
          screenShotDark: schema.entities.screenShotDark,
          updatedAt: schema.entities.updatedAt,
          parentId: schema.entities.parentId,
        })
        .from(schema.entities)
        .leftJoin(
          schema.sharedEntities,
          eq(schema.entities.id, schema.sharedEntities.entityId),
        )
        .where(
          and(
            or(
              eq(schema.entities.userId, userId),
              eq(schema.sharedEntities.userId, userId),
            ),
            isNull(schema.entities.deletedAt),
            sql`lower(${schema.entities.title}) like ${searchQuery.toLowerCase()}`,
          ),
        )
        .orderBy(desc(schema.entities.updatedAt))
        .limit(20);

      return (await inReadableFolders(ctx.drizzle, results, userId)).map(
        (result) => ({ ...result, snippet: null }),
      );
    }),
  load: publicProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/entities/{id}",
        tags: ["entities"],
        summary: "Load one entity",
        protect: true,
      },
    })
    .input(z.object({ id: z.string() }))
    .output(loadOutput)
    .query(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id ?? "";

      const entity = await findReadableEntity(ctx.drizzle, input.id, userId);
      if (!entity) throw notFound();

      // Whether anyone else has it, so the editor knows to connect for
      // collaboration.
      const [anyShare] = await ctx.drizzle
        .select({ userId: schema.sharedEntities.userId })
        .from(schema.sharedEntities)
        .where(eq(schema.sharedEntities.entityId, input.id))
        .limit(1);

      const accessLevel = canEdit(entity, userId)
        ? AccessLevel.EDIT
        : AccessLevel.READ;

      return {
        id: entity.id,
        title: entity.title,
        entityType: entity.entityType,
        appState: entity.appState,
        elements: entity.elements,
        publicAccess: entity.publicAccess,
        shared: anyShare !== undefined,
        accessLevel,
        updatedAt: entity.updatedAt,
      };
    }),
  /**
   * The stored revision without its content: what an open editor polls to
   * learn that the entity moved under it (`lib/open-entity-sync.ts`). Not a
   * REST path; agents read `updatedAt` from the reads they already make.
   */
  revision: publicProcedure
    .input(z.object({ id: z.string() }))
    .output(z.object({ updatedAt: isoDate }))
    .query(async ({ input, ctx }) => {
      const revision = await findReadableRevision(
        ctx.drizzle,
        input.id,
        ctx.session?.user?.id ?? "",
      );
      if (!revision) throw notFound();
      return revision;
    }),
  /**
   * A token that lets the caller into the entity's room on the signaling
   * server, as `peer`, telling the room whether they may edit. Null while the
   * app has no `SIGNALING_SECRET`, and the client then connects without one.
   */
  roomToken: publicProcedure
    .input(z.object({ id: z.string(), peer: z.string().min(1).max(128) }))
    .output(z.object({ token: z.string().nullable() }))
    .query(({ input, ctx }) =>
      issueRoomToken(
        ctx.drizzle,
        {
          entityId: input.id,
          peer: input.peer,
          userId: ctx.session?.user?.id ?? "",
          mayWrite: ctx.auth?.kind !== "token" || ctx.auth.scope === "write",
        },
        env.SIGNALING_SECRET,
      ),
    ),
  /**
   * What the pages around an entity show of it: its title, where it is, and
   * whether the caller owns it. Whose it is otherwise, and who else has it,
   * stay with its owner and the share dialog.
   */
  getMetadata: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id ?? "";
      const entity = await findReadableFacts(ctx.drizzle, input.id, userId);
      if (!entity) throw notFound();

      const [[placed], ancestors] = await Promise.all([
        inReadableFolders(ctx.drizzle, [entity], userId),
        entityAncestors(ctx.drizzle, entity.parentId, userId),
      ]);
      return {
        id: entity.id,
        title: entity.title,
        entityType: entity.entityType,
        publicAccess: entity.publicAccess,
        parentId: placed?.parentId ?? null,
        isOwner: entity.ownerId === userId,
        ancestors: ancestors.reverse(),
      };
    }),
  list: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/entities",
        tags: ["entities"],
        summary: "List the entities in a directory; omit parentId for the root",
        protect: true,
      },
    })
    .input(
      z.object({
        // Omitted means the root; a directory id lists that directory.
        parentId: z.string().optional(),
        tagNames: stringList(z.string(), "Tag names").optional(),
        sortBy: z
          .enum(["updatedAt", "createdAt", "title"])
          .optional()
          .default("updatedAt"),
        sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
        includeArchived: queryBoolean.optional().default(false),
        onlyFavorites: queryBoolean.optional().default(false),
        onlyArchived: queryBoolean.optional().default(false),
        entityTypes: stringList(
          z.enum(["document", "drawing", "directory", "url"]),
          "Entity types to include",
        ).optional(),
      }),
    )
    .output(z.array(entityListItem))
    .query(async ({ ctx, input }) => {
      // A directory the caller cannot open, or one in the trash, is not
      // there to list, whatever in it was shared with them.
      if (input.parentId !== undefined) {
        const parent = await findReadableFacts(
          ctx.drizzle,
          input.parentId,
          ctx.session.user.id,
        );
        if (parent?.entityType !== "directory") throw notFound();
      }

      // Step 1: Get matching entity IDs if tag names are provided
      let tagFilteredEntityIds: string[] | undefined;

      if (input.tagNames?.length) {
        const matchingEntityTags = await ctx.drizzle
          .select({ entityId: schema.entityTags.entityId })
          .from(schema.entityTags)
          .leftJoin(schema.tags, eq(schema.entityTags.tagId, schema.tags.id))
          .where(
            and(
              inArray(schema.tags.name, input.tagNames),
              // A tag belongs to whoever put it there, so filtering by one
              // means filtering by the caller's own.
              eq(schema.entityTags.userId, ctx.session.user.id),
            ),
          )
          .execute();

        tagFilteredEntityIds = matchingEntityTags.map((row) => row.entityId);

        // If no entities match the given tag names, return an empty array immediately
        if (!tagFilteredEntityIds.length) {
          return [];
        }
      }

      // Step 2: Main query with tag filtering
      const entities = await ctx.drizzle
        .select({
          id: schema.entities.id,
          title: schema.entities.title,
          entityType: schema.entities.entityType,
          createdAt: schema.entities.createdAt,
          updatedAt: schema.entities.updatedAt,
          screenShotLight: schema.entities.screenShotLight,
          screenShotDark: schema.entities.screenShotDark,
          thumbnailStatus: schema.entities.thumbnailStatus,
          thumbnailVersion: schema.entities.thumbnailVersion,
          thumbnailUpdatedAt: schema.entities.thumbnailUpdatedAt,
          ownerId: schema.entities.userId,
          publicAccess: schema.entities.publicAccess,
          parentId: schema.entities.parentId,
          favoritedAt: schema.userEntityPrefs.favoritedAt,
          archivedAt: schema.userEntityPrefs.archivedAt,
          sharedWithCount: sql<number>`count(${schema.sharedEntities.userId})`,
          tags: sql<string>`group_concat(${schema.tags.name}, ',')`,
          // Direct children the caller owns or was given, the ones this
          // listing shows them inside it.
          childCount: sql<number>`(select cast(count(*) as int) from Entities as child where child.parentId = ${schema.entities.id} and child.deletedAt is null and (child.userId = ${ctx.session.user.id} or exists (select 1 from SharedEntities as share where share.entityId = child.id and share.userId = ${ctx.session.user.id})))`,
        })
        .from(schema.entities)
        .leftJoin(schema.users, eq(schema.entities.userId, schema.users.id))
        .leftJoin(
          schema.sharedEntities,
          eq(schema.entities.id, schema.sharedEntities.entityId),
        )
        .leftJoin(
          schema.userEntityPrefs,
          and(
            eq(schema.userEntityPrefs.entityId, schema.entities.id),
            eq(schema.userEntityPrefs.userId, ctx.session.user.id),
          ),
        )
        .leftJoin(
          schema.entityTags,
          and(
            eq(schema.entities.id, schema.entityTags.entityId),
            eq(schema.entityTags.userId, ctx.session.user.id),
          ),
        )
        .leftJoin(schema.tags, eq(schema.entityTags.tagId, schema.tags.id))
        .where(
          and(
            or(
              eq(schema.entities.userId, ctx.session.user.id),
              eq(schema.sharedEntities.userId, ctx.session.user.id),
            ),
            isNull(schema.entities.deletedAt),
            input.parentId
              ? eq(schema.entities.parentId, input.parentId)
              : isNull(schema.entities.parentId),
            // favorites filter
            input.onlyFavorites
              ? sql`${schema.userEntityPrefs.favoritedAt} is not null`
              : undefined,
            // archived items are hidden unless asked for, or asked for alone
            input.onlyArchived
              ? sql`${schema.userEntityPrefs.archivedAt} is not null`
              : input.includeArchived
                ? undefined
                : isNull(schema.userEntityPrefs.archivedAt),
            // Include the tag filter if tag names were provided
            tagFilteredEntityIds
              ? inArray(schema.entities.id, tagFilteredEntityIds)
              : undefined,
            // entityTypes filter
            input.entityTypes && input.entityTypes.length > 0
              ? inArray(schema.entities.entityType, input.entityTypes)
              : undefined,
          ),
        )
        .groupBy(schema.entities.id)
        .orderBy(desc(schema.entities.updatedAt))
        .execute();

      // Step 3: Sort and format the output
      return sortArrOfObjects<
        (typeof entities)[number],
        "title" | "updatedAt" | "createdAt"
      >(entities, input.sortOrder, input.sortBy).map(
        ({ ownerId, ...entity }) => ({
          ...entity,
          isOwner: ownerId === ctx.session.user.id,
          tags: entity.tags ? entity.tags.split(",").filter(Boolean) : [],
        }),
      );
    }),
  updateUserPrefs: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        favorite: z.boolean().optional(),
        archive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (!(await findReadableFacts(ctx.drizzle, input.entityId, userId))) {
        throw notFound();
      }

      const existing = (
        await ctx.drizzle
          .select({
            favoritedAt: schema.userEntityPrefs.favoritedAt,
            archivedAt: schema.userEntityPrefs.archivedAt,
          })
          .from(schema.userEntityPrefs)
          .where(
            and(
              eq(schema.userEntityPrefs.userId, userId),
              eq(schema.userEntityPrefs.entityId, input.entityId),
            ),
          )
      )[0];

      const newFavoritedAt =
        input.favorite === undefined
          ? (existing?.favoritedAt ?? null)
          : input.favorite
            ? new Date()
            : null;
      const newArchivedAt =
        input.archive === undefined
          ? (existing?.archivedAt ?? null)
          : input.archive
            ? new Date()
            : null;

      await ctx.drizzle
        .insert(schema.userEntityPrefs)
        .values({
          userId,
          entityId: input.entityId,
          favoritedAt: newFavoritedAt ?? undefined,
          archivedAt: newArchivedAt ?? undefined,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            schema.userEntityPrefs.userId,
            schema.userEntityPrefs.entityId,
          ],
          set: {
            favoritedAt: newFavoritedAt ?? undefined,
            archivedAt: newArchivedAt ?? undefined,
            updatedAt: new Date(),
          },
        })
        .execute();

      // Favourite and archive are both rendered in the listing this entity
      // appears in, so the directory above it goes with it.
      await revalidateEntitiesAndParents(ctx.drizzle, input.entityId);
    }),
  getCookies: protectedProcedure.query(async ({ ctx }) => {
    const result = await ctx.drizzle
      .select({
        config: schema.users.config,
      })
      .from(schema.users)
      .where(eq(schema.users.id, ctx.session.user.id))
      .execute();

    const cookies = result[0]?.config?.cookies ?? [];

    return cookies;
  }),
  setCookies: protectedProcedure
    .input(
      z.object({
        cookies: z.array(z.object({ name: z.string(), value: z.string() })),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await ctx.drizzle
        .update(schema.users)
        .set({
          config: {
            cookies: input.cookies,
          },
        })
        .where(eq(schema.users.id, ctx.session.user.id))
        .execute();
    }),
  getUserTags: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/tags",
        tags: ["entities"],
        summary: "List the tags the caller has on entities they can still see",
        protect: true,
      },
    })
    .output(z.array(z.string()))
    .query(async ({ ctx }) => {
      const rows = await ctx.drizzle
        .selectDistinct({ name: schema.tags.name })
        .from(schema.entityTags)
        .innerJoin(schema.tags, eq(schema.entityTags.tagId, schema.tags.id))
        .innerJoin(
          schema.entities,
          eq(schema.entityTags.entityId, schema.entities.id),
        )
        .where(
          and(
            eq(schema.entityTags.userId, ctx.session.user.id),
            // A tag is listed only if filtering by it finds something, so the
            // entity has to be one `list` would show. A trashed entity keeps
            // its tag rows so a restore brings them back, and an unshare
            // leaves the former sharer's; archived entities still count, as
            // `list` reaches them with `includeArchived`.
            isNull(schema.entities.deletedAt),
            or(
              eq(schema.entities.userId, ctx.session.user.id),
              exists(
                ctx.drizzle
                  .select({ id: schema.sharedEntities.id })
                  .from(schema.sharedEntities)
                  .where(
                    and(
                      eq(schema.sharedEntities.entityId, schema.entities.id),
                      eq(schema.sharedEntities.userId, ctx.session.user.id),
                    ),
                  ),
              ),
            ),
          ),
        )
        .orderBy(schema.tags.name)
        .execute();

      return rows.map((row) => row.name);
    }),
  getEntityTags: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/entities/{id}/tags",
        tags: ["entities"],
        summary: "List the tags on one entity",
        protect: true,
      },
    })
    .input(z.object({ id: z.string() }))
    .output(z.array(z.string()))
    .query(async ({ ctx, input }) => {
      const entity = await findReadableEntity(
        ctx.drizzle,
        input.id,
        ctx.session.user.id,
      );
      if (!entity) throw notFound();

      return ownTagNames(ctx.drizzle, input.id, ctx.session.user.id);
    }),
  updateEntityTags: protectedProcedure
    .meta({
      openapi: {
        method: "PUT",
        path: "/entities/{id}/tags",
        tags: ["entities"],
        summary: "Replace the tags on one entity",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.string(),
        // Deduped so a repeated name cannot collide on the association key.
        tagNames: z.array(z.string()).transform((names) => [...new Set(names)]),
      }),
    )
    .output(z.object({ id: z.string(), tags: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const entity = await findWritableEntity(ctx.drizzle, input.id, userId);
      if (!entity) throw notFound();

      await replaceOwnTags(ctx.drizzle, input.id, userId, input.tagNames);

      // The parent too: a directory listing shows each child's tags.
      revalidateEntities(input.id, entity.parentId);
      return {
        id: input.id,
        tags: await ownTagNames(ctx.drizzle, input.id, userId),
      };
    }),
  getSharedInfo: protectedProcedure
    .meta({
      openapi: {
        method: "GET",
        path: "/entities/{id}/shares",
        tags: ["entities"],
        summary: "List the users an entity is shared with; only its owner may",
        protect: true,
      },
    })
    .input(z.object({ id: z.string() }))
    .output(
      z.array(
        z.object({
          entityId: z.string(),
          userId: z.string(),
          accessLevel: accessLevelOut,
          email: z.string().nullable(),
          name: z.string().nullable(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const entity = await findOwnedEntity(
        ctx.drizzle,
        input.id,
        ctx.session.user.id,
      );
      if (!entity) throw notFound();

      const sharedDrawings = await ctx.drizzle
        .select({
          entityId: schema.sharedEntities.entityId,
          userId: schema.sharedEntities.userId,
          accessLevel: schema.sharedEntities.accessLevel,
          email: schema.users.email,
          name: schema.users.name,
        })
        .from(schema.sharedEntities)
        .leftJoin(
          schema.users,
          eq(schema.sharedEntities.userId, schema.users.id),
        )
        .where(eq(schema.sharedEntities.entityId, input.id))
        .execute();

      return sharedDrawings;
    }),
  delete: protectedProcedure
    .meta({
      openapi: {
        method: "DELETE",
        path: "/entities/{id}",
        tags: ["entities"],
        summary: "Move an entity to the trash",
        protect: true,
      },
    })
    .input(z.object({ id: z.string() }))
    .output(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const entity = await findOwnedEntity(
        ctx.drizzle,
        input.id,
        ctx.session.user.id,
      );
      if (!entity) throw notFound();

      await ctx.drizzle
        .update(schema.entities)
        .set({
          deletedAt: new Date(),
        })
        .where(eq(schema.entities.id, input.id))
        .execute();

      await revalidateEntitiesAndParents(
        ctx.drizzle,
        input.id,
        entity.parentId,
      );
      return { id: input.id };
    }),
  update: publicProcedure
    .meta({
      openapi: {
        method: "PATCH",
        path: "/entities/{id}",
        tags: ["entities"],
        summary: "Change an entity's title, parent, or public access",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.string(),
        title: z.string().optional(),
        parentId: z.string().nullable().optional(),
        prevParentId: z.string().nullable().optional(),
        screenShotLight: z.string().optional(),
        screenShotDark: z.string().optional(),
        publicAccess: z
          .enum([PublicAccess.READ, PublicAccess.EDIT, PublicAccess.PRIVATE])
          .optional(),
      }),
    )
    .output(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.session?.user.id ?? "";
      const entity = await findWritableEntity(ctx.drizzle, input.id, userId);
      if (!entity) throw notFound();
      // Who may see the entity is the owner's call, not an editor's; they can
      // already read it, so saying so is not a leak.
      if ("publicAccess" in input && entity.ownerId !== userId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the owner can change public access",
        });
      }

      // Checked only when it changes, so a caller echoing the parent back
      // with a rename is not asked whether they may write into it.
      const moving =
        input.parentId !== undefined && input.parentId !== entity.parentId;
      const columns = {
        ...("title" in input ? { title: input.title } : {}),
        ...("publicAccess" in input
          ? { publicAccess: input.publicAccess }
          : {}),
        ...(moving
          ? {
              parentId: await resolveMoveDestination(
                ctx.drizzle,
                entity,
                input.parentId ?? null,
                userId,
              ),
            }
          : {}),
        updatedAt: new Date(),
      };
      // Awaited: a REST caller reads the entity back the moment this returns.
      if (
        input.screenShotLight !== undefined ||
        input.screenShotDark !== undefined
      ) {
        await storeThumbnail(
          ctx.drizzle,
          input.id,
          { light: input.screenShotLight, dark: input.screenShotDark },
          columns,
        );
      } else {
        await ctx.drizzle
          .update(schema.entities)
          .set(columns)
          .where(eq(schema.entities.id, input.id))
          .execute();
      }

      // Every directory this entity was or is listed in; `prevParentId` is
      // what a drag out of a directory carries. A move changes both
      // directories' child counts, so the listings above them go too.
      await revalidateEntitiesAndParents(
        ctx.drizzle,
        input.id,
        entity.parentId,
        input.parentId,
        input.prevParentId,
      );
      return { id: input.id };
    }),
  share: protectedProcedure
    .meta({
      openapi: {
        method: "POST",
        path: "/entities/{id}/shares",
        tags: ["entities"],
        summary: "Share an entity with a user by email",
        protect: true,
        // A POST has no 404 by default; an unknown entity or invitee is one.
        errorResponses: [400, 401, 403, 404, 500],
      },
    })
    .input(
      z.object({
        id: z.string(),
        userEmail: z.string(),
        accessLevel: z.enum([AccessLevel.READ, AccessLevel.EDIT]),
      }),
    )
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const entity = await findOwnedEntity(
        ctx.drizzle,
        input.id,
        ctx.session.user.id,
      );
      if (!entity) throw notFound();

      const userToShareWith = await ctx.drizzle.query.users.findFirst({
        where: (user, { eq }) => eq(user.email, input.userEmail),
      });
      if (!userToShareWith) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Sorry that user doesn't exist",
        });
      }

      await ctx.drizzle
        .insert(schema.sharedEntities)
        .values({
          id: `${input.id}-${userToShareWith.id}`,
          entityId: input.id,
          userId: userToShareWith.id,
          accessLevel: input.accessLevel,
          createdAt: new Date(),
        })
        .onConflictDoUpdate({
          target: schema.sharedEntities.id,
          set: {
            accessLevel: input.accessLevel,
          },
        })
        .execute();

      // The listing renders how many people an entity is shared with.
      revalidateEntities(input.id, entity.parentId);
      return { success: true, message: "Entity shared successfully" };
    }),
  changeAccessLevel: protectedProcedure
    .meta({
      openapi: {
        method: "PATCH",
        path: "/entities/{id}/shares/{userId}",
        tags: ["entities"],
        summary: "Change one user's access level on an entity",
        protect: true,
      },
    })
    .input(
      z.object({
        id: z.string(),
        userId: z.string(),
        accessLevel: z.enum([AccessLevel.READ, AccessLevel.EDIT]),
      }),
    )
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const entity = await findOwnedEntity(
        ctx.drizzle,
        input.id,
        ctx.session.user.id,
      );
      if (!entity) throw notFound();

      const [changed] = await ctx.drizzle
        .update(schema.sharedEntities)
        .set({
          accessLevel: input.accessLevel,
        })
        .where(
          and(
            eq(schema.sharedEntities.entityId, input.id),
            eq(schema.sharedEntities.userId, input.userId),
          ),
        )
        .returning({ userId: schema.sharedEntities.userId });
      if (!changed) throw shareNotFound();
      revalidateEntities(input.id, entity.parentId);
      return { success: true, message: "Access level changed successfully" };
    }),
  unShare: protectedProcedure
    .meta({
      openapi: {
        method: "DELETE",
        path: "/entities/{id}/shares/{userId}",
        tags: ["entities"],
        summary: "Stop sharing an entity with one user",
        protect: true,
      },
    })
    .input(z.object({ id: z.string(), userId: z.string() }))
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const entity = await findOwnedEntity(
        ctx.drizzle,
        input.id,
        ctx.session.user.id,
      );
      if (!entity) throw notFound();

      const [removed] = await ctx.drizzle
        .delete(schema.sharedEntities)
        .where(
          and(
            eq(schema.sharedEntities.entityId, input.id),
            eq(schema.sharedEntities.userId, input.userId),
          ),
        )
        .returning({ userId: schema.sharedEntities.userId });
      if (!removed) throw shareNotFound();
      revalidateEntities(input.id, entity.parentId);
      return { success: true, message: "Entity unshared successfully" };
    }),
  generateUploadUrl: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        contentType: z.enum([
          "image/svg+xml",
          "image/jpeg",
          "image/png",
          "image/webp",
          "image/avif",
        ]),
        mode: z.enum(["direct", "redirect"]), // kept for API shape
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await writableOrNotFound(
        ctx.drizzle,
        input.entityId,
        ctx.session.user.id,
      );

      /* --- generate client token ----------------------------------- */
      const extension = input.contentType.split("/")[1]?.replace(/\+.*$/, "");
      if (!extension)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Invalid content type",
        });
      const randomId = uuidV4();
      const pathname = `${input.entityId}-${randomId}.${extension}`;

      const token = await generateClientTokenFromReadWriteToken({
        token: env.BLOB_READ_WRITE_TOKEN,
        pathname,
        allowedContentTypes: [input.contentType],
        addRandomSuffix: false, // we already randomised
      } satisfies GenerateClientTokenOptions);

      /* --- persist expected upload --------------------------------- */
      await ctx.drizzle
        .insert(ctx.schema.uploadedImages)
        .values({
          id: randomId,
          userId: ctx.session.user.id,
          entityId: input.entityId,
          fileName: pathname,
          signedUploadUrl: token,
          signedDownloadUrl: "",
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: ctx.schema.uploadedImages.id,
          set: { signedUploadUrl: token, updatedAt: new Date() },
        })
        .execute();

      /* --- respond (minimal API break) ----------------------------- */
      return {
        token, // 🔑  to be used with `put(pathname, file, { token })`
        pathname, // where the blob will live
      };
    }),

  generateVideoUploadUrl: protectedProcedure
    .input(
      z.object({
        entityId: z.string(),
        contentType: z.enum(["video/mp4", "video/webm", "video/ogg"]),
        mode: z.enum(["direct", "redirect"]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await writableOrNotFound(
        ctx.drizzle,
        input.entityId,
        ctx.session.user.id,
      );

      const extension = input.contentType.split("/")[1]?.replace(/\+.*$/, "");
      if (!extension)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Invalid content type",
        });
      const randomId = uuidV4();
      const pathname = `${input.entityId}-${randomId}.${extension}`;

      const token = await generateClientTokenFromReadWriteToken({
        token: env.BLOB_READ_WRITE_TOKEN,
        pathname,
        allowedContentTypes: [input.contentType],
      });

      await ctx.drizzle
        .insert(ctx.schema.uploadedVideos)
        .values({
          id: randomId,
          userId: ctx.session.user.id,
          entityId: input.entityId,
          fileName: pathname,
          signedUploadUrl: token,
          signedDownloadUrl: "",
          requestId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: ctx.schema.uploadedVideos.id,
          set: { signedUploadUrl: token, updatedAt: new Date() },
        })
        .execute();

      return { token, pathname };
    }),

  downloadAndUploadByUrl: protectedProcedure
    .input(z.object({ url: z.string(), entityId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const { url, entityId } = input;
      await writableOrNotFound(
        ctx.drizzle,
        input.entityId,
        ctx.session.user.id,
      );
      const cookies = await cookieFor(ctx.drizzle, ctx.session.user.id, url);

      console.log("downloading and uploading by url", {
        url,
        entityId,
        cookies,
      });

      const response = await fetch(`${env.MEDIA_DOWNLOADER_URL}/download`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${env.SHARED_KEY}`,
        },
        body: JSON.stringify({
          url,
          entityId,
          userId: ctx.session.user.id,
          ...(cookies ?? {}),
        }),
      });

      console.log("response", response.status);

      if (!response.ok) {
        // log response text
        const responseText = await response.text();
        console.error("response text", responseText);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to download and upload media, ${responseText}`,
        });
      }

      // validate with zod
      // {"requestId":"[Req: 7bb4ecde]"}
      const responseBody = await response.json();
      console.log("responseBody", responseBody);
      const zodResponse = z
        .object({
          requestId: z.string(),
        })
        .parse(responseBody);

      return zodResponse;
    }),
  getDownloadUrlByRequestId: protectedProcedure
    .input(z.object({ requestId: z.string(), entityId: z.string() }))
    .query(async ({ input, ctx }) => {
      await writableOrNotFound(
        ctx.drizzle,
        input.entityId,
        ctx.session.user.id,
      );
      const [video] = await ctx.drizzle
        .select({
          status: schema.uploadedVideos.status,
          signedDownloadUrl: schema.uploadedVideos.signedDownloadUrl,
          errorMessage: schema.uploadedVideos.errorMessage,
        })
        .from(schema.uploadedVideos)
        .where(
          and(
            eq(schema.uploadedVideos.entityId, input.entityId),
            eq(schema.uploadedVideos.requestId, input.requestId),
          ),
        );
      if (!video) throw notFound();
      return video;
    }),
  // searches for tags or content
  deepSearch: protectedProcedure
    .input(z.object({ query: z.string() }))
    .output(z.array(entitySearchResult))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      if (input.query.trim() === "") {
        return [];
      }

      const likePattern = `%${input.query.toLowerCase()}%`;

      const results = await ctx.drizzle
        .selectDistinct({
          id: schema.entities.id,
          title: schema.entities.title,
          entityType: schema.entities.entityType,
          updatedAt: schema.entities.updatedAt,
          parentId: schema.entities.parentId,
          screenShotLight: schema.entities.screenShotLight,
          screenShotDark: schema.entities.screenShotDark,
          elements: schema.entities.elements,
          tagName: schema.tags.name,
        })
        .from(schema.entities)
        .leftJoin(
          schema.sharedEntities,
          eq(schema.entities.id, schema.sharedEntities.entityId),
        )
        // The searcher's own tags: tags are per user.
        .leftJoin(
          schema.entityTags,
          and(
            eq(schema.entities.id, schema.entityTags.entityId),
            eq(schema.entityTags.userId, userId),
          ),
        )
        .leftJoin(schema.tags, eq(schema.entityTags.tagId, schema.tags.id))
        .where(
          and(
            // Permission check
            or(
              eq(schema.entities.userId, userId),
              eq(schema.sharedEntities.userId, userId),
            ),
            isNull(schema.entities.deletedAt),

            // Match EITHER (content OR tags) AND entity type is relevant
            or(
              // Match content in drawings/documents
              and(
                or(
                  eq(schema.entities.entityType, "drawing"),
                  eq(schema.entities.entityType, "document"),
                  eq(schema.entities.entityType, "url"),
                ),
                or(
                  sql`LOWER(${schema.entities.elements}) like ${likePattern}`,
                  sql`LOWER(${schema.entities.appState}) like ${likePattern}`,
                ),
              ),
              // OR Match tag name (for any entity type)
              sql`LOWER(${schema.tags.name}) like ${likePattern}`,
            ),
          ),
        )
        .orderBy(desc(schema.entities.updatedAt))
        .limit(50);

      // The query matches the stored JSON, keys and all; a hit counts only
      // when the words a person reads, or a tag, contain the query.
      const query = input.query.trim().toLowerCase();
      const hits = new Map<
        string,
        Omit<(typeof results)[number], "elements" | "tagName"> & {
          snippet: string | null;
        }
      >();
      for (const { elements, tagName, ...result } of results) {
        const known = hits.get(result.id);
        if (known?.snippet) continue;
        const snippet = snippetAround(
          entityText(result.entityType, elements),
          query,
        );
        const taggedWith = tagName?.toLowerCase().includes(query) ?? false;
        if (snippet || taggedWith) hits.set(result.id, { ...result, snippet });
      }
      return inReadableFolders(
        ctx.drizzle,
        [...hits.values()].slice(0, 10),
        userId,
      );
    }),
  /* --------------------------------------------------------------- */
  /* URL DISTILLATION                                                */
  /* --------------------------------------------------------------- */
  distillUrl: protectedProcedure
    .input(z.object({ id: z.string(), force: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      // 1) Load entity and verify access
      const entity = await writableOrNotFound(
        ctx.drizzle,
        input.id,
        ctx.session.user.id,
      );

      // 2) Parse existing elements
      let elementsJson: Record<string, unknown> = {};
      try {
        elementsJson = JSON.parse(entity.elements ?? "{}") as Record<
          string,
          unknown
        >;
      } catch {
        // keep empty
      }
      const url = (elementsJson?.url as string) || "";
      if (!url) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No URL set on entity",
        });
      }

      // 3) Run extractor with optional per-domain cookies
      const cookiesHeader =
        (await cookieFor(ctx.drizzle, ctx.session.user.id, url))?.value ||
        undefined;

      let distilled = await extractAndSanitizeArticle({
        url,
        cookiesHeader,
      });

      // Headless fallback when content is too short
      const tooShort =
        (distilled.contentHtml?.length ?? 0) < 200 ||
        (distilled.wordCount ?? 0) < 50;
      const headlessEnabled = !!env.HEADLESS_RENDER_ENABLED;
      let endpoint: string;
      if (env.HEADLESS_RENDER_URL) {
        const base = env.HEADLESS_RENDER_URL.replace(/\/+$/, "");
        endpoint = base.endsWith("/api/render-html")
          ? base
          : `${base}/api/render-html`;
      } else {
        // Local dev fallback to worker
        if (env.NODE_ENV !== "production") {
          endpoint = "http://localhost:4025/api/render-html";
        } else {
          endpoint = `http${(await headers()).get("x-forwarded-proto") === "https" ? "s" : ""}://${(await headers()).get("host")}/api/render-html`;
        }
      }
      console.log({ headlessEnabled, tooShort, endpoint });
      if (headlessEnabled && tooShort) {
        try {
          if (env.NODE_ENV !== "production") {
            console.log("headless:fetch", { endpoint, url });
          }
          const controller = AbortSignal.timeout(15000);
          const res = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              url,
              cookiesHeader,
              waitUntil: "domcontentloaded",
              timeoutMs: 15000,
            }),
            signal: controller,
          });
          if (res.ok) {
            const ct = res.headers.get("content-type") || "";
            if (ct.includes("application/json")) {
              const json = (await res.json()) as { html?: string };
              if (json?.html) {
                const rendered = await extractAndSanitizeArticle({
                  url,
                  html: json.html,
                  cookiesHeader,
                });
                const improved =
                  (rendered.contentHtml?.length ?? 0) >
                    (distilled.contentHtml?.length ?? 0) ||
                  (rendered.wordCount ?? 0) > (distilled.wordCount ?? 0);
                if (improved) {
                  distilled = rendered;
                  if (process.env.NODE_ENV !== "production") {
                    console.log("headless:used", {
                      words: rendered.wordCount,
                      chars: rendered.contentHtml.length,
                    });
                  }
                }
              }
            } else {
              const snippet = (await res.text()).slice(0, 200);
              console.warn("headless:non_json", { ct, snippet });
            }
          } else if (process.env.NODE_ENV !== "production") {
            console.warn("headless:failed", res.status);
          }
        } catch (e) {
          console.warn("headless:error", e);
        }
      }

      // 4) Upload best image to Blob (if any) and set screenshot columns
      let screenShotLight: string | undefined;
      let screenShotDark: string | undefined;
      if (distilled.bestImageUrl) {
        try {
          const res = await fetch(distilled.bestImageUrl);
          if (res.ok) {
            const contentType = res.headers.get("content-type") || "image/jpeg";
            const ext = contentType.includes("png")
              ? "png"
              : contentType.includes("webp")
                ? "webp"
                : contentType.includes("svg")
                  ? "svg"
                  : contentType.includes("avif")
                    ? "avif"
                    : "jpg";
            const buffer = Buffer.from(await res.arrayBuffer());
            const blob = await put(
              thumbnailPathname(input.id, "thumb", ext),
              buffer,
              { access: "public", contentType },
            );
            screenShotLight = blob.url;
            screenShotDark = blob.url;
          }
        } catch (e) {
          console.warn("Failed to upload bestImageUrl", e);
        }
      }

      // 5) Merge distilled payload and optionally update title/screenshots
      const mergedElements = JSON.stringify({
        ...elementsJson,
        distilled,
      });

      // If default title, set to distilled.title
      const isDefaultTitle = !entity?.title || entity.title === "New link";
      const updates = {
        elements: mergedElements,
        updatedAt: new Date(),
        ...(isDefaultTitle && distilled.title
          ? { title: distilled.title }
          : {}),
      };

      if (screenShotLight || screenShotDark) {
        await storeThumbnail(
          ctx.drizzle,
          input.id,
          { light: screenShotLight, dark: screenShotDark },
          updates,
        );
      } else {
        await ctx.drizzle
          .update(schema.entities)
          .set(updates)
          .where(eq(schema.entities.id, input.id))
          .execute();
      }

      await revalidateEntitiesAndParents(ctx.drizzle, input.id);
      return distilled;
    }),
  regenerateThumbnail: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      const entity = await writableOrNotFound(
        ctx.drizzle,
        input.id,
        ctx.session.user.id,
      );

      const crypto = await import("node:crypto");
      const version = crypto
        .createHash("md5")
        .update(
          JSON.stringify({
            elements: entity.elements,
            appState: entity.appState ?? "",
          }),
        )
        .digest("hex");

      await ctx.drizzle
        .update(ctx.schema.entities)
        .set({ thumbnailStatus: "pending", thumbnailVersion: version })
        .where(eq(ctx.schema.entities.id, input.id))
        .execute();

      // The listing renders the thumbnail and whether one is on its way.
      await revalidateEntitiesAndParents(ctx.drizzle, input.id);

      await ctx.drizzle
        .insert(ctx.schema.thumbnailJobs)
        .values({
          id: uuidV4(),
          entityId: input.id,
          version,
          status: "pending",
          attempts: 0,
          nextRunAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [
            ctx.schema.thumbnailJobs.entityId,
            ctx.schema.thumbnailJobs.version,
          ],
          set: {
            status: "pending",
            updatedAt: new Date(),
            nextRunAt: new Date(),
            lastError: null,
          },
        })
        .execute();

      return { ok: true };
    }),
});
