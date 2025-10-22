CREATE TABLE `ThumbnailJobs` (
	`id` text PRIMARY KEY NOT NULL,
	`entityId` text NOT NULL,
	`version` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`nextRunAt` integer,
	`lastError` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`entityId`) REFERENCES `Entities`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ThumbnailJobs_entity_version_key` ON `ThumbnailJobs` (`entityId`,`version`);--> statement-breakpoint
CREATE INDEX `ThumbnailJobs_status_nextRunAt_idx` ON `ThumbnailJobs` (`status`,`nextRunAt`);--> statement-breakpoint
CREATE TABLE `UserEntityPrefs` (
	`userId` text NOT NULL,
	`entityId` text NOT NULL,
	`favoritedAt` integer,
	`archivedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`entityId`) REFERENCES `Entities`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UserEntityPrefs_user_entity_unique` ON `UserEntityPrefs` (`userId`,`entityId`);--> statement-breakpoint
CREATE INDEX `UserEntityPrefs_userId_idx` ON `UserEntityPrefs` (`userId`);--> statement-breakpoint
CREATE INDEX `UserEntityPrefs_entityId_idx` ON `UserEntityPrefs` (`entityId`);--> statement-breakpoint
ALTER TABLE `Entities` ADD `thumbnailStatus` text DEFAULT 'pending';--> statement-breakpoint
ALTER TABLE `Entities` ADD `thumbnailUpdatedAt` integer;--> statement-breakpoint
ALTER TABLE `Entities` ADD `thumbnailVersion` text;