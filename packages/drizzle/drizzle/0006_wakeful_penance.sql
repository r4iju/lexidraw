CREATE TABLE `EntityTags` (
	`entityId` text NOT NULL,
	`tagId` text NOT NULL,
	`userId` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`entityId`) REFERENCES `Entities`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`tagId`) REFERENCES `Tags`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `EntityTag_entityId_tagId_userId_key` ON `EntityTags` (`entityId`,`tagId`,`userId`);--> statement-breakpoint
CREATE TABLE `Tags` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Tags_name_unique` ON `Tags` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `Tag_name_unique` ON `Tags` (`name`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_UserRoles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` text NOT NULL,
	`roleId` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`roleId`) REFERENCES `Roles`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_UserRoles`("id", "userId", "roleId", "createdAt", "updatedAt", "deletedAt") SELECT "id", "userId", "roleId", "createdAt", "updatedAt", "deletedAt" FROM `UserRoles`;--> statement-breakpoint
DROP TABLE `UserRoles`;--> statement-breakpoint
ALTER TABLE `__new_UserRoles` RENAME TO `UserRoles`;--> statement-breakpoint
PRAGMA foreign_keys=ON;