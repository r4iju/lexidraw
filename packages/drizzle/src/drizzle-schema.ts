import { sqliteTable, AnySQLiteColumn, text, numeric, uniqueIndex, foreignKey, integer, index, real } from "drizzle-orm/sqlite-core"
import { createId } from '@paralleldrive/cuid2';
import { sql } from "drizzle-orm"

export const prismaMigrations = sqliteTable("_prisma_migrations", {
	id: text("id").primaryKey().notNull(),
	checksum: text("checksum").notNull(),
	finishedAt: numeric("finished_at"),
	migrationName: text("migration_name").notNull(),
	logs: text("logs"),
	rolledBackAt: numeric("rolled_back_at"),
	startedAt: numeric("started_at").default(sql`(current_timestamp)`).notNull(),
	appliedStepsCount: numeric("applied_steps_count").notNull(),
});

export const account = sqliteTable("Account", {
	id: integer('id').primaryKey({ autoIncrement: true }).notNull(),
	userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade", onUpdate: "cascade" }),
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
},
	(table) => {
		return {
			providerProviderAccountIdKey: uniqueIndex("Account_provider_providerAccountId_key").on(table.provider, table.providerAccountId),
		}
	});

export const session = sqliteTable("Session", {
	id: text('id').primaryKey().notNull(),
	sessionToken: text("sessionToken").notNull(),
	userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade", onUpdate: "cascade" }),
	expires: numeric("expires").notNull(),
},
	(table) => {
		return {
			sessionTokenKey: uniqueIndex("Session_sessionToken_key").on(table.sessionToken),
		}
	});

export const user = sqliteTable("User", {
	id: text('id')
		.primaryKey()
		.notNull()
		.$defaultFn(() => createId()),
	name: text("name").notNull(),
	email: text("email"),
	password: text("password"),
	emailVerified: numeric("emailVerified"),
	image: text("image"),
},
	(table) => {
		return {
			emailKey: uniqueIndex("User_email_key").on(table.email),
		}
	});

export const verificationToken = sqliteTable("VerificationToken", {
	identifier: text("identifier").notNull(),
	token: text("token").notNull(),
	expires: numeric("expires").notNull(),
},
	(table) => {
		return {
			identifierTokenKey: uniqueIndex("VerificationToken_identifier_token_key").on(table.identifier, table.token),
			tokenKey: uniqueIndex("VerificationToken_token_key").on(table.token),
		}
	});

export const analytics = sqliteTable("Analytics", {
	id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
	timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
	visitorId: text("visitorId").notNull(),
	pageVisited: text("pageVisited").notNull(),
	userAgent: text("userAgent").notNull(),
	ipAddress: text("ipAddress").notNull(),
	country: text("country").notNull(),
	city: text("city").notNull(),
	region: text("region").notNull(),
	referer: text("referer").default("Direct/Bookmark"),
},
	(table) => {
		return {
			visitorIdIdx: index("Analytics_visitorId_idx").on(table.visitorId),
		}
	});

export const cityCoordinates = sqliteTable("CityCoordinates", {
	id: integer("id").primaryKey({ autoIncrement: true }).notNull(),
	city: text("city").notNull(),
	latitude: real("latitude").notNull(),
	longitude: real("longitude").notNull(),
},
	(table) => {
		return {
			cityKey: uniqueIndex("CityCoordinates_city_key").on(table.city),
			cityIdx: index("CityCoordinates_city_idx").on(table.city),
		}
	});

export const drawing = sqliteTable("Drawing", {
	id: text("id").primaryKey().notNull(),
	title: text("title").notNull(),
	elements: text("elements").notNull(),
	appState: text("appState"),
	createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
	deletedAt: integer('deletedAt', { mode: 'timestamp_ms' }),
	userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade", onUpdate: "cascade" }),
	publicAccess: text("publicAccess").notNull(),
},
	(table) => {
		return {
			userIdIdx: index("Drawing_userId_idx").on(table.userId),
		}
	});

export const sharedDrawing = sqliteTable("SharedDrawing", {
	id: text("id").primaryKey().notNull(),
	drawingId: text("drawingId").notNull().references(() => drawing.id, { onDelete: "cascade", onUpdate: "cascade" }),
	userId: text("userId").notNull().references(() => user.id, { onDelete: "cascade", onUpdate: "cascade" }),
	accessLevel: text("accessLevel").notNull(),
	createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
},
	(table) => {
		return {
			drawingIdUserIdKey: uniqueIndex("SharedDrawing_drawingId_userId_key").on(table.drawingId, table.userId),
			userIdIdx: index("SharedDrawing_userId_idx").on(table.userId),
			drawingIdIdx: index("SharedDrawing_drawingId_idx").on(table.drawingId),
		}
	});

export const webRtcOffer = sqliteTable("WebRTCOffer", {
	id: integer('id').primaryKey({ autoIncrement: true }).notNull(),
	offer: text("offer").notNull(),
	drawingId: text("drawingId").notNull().references(() => drawing.id, { onDelete: "cascade", onUpdate: "cascade" }),
	createdBy: text("createdBy").notNull(),
	createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
},
	(table) => {
		return {
			createdByIdx: index("WebRTCOffer_createdBy_idx").on(table.createdBy),
			drawingIdIdx: index("WebRTCOffer_drawingId_idx").on(table.drawingId),
		}
	});

export const webRtcAnswer = sqliteTable("WebRTCAnswer", {
	id: integer('id').primaryKey({ autoIncrement: true }).notNull(),
	answer: text("answer").notNull(),
	drawingId: text("drawingId").notNull().references(() => drawing.id, { onDelete: "cascade", onUpdate: "cascade" }),
	createdBy: text("createdBy").notNull(),
	createdAt: integer('createdAt', { mode: 'timestamp_ms' }).notNull(),
	updatedAt: integer('updatedAt', { mode: 'timestamp_ms' }).notNull(),
},
	(table) => {
		return {
			createdByIdx: index("WebRTCAnswer_createdBy_idx").on(table.createdBy),
			drawingIdIdx: index("WebRTCAnswer_drawingId_idx").on(table.drawingId),
		}
	});