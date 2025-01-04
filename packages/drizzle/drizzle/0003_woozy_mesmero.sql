CREATE TABLE `permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `permissions_name_unique` ON `permissions` (`name`);--> statement-breakpoint
CREATE TABLE `Role` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Role_name_unique` ON `Role` (`name`);--> statement-breakpoint
CREATE TABLE `role_permissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`roleId` integer NOT NULL,
	`permissionId` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`permissionId`) REFERENCES `permissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `UploadedImage` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`entityId` text NOT NULL,
	`fileName` text NOT NULL,
	`fileUrl` text NOT NULL,
	`kind` text DEFAULT 'attachment' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`entityId`) REFERENCES `Entity`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `UploadedImage_userId_idx` ON `UploadedImage` (`userId`);--> statement-breakpoint
CREATE TABLE `user_roles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
	`roleId` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`roleId`) REFERENCES `Role`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
DROP TABLE `_prisma_migrations`;--> statement-breakpoint
ALTER TABLE `Account` ADD `createdAt` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `Account` ADD `updatedAt` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `Account` ADD `deletedAt` integer;--> statement-breakpoint
ALTER TABLE `CityCoordinates` ADD `createdAt` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `CityCoordinates` ADD `updatedAt` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `Entity` ADD `screenShotLight` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `Entity` ADD `screenShotDark` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `Session` ADD `createdAt` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `Session` ADD `updatedAt` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `Session` ADD `deletedAt` integer;--> statement-breakpoint
ALTER TABLE `SharedEntity` ADD `updatedAt` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `User` ADD `createdAt` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `User` ADD `updatedAt` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `User` ADD `deletedAt` integer;--> statement-breakpoint
ALTER TABLE `VerificationToken` ADD `createdAt` integer NOT NULL;--> statement-breakpoint
ALTER TABLE `VerificationToken` ADD `updatedAt` integer NOT NULL;