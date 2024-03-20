CREATE TABLE `Account` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`providerAccountId` text NOT NULL,
	`refresh_token` text,
	`access_token` text,
	`expires_at` integer,
	`token_type` text,
	`scope` text,
	`id_token` text,
	`session_state` text,
	`refresh_token_expires_in` integer,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `Analytics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer NOT NULL,
	`visitorId` text NOT NULL,
	`pageVisited` text NOT NULL,
	`userAgent` text NOT NULL,
	`ipAddress` text NOT NULL,
	`country` text NOT NULL,
	`city` text NOT NULL,
	`region` text NOT NULL,
	`referer` text DEFAULT 'Direct/Bookmark'
);
--> statement-breakpoint
CREATE TABLE `CityCoordinates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`city` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL
);
--> statement-breakpoint
CREATE TABLE `Document` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`elements` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	`userId` text NOT NULL,
	`publicAccess` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `Drawing` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`elements` text NOT NULL,
	`appState` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	`userId` text NOT NULL,
	`publicAccess` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `_prisma_migrations` (
	`id` text PRIMARY KEY NOT NULL,
	`checksum` text NOT NULL,
	`finished_at` numeric,
	`migration_name` text NOT NULL,
	`logs` text,
	`rolled_back_at` numeric,
	`started_at` numeric DEFAULT (current_timestamp) NOT NULL,
	`applied_steps_count` numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE `Session` (
	`id` text PRIMARY KEY NOT NULL,
	`sessionToken` text NOT NULL,
	`userId` text NOT NULL,
	`expires` numeric NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `SharedDocument` (
	`id` text PRIMARY KEY NOT NULL,
	`documentId` text NOT NULL,
	`userId` text NOT NULL,
	`accessLevel` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`documentId`) REFERENCES `Document`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `SharedDrawing` (
	`id` text PRIMARY KEY NOT NULL,
	`drawingId` text NOT NULL,
	`userId` text NOT NULL,
	`accessLevel` text NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`drawingId`) REFERENCES `Drawing`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `User` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text,
	`password` text,
	`emailVerified` numeric,
	`image` text
);
--> statement-breakpoint
CREATE TABLE `VerificationToken` (
	`identifier` text NOT NULL,
	`token` text NOT NULL,
	`expires` numeric NOT NULL
);
--> statement-breakpoint
CREATE TABLE `WebRTCAnswer` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`answer` text NOT NULL,
	`drawingId` text NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`drawingId`) REFERENCES `Drawing`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `WebRTCOffer` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`offer` text NOT NULL,
	`drawingId` text NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`drawingId`) REFERENCES `Drawing`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Account_provider_providerAccountId_key` ON `Account` (`provider`,`providerAccountId`);--> statement-breakpoint
CREATE INDEX `Analytics_visitorId_idx` ON `Analytics` (`visitorId`);--> statement-breakpoint
CREATE UNIQUE INDEX `CityCoordinates_city_key` ON `CityCoordinates` (`city`);--> statement-breakpoint
CREATE INDEX `CityCoordinates_city_idx` ON `CityCoordinates` (`city`);--> statement-breakpoint
CREATE INDEX `Document_userId_idx` ON `Document` (`userId`);--> statement-breakpoint
CREATE INDEX `Drawing_userId_idx` ON `Drawing` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `Session_sessionToken_key` ON `Session` (`sessionToken`);--> statement-breakpoint
CREATE UNIQUE INDEX `SharedDocument_documentId_userId_key` ON `SharedDocument` (`documentId`,`userId`);--> statement-breakpoint
CREATE INDEX `SharedDocument_userId_idx` ON `SharedDocument` (`userId`);--> statement-breakpoint
CREATE INDEX `SharedDocument_documentId_idx` ON `SharedDocument` (`documentId`);--> statement-breakpoint
CREATE UNIQUE INDEX `SharedDrawing_drawingId_userId_key` ON `SharedDrawing` (`drawingId`,`userId`);--> statement-breakpoint
CREATE INDEX `SharedDrawing_userId_idx` ON `SharedDrawing` (`userId`);--> statement-breakpoint
CREATE INDEX `SharedDrawing_drawingId_idx` ON `SharedDrawing` (`drawingId`);--> statement-breakpoint
CREATE UNIQUE INDEX `User_email_key` ON `User` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `VerificationToken_identifier_token_key` ON `VerificationToken` (`identifier`,`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `VerificationToken_token_key` ON `VerificationToken` (`token`);--> statement-breakpoint
CREATE INDEX `WebRTCAnswer_createdBy_idx` ON `WebRTCAnswer` (`createdBy`);--> statement-breakpoint
CREATE INDEX `WebRTCAnswer_drawingId_idx` ON `WebRTCAnswer` (`drawingId`);--> statement-breakpoint
CREATE INDEX `WebRTCOffer_createdBy_idx` ON `WebRTCOffer` (`createdBy`);--> statement-breakpoint
CREATE INDEX `WebRTCOffer_drawingId_idx` ON `WebRTCOffer` (`drawingId`);