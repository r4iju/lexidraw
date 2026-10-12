import type { PublicAccess } from "@packages/types";
import { sql } from "drizzle-orm";
import {
  type AnySQLiteColumn,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { users } from "./users-data-schema.js";

export const entities = sqliteTable(
  "Entities",
  {
    id: text("id").primaryKey().notNull(),
    title: text("title").notNull(),
    elements: text("elements").notNull(),
    appState: text("appState"),
    entityType: text("entityType").notNull().default("drawing"), // drawing | document | directory | url
    parentId: text("parentId").references((): AnySQLiteColumn => entities.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }), // null for root
    screenShotLight: text("screenShotLight").default("").notNull(),
    screenShotDark: text("screenShotDark").default("").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    publicAccess: text("publicAccess").$type<PublicAccess>().notNull(),
    isActive: integer("isActive").notNull().default(1),
    // thumbnail generation state
    thumbnailStatus: text("thumbnailStatus")
      .$type<"pending" | "ready" | "error">()
      .default("pending"),
    thumbnailUpdatedAt: integer("thumbnailUpdatedAt", { mode: "timestamp_ms" }),
    thumbnailVersion: text("thumbnailVersion"),
  },
  (table) => [
    index("Entity_userId_idx").on(table.userId),
    index("Entity_parentId_idx").on(table.parentId),
    index("Entity_title_idx").on(table.title),
    index("Entity_createdAt_idx").on(table.createdAt),
    uniqueIndex("Entity_unique_directory_name")
      .on(table.title, table.parentId)
      .where(sql`entityType = 'directory'`),
  ],
);

export const tags = sqliteTable(
  "Tags",
  {
    id: text("id").primaryKey().notNull(),
    name: text("name").notNull().unique(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("Tag_name_unique").on(table.name)],
);

export const entityTags = sqliteTable(
  "EntityTags",
  {
    entityId: text("entityId")
      .notNull()
      .references(() => entities.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    tagId: text("tagId")
      .notNull()
      .references(() => tags.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("userId") // Move userId to the junction table
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("EntityTag_entityId_tagId_userId_key").on(
      table.entityId,
      table.tagId,
      table.userId,
    ),
  ],
);
