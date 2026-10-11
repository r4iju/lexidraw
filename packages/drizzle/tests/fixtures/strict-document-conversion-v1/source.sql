-- Minimal synthetic parent; the four legacy tables and their indexes below are cached original0001 SQL.
CREATE TABLE `User` (`id` text PRIMARY KEY NOT NULL);
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
CREATE INDEX `Document_userId_idx` ON `Document` (`userId`);--> statement-breakpoint
CREATE INDEX `Drawing_userId_idx` ON `Drawing` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `SharedDocument_documentId_userId_key` ON `SharedDocument` (`documentId`,`userId`);--> statement-breakpoint
CREATE INDEX `SharedDocument_userId_idx` ON `SharedDocument` (`userId`);--> statement-breakpoint
CREATE INDEX `SharedDocument_documentId_idx` ON `SharedDocument` (`documentId`);--> statement-breakpoint
CREATE UNIQUE INDEX `SharedDrawing_drawingId_userId_key` ON `SharedDrawing` (`drawingId`,`userId`);--> statement-breakpoint
CREATE INDEX `SharedDrawing_userId_idx` ON `SharedDrawing` (`userId`);--> statement-breakpoint
CREATE INDEX `SharedDrawing_drawingId_idx` ON `SharedDrawing` (`drawingId`);--> statement-breakpoint
