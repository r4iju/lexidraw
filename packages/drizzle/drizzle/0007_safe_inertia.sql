CREATE TABLE `UploadedVideos` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`entityId` text NOT NULL,
	`fileName` text NOT NULL,
	`fileUrl` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`entityId`) REFERENCES `Entities`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `UploadedVideo_userId_idx` ON `UploadedVideos` (`userId`);--> statement-breakpoint
ALTER TABLE `EntityTags` DROP COLUMN `deletedAt`;--> statement-breakpoint
ALTER TABLE `Tags` DROP COLUMN `deletedAt`;