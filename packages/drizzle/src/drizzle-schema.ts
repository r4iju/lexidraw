import {
  sqliteTable,
  text,
  numeric,
  uniqueIndex,
  integer,
  index,
  real,
  AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import type { PublicAccess } from "@packages/types";
export const accounts = sqliteTable(
  "Accounts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("providerAccountId").notNull(),
    refreshToken: text("refresh_token"),
    accessToken: text("access_token"),
    expiresAt: integer("expires_at"),
    tokenType: text("token_type"),
    scope: text("scope"),
    idToken: text("id_token"),
    sessionState: text("session_state"),
    refreshTokenExpiresIn: integer("refresh_token_expires_in"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`1735950685000`)
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`1735950685000`)
      .$defaultFn(() => new Date()),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("Account_provider_providerAccountId_key").on(
      table.provider,
      table.providerAccountId,
    ),
  ],
);

export const sessions = sqliteTable(
  "Sessions",
  {
    id: text("id").primaryKey().notNull(),
    sessionToken: text("sessionToken").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    expires: numeric("expires").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => [uniqueIndex("Session_sessionToken_key").on(table.sessionToken)],
);

export const users = sqliteTable(
  "Users",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    name: text("name").notNull(),
    config: text("config", { mode: "json" }).$type<{
      llm?: {
        googleApiKey?: string;
        openaiApiKey?: string;
        chat?: {
          modelId: string;
          provider: string;
          temperature: number;
          maxTokens: number;
        };
        autocomplete?: {
          modelId: string;
          provider: string;
          temperature: number;
          maxTokens: number;
        };
      };
    }>(),
    email: text("email"),
    password: text("password"),
    emailVerified: numeric("emailVerified"),
    image: text("image"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`1735950685000`)
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`1735950685000`)
      .$defaultFn(() => new Date()),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => [uniqueIndex("User_email_key").on(table.email)],
);

export const roles = sqliteTable(
  "Roles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
    name: text("name").notNull().unique(), // e.g., 'admin', 'user'
    description: text("description"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => [uniqueIndex("Roles_name_unique").on(table.name)],
);

export const permissions = sqliteTable(
  "Permissions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
    name: text("name").notNull().unique(), // e.g., 'create_post', 'delete_user'
    description: text("description"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => [uniqueIndex("Permissions_name_unique").on(table.name)],
);

export const rolePermissions = sqliteTable("RolePermissions", {
  id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
  roleId: integer("roleId")
    .references(() => roles.id)
    .notNull(),
  permissionId: integer("permissionId")
    .references(() => permissions.id)
    .notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
});

export const userRoles = sqliteTable("UserRoles", {
  id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
  userId: text("userId")
    .references(() => users.id)
    .notNull(),
  roleId: integer("roleId")
    .references(() => roles.id)
    .notNull(),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
    .notNull()
    .$defaultFn(() => new Date()),
  deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
});

export const verificationTokens = sqliteTable(
  "VerificationTokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: numeric("expires").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    // hard delete
  },
  (table) => [
    uniqueIndex("VerificationToken_identifier_token_key").on(
      table.identifier,
      table.token,
    ),
    uniqueIndex("VerificationToken_token_key").on(table.token),
  ],
);

export const analytics = sqliteTable(
  "Analytics",
  {
    id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
    timestamp: integer("timestamp", { mode: "timestamp_ms" }).notNull(),
    visitorId: text("visitorId").notNull(),
    pageVisited: text("pageVisited").notNull(),
    userAgent: text("userAgent").notNull(),
    ipAddress: text("ipAddress").notNull(),
    country: text("country").notNull(),
    city: text("city").notNull(),
    region: text("region").notNull(),
    referer: text("referer").default("Direct/Bookmark"),
    // hard delete
  },
  (table) => [index("Analytics_visitorId_idx").on(table.visitorId)],
);

export const cityCoordinates = sqliteTable(
  "CityCoordinates",
  {
    id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
    city: text("city").notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    // hard delete
  },
  (table) => [
    uniqueIndex("CityCoordinates_city_key").on(table.city),
    index("CityCoordinates_city_idx").on(table.city),
  ],
);

export const entities = sqliteTable(
  "Entities",
  {
    id: text("id").primaryKey().notNull(),
    title: text("title").notNull(),
    elements: text("elements").notNull(),
    appState: text("appState"),
    entityType: text("entityType").notNull().default("drawing"), // drawing or document or directory
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
  },
  (table) => [
    index("Entity_userId_idx").on(table.userId),
    index("Entity_parentId_idx").on(table.parentId),
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

export const sharedEntities = sqliteTable(
  "SharedEntities",
  {
    id: text("id").primaryKey().notNull(),
    entityId: text("entityId")
      .notNull()
      .references(() => entities.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    accessLevel: text("accessLevel").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`1735950685000`)
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`1735950685000`)
      .$defaultFn(() => new Date()),
    // hard delete
  },
  (table) => [
    uniqueIndex("SharedEntity_entityId_userId_key").on(
      table.entityId,
      table.userId,
    ),
    index("SharedEntity_userId_idx").on(table.userId),
    index("SharedEntity_entityId_idx").on(table.entityId),
  ],
);

export const webRtcOffers = sqliteTable(
  "WebRTCOffers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
    offer: text("offer").notNull(),
    entityId: text("entityId")
      .notNull()
      .references(() => entities.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    createdBy: text("createdBy").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    // hard delete
  },
  (table) => [
    index("WebRTCOffer_createdBy_idx").on(table.createdBy),
    index("WebRTCOffer_entityId_idx").on(table.entityId),
  ],
);

export const webRtcAnswers = sqliteTable(
  "WebRTCAnswers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
    answer: text("answer").notNull(),
    entityId: text("entityId")
      .notNull()
      .references(() => entities.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    createdBy: text("createdBy").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    // hard delete
  },
  (table) => [
    index("WebRTCAnswer_createdBy_idx").on(table.createdBy),
    index("WebRTCAnswer_entityId_idx").on(table.entityId),
  ],
);

export const uploadedImages = sqliteTable(
  "UploadedImages",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    entityId: text("entityId")
      .notNull()
      .references(() => entities.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    fileName: text("fileName").notNull(),
    signedUploadUrl: text("fileUrl").notNull(),
    signedDownloadUrl: text("fileUrl").notNull(),
    // enum ["thumbnail", "attachment"]
    kind: text("kind").notNull().default("attachment"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => [index("UploadedImage_userId_idx").on(table.userId)],
);

export const uploadedVideos = sqliteTable(
  "UploadedVideos",
  {
    id: text("id").primaryKey().notNull(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    entityId: text("entityId")
      .notNull()
      .references(() => entities.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    fileName: text("fileName").notNull(),
    signedUploadUrl: text("fileUrl").notNull(),
    signedDownloadUrl: text("fileUrl").notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    deletedAt: integer("deletedAt", { mode: "timestamp_ms" }),
  },
  (table) => [index("UploadedVideo_userId_idx").on(table.userId)],
);
