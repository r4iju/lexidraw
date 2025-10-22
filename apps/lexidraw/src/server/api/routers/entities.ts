import { z } from "zod";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import { CreateEntity, SaveEntity } from "./entities-schema";
import { PublicAccess, AccessLevel } from "@packages/types";
import { TRPCError } from "@trpc/server";
import {
  and,
  desc,
  eq,
  isNull,
  ne,
  or,
  schema,
  sql,
  inArray,
} from "@packages/drizzle";
import type { AppState } from "@excalidraw/excalidraw/types";
import { v4 as uuidV4 } from "uuid";
import { extractAndSanitizeArticle } from "~/server/extractors/article";
import env from "@packages/env";
import { put } from "@vercel/blob";
import {
  generateClientTokenFromReadWriteToken,
  type GenerateClientTokenOptions,
} from "@vercel/blob/client";
import { headers } from "next/headers";

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
    .input(CreateEntity)
    .mutation(async ({ input, ctx }) => {
      return await ctx.drizzle
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
          parentId: input.parentId,
          appState: JSON.stringify({}),
        })
        .onConflictDoNothing()
        .returning();
    }),
  save: publicProcedure.input(SaveEntity).mutation(async ({ input, ctx }) => {
    const userId = ctx.session?.user.id ?? "";
    const drawings = await ctx.drizzle
      .select({
        count: sql<number>`cast(count(${schema.entities.id}) as int)`,
      })
      .from(schema.entities)
      .leftJoin(schema.users, eq(schema.entities.userId, schema.users.id))
      .leftJoin(
        schema.sharedEntities,
        eq(schema.entities.id, schema.sharedEntities.entityId),
      )
      .where(
        and(
          or(
            eq(schema.entities.userId, userId),
            eq(schema.sharedEntities.userId, userId),
            eq(schema.entities.publicAccess, PublicAccess.EDIT),
          ),
          isNull(schema.entities.deletedAt),
        ),
      )
      .groupBy(schema.entities.id)
      .having(({ count }) => eq(count, 1))
      .execute();

    if (!drawings[0]) {
      throw new TRPCError({
        code: "UNAUTHORIZED",
        message: "You are not authorized to save this drawing",
      });
    }

    let appState: null | string = null;
    const parsedAppState = JSON.parse(input.appState ?? "{}");
    if (input.appState) {
      appState = JSON.stringify({
        ...(parsedAppState as unknown as AppState),
        collaborators:
          (parsedAppState as unknown as AppState).collaborators instanceof Map
            ? Object.fromEntries(
                (parsedAppState as unknown as AppState).collaborators.entries(),
              )
            : undefined,
      });
    }

    console.log("appState", appState);

    await ctx.drizzle
      .update(schema.entities)
      .set({
        id: input.id,
        title: input.title,
        appState: appState,
        elements: input.elements,
        ...(input.parentId ? { parentId: input.parentId } : {}),
      })
      .where(eq(schema.entities.id, input.id))
      .execute();
  }),
  load: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id ?? "";

      const entities = await ctx.drizzle
        .select({
          id: schema.entities.id,
          title: schema.entities.title,
          appState: schema.entities.appState,
          elements: schema.entities.elements,
          entityType: schema.entities.entityType,
          publicAccess: schema.entities.publicAccess,
          sharedWithId: schema.sharedEntities.userId,
          sharedAccessLevel: schema.sharedEntities.accessLevel,
          ownerId: schema.users.id,
        })
        .from(schema.entities)
        .where(
          and(
            eq(schema.entities.id, input.id),
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
      const entity = entities[0];
      if (!entity) {
        throw new TRPCError({
          message: "Drawing not found",
          code: "NOT_FOUND",
        });
      }

      const sharedEntities = await ctx.drizzle
        .select()
        .from(schema.sharedEntities)
        .where(eq(schema.sharedEntities.entityId, input.id));

      const hasEditAccess =
        entity.ownerId === ctx.session?.user?.id ||
        entity.sharedAccessLevel === AccessLevel.EDIT ||
        entity.publicAccess === PublicAccess.EDIT;
      const accessLevel = hasEditAccess ? AccessLevel.EDIT : AccessLevel.READ;

      return {
        id: entity.id,
        title: entity.title,
        appState: entity.appState,
        elements: entity.elements,
        publicAccess: entity.publicAccess,
        sharedWith: sharedEntities.map((entity) => ({
          userId: entity.id,
          accessLevel: entity.accessLevel,
        })),
        accessLevel,
      };
    }),
  getMetadata: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const userId = ctx.session?.user?.id ?? "";

      // 1. fetch the current entity
      const entities = await ctx.drizzle
        .select({
          id: schema.entities.id,
          title: schema.entities.title,
          entityType: schema.entities.entityType,
          publicAccess: schema.entities.publicAccess,
          sharedWithId: schema.sharedEntities.userId,
          sharedAccessLevel: schema.sharedEntities.accessLevel,
          parentId: schema.entities.parentId,
          ownerId: schema.users.id,
        })
        .from(schema.entities)
        .where(
          and(
            eq(schema.entities.id, input.id),
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

      const entity = entities[0];
      if (!entity) {
        throw new TRPCError({
          message: "Entity not found",
          code: "NOT_FOUND",
        });
      }

      // 2. recursively fetch all ancestors
      const ancestors: {
        id: string | null;
        title: string;
        parentId: string | null;
      }[] = [];
      let currentParentId = entity.parentId;

      while (currentParentId) {
        const parentData = await ctx.drizzle
          .select({
            id: schema.entities.id,
            title: schema.entities.title,
            parentId: schema.entities.parentId,
          })
          .from(schema.entities)
          .where(eq(schema.entities.id, currentParentId))
          .execute();

        const parent = parentData[0];
        if (!parent) break;

        ancestors.push(parent);
        currentParentId = parent.parentId;
      }

      // add the root entity
      ancestors.push({
        id: null,
        title: "Root",
        parentId: null,
      });

      // root->child order, so reverse
      ancestors.reverse();

      return {
        ...entity,
        ancestors,
      };
    }),
  list: protectedProcedure
    .input(
      z.object({
        parentId: z.string().nullable(),
        tagNames: z.array(z.string()).optional(),
        sortBy: z
          .enum(["updatedAt", "createdAt", "title"])
          .optional()
          .default("updatedAt"),
        sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),
        includeArchived: z.coerce.boolean().optional().default(false),
        onlyFavorites: z.coerce.boolean().optional().default(false),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Step 1: Get matching entity IDs if tag names are provided
      let tagFilteredEntityIds: string[] | undefined;

      if (input.tagNames?.length) {
        const matchingEntityTags = await ctx.drizzle
          .select({ entityId: schema.entityTags.entityId })
          .from(schema.entityTags)
          .leftJoin(schema.tags, eq(schema.entityTags.tagId, schema.tags.id))
          .where(inArray(schema.tags.name, input.tagNames))
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
          userId: schema.entities.userId,
          publicAccess: schema.entities.publicAccess,
          parentId: schema.entities.parentId,
          favoritedAt: schema.userEntityPrefs.favoritedAt,
          archivedAt: schema.userEntityPrefs.archivedAt,
          sharedWithCount: sql<number>`count(${schema.sharedEntities.userId})`,
          tags: sql<string>`group_concat(${schema.tags.name}, ',')`,
          // number of direct children for directories
          childCount: sql<number>`(select cast(count(*) as int) from Entities as child where child.parentId = ${schema.entities.id} and child.deletedAt is null)`,
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
          eq(schema.entities.id, schema.entityTags.entityId),
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
            // archived filter (exclude archived unless includeArchived=true)
            input.includeArchived
              ? undefined
              : isNull(schema.userEntityPrefs.archivedAt),
            // Include the tag filter if tag names were provided
            tagFilteredEntityIds
              ? inArray(schema.entities.id, tagFilteredEntityIds)
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
      >(entities, input.sortOrder, input.sortBy).map((entity) => ({
        ...entity,
        tags: entity.tags ? entity.tags.split(",").filter(Boolean) : [],
      }));
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
  getUserTags: protectedProcedure.query(async ({ ctx }) => {
    const tags = await ctx.drizzle
      .select({
        name: schema.tags.name,
      })
      .from(schema.entityTags)
      .leftJoin(schema.tags, eq(schema.entityTags.tagId, schema.tags.id))
      // also filter orphan tags (tags that are not associated with any entity  )
      .where(and(eq(schema.entityTags.userId, ctx.session.user.id)))
      .execute();

    return tags
      .map((tag) => tag.name)
      .filter((tag, index, self) => self.indexOf(tag) === index && tag !== null)
      .sort() as string[];
  }),
  getEntityTags: protectedProcedure
    .input(z.object({ entityId: z.string() }))
    .query(async ({ ctx, input }) => {
      const tags = await ctx.drizzle
        .select({
          tagId: schema.entityTags.tagId,
          name: schema.tags.name,
        })
        .from(schema.entityTags)
        .leftJoin(schema.tags, eq(schema.entityTags.tagId, schema.tags.id))
        .where(eq(schema.entityTags.entityId, input.entityId))
        .execute();

      return tags;
    }),
  updateEntityTags: protectedProcedure
    .input(z.object({ entityId: z.string(), tagNames: z.array(z.string()) }))
    .mutation(async ({ ctx, input }) => {
      // If no tagNames provided, simply delete all associations
      if (input.tagNames.length === 0) {
        await ctx.drizzle
          .delete(schema.entityTags)
          .where(eq(schema.entityTags.entityId, input.entityId))
          .execute();
        return;
      }

      await ctx.drizzle.transaction(async (tx) => {
        // new tags
        await tx
          .insert(schema.tags)
          .values(
            input.tagNames.map((tagName) => ({
              id: uuidV4(),
              name: tagName,
            })),
          )
          .onConflictDoNothing()
          .execute();

        // get all tags
        const allTags = await tx
          .select({ id: schema.tags.id, name: schema.tags.name })
          .from(schema.tags)
          .where(inArray(schema.tags.name, input.tagNames))
          .execute();

        const tagNameToId = new Map<string, string>();
        for (const tag of allTags) {
          tagNameToId.set(tag.name, tag.id);
        }

        const newTagIds = input.tagNames.map((tagName) => {
          const tagId = tagNameToId.get(tagName);
          if (!tagId) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: `Failed to find tag ID for tag name: ${tagName}`,
            });
          }
          return tagId;
        });

        // get current associations
        const currentAssociations = await tx
          .select({ tagId: schema.entityTags.tagId })
          .from(schema.entityTags)
          .where(eq(schema.entityTags.entityId, input.entityId))
          .execute();
        const currentTagIds = new Set(
          currentAssociations.map((assoc) => assoc.tagId),
        );

        // calculate differences
        const tagsToAdd = newTagIds.filter(
          (tagId) => !currentTagIds.has(tagId),
        );
        const tagsToRemove = [...currentTagIds].filter(
          (tagId) => !newTagIds.includes(tagId),
        );

        if (tagsToRemove.length > 0) {
          await tx
            .delete(schema.entityTags)
            .where(
              and(
                eq(schema.entityTags.entityId, input.entityId),
                inArray(schema.entityTags.tagId, tagsToRemove),
              ),
            )
            .execute();
        }
        if (tagsToAdd.length > 0) {
          await tx
            .insert(schema.entityTags)
            .values(
              tagsToAdd.map((tagId) => ({
                entityId: input.entityId,
                tagId,
                userId: ctx.session.user.id,
              })),
            )
            .execute();
        }
      });
    }),
  getSharedInfo: protectedProcedure
    .input(z.object({ drawingId: z.string() }))
    .query(async ({ ctx, input }) => {
      const sharedDrawings = await ctx.drizzle
        .select({
          drawingId: schema.sharedEntities.entityId,
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
        .where(eq(schema.sharedEntities.entityId, input.drawingId))
        .execute();

      return sharedDrawings;
    }),
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.drizzle
        .update(schema.entities)
        .set({
          deletedAt: new Date(),
        })
        .where(eq(schema.entities.id, input.id))
        .execute();
    }),
  update: publicProcedure
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
    .mutation(async ({ input, ctx }) => {
      console.log("update with input: ", input);
      const drawings = await ctx.drizzle
        .select({
          count: sql<number>`cast(count(${schema.entities.id}) as int)`,
        })
        .from(schema.entities)
        .leftJoin(schema.users, eq(schema.entities.userId, schema.users.id))
        .leftJoin(
          schema.sharedEntities,
          eq(schema.entities.id, schema.sharedEntities.entityId),
        )
        .where(
          and(
            or(
              eq(schema.entities.userId, ctx.session?.user.id as string),
              eq(schema.sharedEntities.userId, ctx.session?.user.id as string),
            ),
            isNull(schema.entities.deletedAt),
          ),
        )
        .groupBy(schema.entities.id)
        .having(({ count }) => eq(count, 1))
        .execute();

      if (!drawings[0]) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to save this drawing",
        });
      }

      ctx.drizzle
        .update(schema.entities)
        .set({
          ...("title" in input ? { title: input.title } : {}),
          ...("publicAccess" in input
            ? { publicAccess: input.publicAccess }
            : {}),
          ...("parentId" in input ? { parentId: input.parentId } : {}),
          ...("screenShotLight" in input
            ? { screenShotLight: input.screenShotLight }
            : {}),
          ...("screenShotDark" in input
            ? { screenShotDark: input.screenShotDark }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.entities.id, input.id))
        .execute();
    }),
  /** Generate thumbnails via headless worker (WEBP light/dark). */
  generateThumbnailsViaWorker: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      if (!env.HEADLESS_RENDER_ENABLED) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Headless not enabled",
        });
      }

      const entity = (
        await ctx.drizzle
          .select({
            id: schema.entities.id,
            userId: schema.entities.userId,
            publicAccess: schema.entities.publicAccess,
          })
          .from(schema.entities)
          .where(eq(schema.entities.id, input.id))
      )[0];
      if (!entity)
        throw new TRPCError({ code: "NOT_FOUND", message: "Entity not found" });

      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEdit = entity.publicAccess === PublicAccess.EDIT;
      if (!isOwner && !anyOneCanEdit)
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Forbidden" });

      const heads = ctx.headers as Headers;
      const proto = heads.get("x-forwarded-proto") || "http";
      const host = heads.get("host") || "localhost:3000";
      const appBase = `${proto}://${host}`.replace(/\/$/, "");
      const { createScreenshotToken } = await import(
        "~/server/auth/screenshot-token"
      );
      const token = createScreenshotToken({
        userId: ctx.session?.user?.id as string,
        entityId: input.id,
        ttlMs: 3 * 60_000,
      });
      const targetW = 640;
      const targetH = 480;
      const pageUrl = `${appBase}/screenshot/documents/${encodeURIComponent(input.id)}?st=${encodeURIComponent(token)}&width=${targetW}&height=${targetH}`;

      let endpoint: string;
      {
        const base = (env.HEADLESS_RENDER_URL || "").replace(/\/$/, "");
        if (base) {
          endpoint = base.endsWith("/api/screenshot")
            ? base
            : `${base}/api/screenshot`;
        } else if (env.NODE_ENV !== "production") {
          // Dev fallback to the worker dev server
          endpoint = "http://localhost:4025/api/screenshot";
        } else {
          endpoint = `${proto}://${host}/api/screenshot`;
        }
      }

      const cookieHeader = undefined; // not used with token route

      async function shoot(theme: "light" | "dark"): Promise<Buffer> {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url: pageUrl,
            cookiesHeader: cookieHeader,
            selector: `[id^="lexical-content-"]`,
            viewport: { width: targetW, height: targetH, deviceScaleFactor: 2 },
            image: { type: "webp", quality: 92 },
            waitUntil: "networkidle2",
            timeoutMs: 20000,
            theme,
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Screenshot failed (${theme}): ${text}`,
          });
        }
        const arr = await res.arrayBuffer();
        return Buffer.from(arr);
      }

      const [lightBuf, darkBuf] = await Promise.all([
        shoot("light"),
        shoot("dark"),
      ]);

      const lightBlob = await put(`${input.id}-light.webp`, lightBuf, {
        access: "public",
        contentType: "image/webp",
        addRandomSuffix: true,
      });
      const darkBlob = await put(`${input.id}-dark.webp`, darkBuf, {
        access: "public",
        contentType: "image/webp",
        addRandomSuffix: true,
      });

      await ctx.drizzle
        .update(schema.entities)
        .set({
          screenShotLight: lightBlob.url,
          screenShotDark: darkBlob.url,
          updatedAt: new Date(),
        })
        .where(eq(schema.entities.id, input.id))
        .execute();

      return { light: lightBlob.url, dark: darkBlob.url };
    }),
  share: protectedProcedure
    .input(
      z.object({
        drawingId: z.string(),
        userEmail: z.string(),
        accessLevel: z.enum([AccessLevel.READ, AccessLevel.EDIT]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      console.log("share with input: ", input);

      const sharedWith = await ctx.drizzle
        .select()
        .from(schema.sharedEntities)
        // .where(eq(
        //   schema.sharedEntity.entityId, input.drawingId
        // ))
        .execute();
      console.log("sharedWith: ", sharedWith);

      // Ensure the current user is the owner of the drawing or has EDIT rights
      const entities = await ctx.drizzle
        .select({
          id: schema.entities.id,
        })
        .from(schema.entities)
        .where(
          and(
            eq(schema.entities.id, input.drawingId),
            or(
              // Owner
              eq(schema.entities.userId, ctx.session.user.id),
              // Editor
              and(
                eq(schema.sharedEntities.userId, ctx.session.user.id),
                eq(schema.sharedEntities.entityId, input.drawingId),
                eq(schema.sharedEntities.accessLevel, AccessLevel.EDIT),
              ),
            ),
          ),
        )
        .leftJoin(
          schema.sharedEntities,
          eq(schema.entities.id, schema.sharedEntities.entityId),
        )
        .execute();

      if (!entities[0]) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to share this drawing",
        });
      } else {
        console.log("found applicable entity", entities[0].id);
      }

      // Find the user by email
      const userToShareWith = await ctx.drizzle.query.users.findFirst({
        where: (user, { eq }) => eq(user.email, input.userEmail),
      });

      if (!userToShareWith) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Sorry that user doesn't exist",
        });
      } else {
        console.log("found user to share with: ", userToShareWith);
      }

      await ctx.drizzle
        .insert(schema.sharedEntities)
        .values({
          id: `${input.drawingId}-${userToShareWith.id}`,
          entityId: input.drawingId,
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

      return { success: true, message: "Drawing shared successfully" };
    }),
  changeAccessLevel: protectedProcedure
    .input(
      z.object({
        drawingId: z.string(),
        userId: z.string(),
        accessLevel: z.enum([AccessLevel.READ, AccessLevel.EDIT]),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      // Ensure the current user is the owner of the drawing or has EDIT rights
      const drawings = await ctx.drizzle
        .select({
          count: sql<number>`cast(count(${schema.entities.id}) as int)`,
        })
        .from(schema.entities)
        .leftJoin(schema.users, eq(schema.entities.userId, schema.users.id))
        .leftJoin(
          schema.sharedEntities,
          eq(schema.entities.id, schema.sharedEntities.entityId),
        )
        .where(
          and(
            or(
              eq(schema.entities.userId, ctx.session?.user.id as string),
              eq(schema.sharedEntities.userId, ctx.session?.user.id as string),
            ),
            isNull(schema.entities.deletedAt),
          ),
        )
        .groupBy(schema.entities.id)
        .having(({ count }) => eq(count, 1))
        .execute();

      if (!drawings[0]) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "You are not authorized to change access level of this drawing",
        });
      }

      await ctx.drizzle
        .update(schema.sharedEntities)
        .set({
          accessLevel: input.accessLevel,
        })
        .where(
          and(
            eq(schema.sharedEntities.entityId, input.drawingId),
            eq(schema.sharedEntities.userId, input.userId),
          ),
        )
        .execute();
      return { success: true, message: "Access level changed successfully" };
    }),
  unShare: protectedProcedure
    .input(z.object({ drawingId: z.string(), userId: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await ctx.drizzle
        .delete(schema.sharedEntities)
        .where(
          and(
            eq(schema.sharedEntities.entityId, input.drawingId),
            eq(schema.sharedEntities.userId, input.userId),
          ),
        )
        .execute();
      return { success: true, message: "Drawing unshared successfully" };
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
      const entity = (
        await ctx.drizzle
          .select({
            id: ctx.schema.entities.id,
            userId: ctx.schema.entities.userId,
            publicAccess: ctx.schema.entities.publicAccess,
          })
          .from(schema.entities)
          .where(eq(schema.entities.id, input.entityId))
      )[0];
      if (!entity)
        throw new TRPCError({ code: "NOT_FOUND", message: "Entity not found" });

      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEdit = entity.publicAccess === PublicAccess.EDIT;
      if (!isOwner && !anyOneCanEdit)
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Forbidden" });

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
      const entity = (
        await ctx.drizzle
          .select({
            id: ctx.schema.entities.id,
            userId: ctx.schema.entities.userId,
            publicAccess: ctx.schema.entities.publicAccess,
          })
          .from(schema.entities)
          .where(eq(schema.entities.id, input.entityId))
      )[0];
      if (!entity)
        throw new TRPCError({ code: "NOT_FOUND", message: "Entity not found" });

      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEdit = entity.publicAccess === PublicAccess.EDIT;
      if (!isOwner && !anyOneCanEdit)
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Forbidden" });

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
      // check user has access to entity
      const entity = (
        await ctx.drizzle
          .select({
            id: ctx.schema.entities.id,
            userId: ctx.schema.entities.userId,
            publicAccess: ctx.schema.entities.publicAccess,
            config: ctx.schema.users.config,
          })
          .from(schema.entities)
          .leftJoin(schema.users, eq(schema.entities.userId, schema.users.id))
          .where(eq(schema.entities.id, input.entityId))
      )[0];

      if (!entity) {
        console.error("entity not found");
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Entity not found",
        });
      }

      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEdit = entity.publicAccess === PublicAccess.EDIT;

      if (!isOwner && !anyOneCanEdit) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to edit this entity",
        });
      }

      const cookiesConfig = entity.config?.cookies;
      const host = new URL(url).host.replace("www.", "");
      const cookies = cookiesConfig?.find((cookie) => cookie.name === host);

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
      // check user has access to entity
      const entity = (
        await ctx.drizzle
          .select({
            id: ctx.schema.entities.id,
            userId: ctx.schema.entities.userId,
            publicAccess: ctx.schema.entities.publicAccess,
            status: schema.uploadedVideos.status,
            signedDownloadUrl: schema.uploadedVideos.signedDownloadUrl,
            errorMessage: schema.uploadedVideos.errorMessage,
          })
          .from(schema.entities)
          .leftJoin(
            schema.uploadedVideos,
            eq(schema.entities.id, schema.uploadedVideos.entityId),
          )
          .where(
            and(
              eq(schema.entities.id, input.entityId),
              eq(schema.uploadedVideos.requestId, input.requestId),
            ),
          )
      )[0];

      if (!entity) {
        console.error("entity not found");
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Drawing not found",
        });
      }

      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEdit = entity.publicAccess === PublicAccess.EDIT;

      if (!isOwner && !anyOneCanEdit) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You are not authorized to view this drawing",
        });
      }

      return entity;
    }),
  search: protectedProcedure
    .input(z.object({ query: z.string() }))
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

      return results;
    }),
  // searches for tags or content
  deepSearch: protectedProcedure
    .input(z.object({ query: z.string() }))
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
        })
        .from(schema.entities)
        .leftJoin(
          schema.sharedEntities,
          eq(schema.entities.id, schema.sharedEntities.entityId),
        )
        // Join with tags
        .leftJoin(
          schema.entityTags,
          eq(schema.entities.id, schema.entityTags.entityId),
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
        .limit(10);

      return results;
    }),
  /* --------------------------------------------------------------- */
  /* URL DISTILLATION                                                */
  /* --------------------------------------------------------------- */
  distillUrl: protectedProcedure
    .input(z.object({ id: z.string(), force: z.boolean().optional() }))
    .mutation(async ({ input, ctx }) => {
      // 1) Load entity and verify access
      const entity = (
        await ctx.drizzle
          .select({
            id: schema.entities.id,
            userId: schema.entities.userId,
            publicAccess: schema.entities.publicAccess,
            elements: schema.entities.elements,
            title: schema.entities.title,
            config: schema.users.config,
          })
          .from(schema.entities)
          .leftJoin(schema.users, eq(schema.entities.userId, schema.users.id))
          .where(eq(schema.entities.id, input.id))
      )[0];

      if (!entity)
        throw new TRPCError({ code: "NOT_FOUND", message: "Entity not found" });
      const isOwner = entity.userId === ctx.session?.user.id;
      const anyOneCanEdit = entity.publicAccess === PublicAccess.EDIT;
      if (!isOwner && !anyOneCanEdit)
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Forbidden" });

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
      let cookiesHeader: string | undefined;
      const host = new URL(url).host.replace("www.", "");
      const cookiesConfig = entity?.config?.cookies;
      const cookieForHost = cookiesConfig?.find(
        (cookie) => cookie.name === host,
      );
      if (cookieForHost?.value) cookiesHeader = cookieForHost.value;

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
            const key = `${input.id}-thumb.${ext}`;
            const blob = await put(key, buffer, {
              access: "public",
              contentType,
              allowOverwrite: true,
            });
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

      const updates: Record<string, unknown> = {
        elements: mergedElements,
        updatedAt: new Date(),
      };

      // If default title, set to distilled.title
      const isDefaultTitle = !entity?.title || entity.title === "New link";
      if (isDefaultTitle && distilled.title) {
        updates.title = distilled.title;
      }
      if (screenShotLight) updates.screenShotLight = screenShotLight;
      if (screenShotDark) updates.screenShotDark = screenShotDark;

      await ctx.drizzle
        .update(schema.entities)
        .set(updates)
        .where(eq(schema.entities.id, input.id))
        .execute();

      return distilled;
    }),
});
