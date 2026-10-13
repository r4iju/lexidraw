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
CREATE INDEX `Document_userId_idx` ON `Document` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `SharedDocument_documentId_userId_key` ON `SharedDocument` (`documentId`,`userId`);--> statement-breakpoint
CREATE INDEX `SharedDocument_userId_idx` ON `SharedDocument` (`userId`);--> statement-breakpoint
CREATE INDEX `SharedDocument_documentId_idx` ON `SharedDocument` (`documentId`);
CREATE TABLE TtsJobs (
 id text PRIMARY KEY NOT NULL, documentId text NOT NULL, userId text NOT NULL,
 status text NOT NULL, manifestUrl text, stitchedUrl text, segmentCount integer,
 error text, ttsConfig text, createdAt integer NOT NULL, updatedAt integer NOT NULL,
 plannedCount integer,
 FOREIGN KEY (documentId) REFERENCES Entities(id) ON UPDATE cascade ON DELETE cascade,
 FOREIGN KEY (userId) REFERENCES Users(id) ON UPDATE cascade ON DELETE cascade
);
CREATE INDEX TtsJobs_documentId_idx ON TtsJobs(documentId);
CREATE INDEX TtsJobs_status_idx ON TtsJobs(status);