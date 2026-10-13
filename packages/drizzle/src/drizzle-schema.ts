import { entities, entityTags, tags } from "./document-data-schema.js";
import { users } from "./users-data-schema.js";
export { entities, entityTags, tags, users };
export * from "./pro-schema.js";
import { createId } from "@paralleldrive/cuid2";
import { sql } from "drizzle-orm";
import {
  blob,
  check,
  index,
  integer,
  numeric,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
  unique,
} from "drizzle-orm/sqlite-core";
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
    // Named as Auth.js's adapter writes them, so the tokens it links land.
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
    refresh_token_expires_in: integer("refresh_token_expires_in"),
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

export type ApiTokenScope = "read" | "write";

// Personal access tokens: bearer credentials for agents and the CLI. Only the
// SHA-256 of the token is stored; the plaintext is shown once at creation.
export const apiTokens = sqliteTable(
  "ApiTokens",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("tokenHash").notNull(),
    scope: text("scope").$type<ApiTokenScope>().notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }),
    lastUsedAt: integer("lastUsedAt", { mode: "timestamp_ms" }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    revokedAt: integer("revokedAt", { mode: "timestamp_ms" }),
  },
  (table) => [
    uniqueIndex("ApiToken_tokenHash_unique").on(table.tokenHash),
    index("ApiToken_userId_idx").on(table.userId),
  ],
);

/**
 * A one-time code a native app trades for a personal access token. Only the
 * SHA-256 of the code is stored.
 */
export const nativeSignInCodes = sqliteTable(
  "NativeSignInCodes",
  {
    codeHash: text("codeHash").primaryKey().notNull(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    codeChallenge: text("codeChallenge").notNull(),
    redirectUri: text("redirectUri").notNull(),
    deviceName: text("deviceName").notNull(),
    expiresAt: integer("expiresAt", { mode: "timestamp_ms" }).notNull(),
    usedAt: integer("usedAt", { mode: "timestamp_ms" }),
    tokenId: text("tokenId"),
  },
  (table) => [index("NativeSignInCode_expiresAt_idx").on(table.expiresAt)],
);

// Credential sign-in attempts per fixed window. The key is the SHA-256 of
// `email:<address>` or `ip:<address>`, so no email or IP is stored.
export const signInAttempts = sqliteTable(
  "SignInAttempts",
  {
    key: text("key").primaryKey().notNull(),
    windowStart: integer("windowStart", { mode: "timestamp_ms" }).notNull(),
    count: integer("count").notNull(),
  },
  (table) => [index("SignInAttempt_windowStart_idx").on(table.windowStart)],
);

/**
 * Who is in an entity's live-editing room, and whether they may edit. A row
 * exists while its peer's signal stream keeps `lastSeen` fresh; its insert and
 * its delete are what the room hears as `join` and `leave`.
 */
export const roomPeers = sqliteTable(
  "RoomPeers",
  {
    entityId: text("entityId")
      .notNull()
      .references(() => entities.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    peer: text("peer").notNull(),
    canEdit: integer("canEdit", { mode: "boolean" }).notNull(),
    lastSeen: integer("lastSeen", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.entityId, table.peer] }),
    index("RoomPeer_lastSeen_idx").on(table.lastSeen),
  ],
);

/**
 * The messages peers exchange to open WebRTC connections to each other, in
 * the order the room heard them. `toPeer` is null for `join` and `leave`,
 * which everyone else in the room hears. `canEdit` is the sender's, as the app
 * found it, never what the sender claimed.
 */
export const roomSignals = sqliteTable(
  "RoomSignals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
    entityId: text("entityId")
      .notNull()
      .references(() => entities.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    fromPeer: text("fromPeer").notNull(),
    toPeer: text("toPeer"),
    type: text("type")
      .$type<"join" | "leave" | "offer" | "answer" | "iceCandidate">()
      .notNull(),
    payload: text("payload"),
    canEdit: integer("canEdit", { mode: "boolean" }).notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [
    index("RoomSignal_entityId_id_idx").on(table.entityId, table.id),
    index("RoomSignal_createdAt_idx").on(table.createdAt),
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
    signedUploadUrl: text("signedUploadUrl").notNull().default(""),
    signedDownloadUrl: text("signedDownloadUrl").notNull(),
    kind: text("kind").notNull().default("attachment"),
    status: text("status").$type<"UPLOADED" | "PROCESSING" | "FAILED" | null>(),
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
    requestId: text("requestId").unique(),
    signedUploadUrl: text("signedUploadUrl").notNull().default(""),
    signedDownloadUrl: text("signedDownloadUrl").notNull(),
    status: text("status").$type<
      "UPLOADED" | "DOWNLOADING" | "UPLOADING" | "FAILED" | null
    >(),
    errorMessage: text("errorMessage"),
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

// TTS document generation jobs (durable status for polling)
export const ttsJobs = sqliteTable(
  "TtsJobs",
  {
    id: text("id").primaryKey().notNull(), // docKey or articleKey
    entityId: text("entityId")
      .notNull()
      .references(() => entities.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    status: text("status")
      .$type<"queued" | "processing" | "ready" | "error" | "cancelled">()
      .notNull(),
    manifestUrl: text("manifestUrl"),
    stitchedUrl: text("stitchedUrl"),
    segmentCount: integer("segmentCount"),
    plannedCount: integer("plannedCount"),
    error: text("error"),
    /**
     * The run making the audio. A run that finds another here, or its job
     * cancelled or gone, stops rather than pay for audio no one waits for.
     */
    runId: text("runId"),
    ttsConfig: text("ttsConfig", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index("TtsJobs_entityId_idx").on(table.entityId),
    index("TtsJobs_status_idx").on(table.status),
  ],
);

// Durable thumbnail generation jobs
export const thumbnailJobs = sqliteTable(
  "ThumbnailJobs",
  {
    id: text("id").primaryKey().notNull(),
    entityId: text("entityId")
      .notNull()
      .references(() => entities.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    version: text("version").notNull(),
    status: text("status")
      .$type<"pending" | "processing" | "done" | "error" | "stale">()
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextRunAt: integer("nextRunAt", { mode: "timestamp_ms" }),
    lastError: text("lastError"),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("ThumbnailJobs_entity_version_key").on(
      table.entityId,
      table.version,
    ),
    index("ThumbnailJobs_status_nextRunAt_idx").on(
      table.status,
      table.nextRunAt,
    ),
  ],
);

// Per-user preferences for entities (favorite/archive timestamps)
export const userEntityPrefs = sqliteTable(
  "UserEntityPrefs",
  {
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    entityId: text("entityId")
      .notNull()
      .references(() => entities.id, {
        onDelete: "cascade",
        onUpdate: "cascade",
      }),
    favoritedAt: integer("favoritedAt", { mode: "timestamp_ms" }),
    archivedAt: integer("archivedAt", { mode: "timestamp_ms" }),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex("UserEntityPrefs_user_entity_unique").on(
      table.userId,
      table.entityId,
    ),
    index("UserEntityPrefs_userId_idx").on(table.userId),
    index("UserEntityPrefs_entityId_idx").on(table.entityId),
  ],
);

// LLM Audit events
export const llmAuditEvents = sqliteTable(
  "LLMAuditEvents",
  {
    id: text("id")
      .primaryKey()
      .notNull()
      .$defaultFn(() => createId()),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    requestId: text("requestId").notNull(),
    userId: text("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    entityId: text("entityId").references(() => entities.id, {
      onDelete: "cascade",
      onUpdate: "cascade",
    }),
    mode: text("mode").notNull(), // 'chat' | 'agent' | 'autocomplete'
    route: text("route").notNull(),
    provider: text("provider").notNull(),
    modelId: text("modelId").notNull(),
    temperature: real("temperature").notNull(),
    maxOutputTokens: integer("maxOutputTokens").notNull(),
    promptTokens: integer("promptTokens"),
    completionTokens: integer("completionTokens"),
    totalTokens: integer("totalTokens"),
    latencyMs: integer("latencyMs").notNull(),
    stream: integer("stream").notNull(), // 0/1
    toolCalls: text("toolCalls", { mode: "json" }).$type<
      { name: string; count: number }[] | null
    >(),
    promptLen: integer("promptLen"),
    messagesCount: integer("messagesCount"),
    errorCode: text("errorCode"),
    errorMessage: text("errorMessage"),
    httpStatus: integer("httpStatus"),
  },
  (table) => [
    index("LLMAudit_user_createdAt_idx").on(table.userId, table.createdAt),
    index("LLMAudit_entity_createdAt_idx").on(table.entityId, table.createdAt),
    index("LLMAudit_mode_createdAt_idx").on(table.mode, table.createdAt),
    index("LLMAudit_route_createdAt_idx").on(table.route, table.createdAt),
  ],
);

// Admin audit events for sensitive admin actions
export const adminAuditEvents = sqliteTable(
  "AdminAuditEvents",
  {
    id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    adminUserId: text("adminUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade", onUpdate: "cascade" }),
    action: text("action").notNull(),
    targetType: text("targetType").notNull(),
    targetId: text("targetId").notNull(),
    data: text("data", { mode: "json" }).$type<unknown | null>(),
  },
  (table) => [
    index("AdminAuditEvents_createdAt_idx").on(table.createdAt),
    index("AdminAuditEvents_target_idx").on(table.targetType, table.targetId),
  ],
);

// LLM Policies (one row per mode)
export const llmPolicies = sqliteTable(
  "LLMPolicies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
    mode: text("mode").notNull(), // 'chat' | 'agent' | 'autocomplete'
    provider: text("provider").notNull(),
    modelId: text("modelId").notNull(),
    temperature: real("temperature").notNull(),
    maxOutputTokens: integer("maxOutputTokens").notNull(),
    allowedModels: text("allowedModels", { mode: "json" })
      .$type<{ provider: string; modelId: string }[]>()
      .notNull(),
    enforcedCaps: text("enforcedCaps", { mode: "json" })
      .$type<{
        maxOutputTokensByProvider: {
          openai: number;
          google: number;
          openrouter?: number;
        };
      }>()
      .notNull(),
    extraConfig: text("extraConfig", { mode: "json" }).$type<
      Record<string, unknown>
    >(),
    createdAt: integer("createdAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updatedAt", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex("LLMPolicies_mode_unique").on(table.mode)],
);
export * from "./device-agent-schema.js";

export * from "./billing-schema.js";

// Keep this schema aligned with the capture contract's exact, additive archive DDL.
export const legacyDocumentRetentionV1 = sqliteTable(
  "LegacyDocumentRetentionV1",
  {
    sourceSetId: text("sourceSetId").notNull(),
    sourceTable: text("sourceTable").notNull(),
    sourceId: blob("sourceId", { mode: "buffer" }).notNull(),
    sourceDDL: blob("sourceDDL", { mode: "buffer" }).notNull(),
    sourceColumns: blob("sourceColumns", { mode: "buffer" }).notNull(),
    sourceValues: blob("sourceValues", { mode: "buffer" }).notNull(),
    mappedEntityId: text("mappedEntityId"),
    contractVersion: integer("contractVersion").notNull(),
    status: text("status", { enum: ["retained", "converted"] }).notNull(),
    derivedFields: blob("derivedFields", { mode: "buffer" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.sourceSetId, table.sourceTable, table.sourceId] }),
    check("LegacyDocumentRetentionV1_contractVersion", sql`contractVersion = 1`),
    check("LegacyDocumentRetentionV1_status", sql`status IN ('retained','converted')`),
  ],
);

export const legacyDocumentRetentionBatchV1 = sqliteTable(
  "LegacyDocumentRetentionBatchV1",
  {
    sourceSetId: text("sourceSetId").primaryKey().notNull(),
    sourceIdentity: text("sourceIdentity").notNull(),
    provenance: text("provenance").notNull(),
    documentCount: integer("documentCount").notNull(),
    sharedDocumentCount: integer("sharedDocumentCount").notNull(),
  },
  (table) => [unique("LegacyDocumentRetentionBatchV1_sourceIdentity_unique").on(table.sourceIdentity)],
);

export type LegacyDocumentRetentionV1 = typeof legacyDocumentRetentionV1.$inferSelect;
export type NewLegacyDocumentRetentionV1 = typeof legacyDocumentRetentionV1.$inferInsert;
export type LegacyDocumentRetentionBatchV1 = typeof legacyDocumentRetentionBatchV1.$inferSelect;
export type NewLegacyDocumentRetentionBatchV1 = typeof legacyDocumentRetentionBatchV1.$inferInsert;

export const legacyDocumentConversionV1 = sqliteTable(
  "LegacyDocumentConversionV1",
  {
    sourceSetId: text("sourceSetId").primaryKey().notNull(),
    sourceIdentity: text("sourceIdentity").notNull(),
    contractVersion: integer("contractVersion").notNull(),
    status: text("status", { enum: ["converted"] }).notNull(),
    derivedFields: blob("derivedFields", { mode: "buffer" }).notNull(),
    destinationValues: blob("destinationValues", { mode: "buffer" }).notNull(),
  },
  (table) => [
    unique("LegacyDocumentConversionV1_sourceIdentity_unique").on(
      table.sourceIdentity,
    ),
    check(
      "LegacyDocumentConversionV1_contractVersion",
      sql`contractVersion = 1`,
    ),
    check("LegacyDocumentConversionV1_status", sql`status = 'converted'`),
  ],
);

export type LegacyDocumentConversionV1 =
  typeof legacyDocumentConversionV1.$inferSelect;
export type NewLegacyDocumentConversionV1 =
  typeof legacyDocumentConversionV1.$inferInsert;
