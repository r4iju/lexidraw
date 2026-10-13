CREATE TABLE `Entities` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
  `elements` text NOT NULL,
  `appState` text,
  `entityType` text NOT NULL DEFAULT 'drawing',
  `parentId` text,
  `screenShotLight` text NOT NULL DEFAULT '',
  `screenShotDark` text NOT NULL DEFAULT '',
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  `deletedAt` integer,
  `userId` text NOT NULL,
  `publicAccess` text NOT NULL,
  `isActive` integer NOT NULL DEFAULT 1,
  `thumbnailStatus` text DEFAULT 'pending',
  `thumbnailUpdatedAt` integer,
  `thumbnailVersion` text,
  FOREIGN KEY (`parentId`) REFERENCES `Entities` (`id`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `Entity_userId_idx` ON `Entities` (`userId`);
--> statement-breakpoint
CREATE INDEX `Entity_parentId_idx` ON `Entities` (`parentId`);
--> statement-breakpoint
CREATE INDEX `Entity_title_idx` ON `Entities` (`title`);
--> statement-breakpoint
CREATE INDEX `Entity_createdAt_idx` ON `Entities` (`createdAt`);
--> statement-breakpoint
CREATE UNIQUE INDEX `Entity_unique_directory_name` ON `Entities` (`title`, `parentId`) WHERE entityType = 'directory';
--> statement-breakpoint
CREATE TABLE `EntityTags` (
  `entityId` text NOT NULL,
  `tagId` text NOT NULL,
  `userId` text NOT NULL,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  FOREIGN KEY (`entityId`) REFERENCES `Entities` (`id`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`tagId`) REFERENCES `Tags` (`id`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `EntityTag_entityId_tagId_userId_key` ON `EntityTags` (`entityId`, `tagId`, `userId`);
--> statement-breakpoint
CREATE TABLE `SharedEntities` (
  `id` text PRIMARY KEY NOT NULL,
  `entityId` text NOT NULL,
  `userId` text NOT NULL,
  `accessLevel` text NOT NULL,
  `createdAt` integer NOT NULL DEFAULT 1735950685000,
  `updatedAt` integer NOT NULL DEFAULT 1735950685000,
  FOREIGN KEY (`entityId`) REFERENCES `Entities` (`id`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `SharedEntity_entityId_userId_key` ON `SharedEntities` (`entityId`, `userId`);
--> statement-breakpoint
CREATE INDEX `SharedEntity_userId_idx` ON `SharedEntities` (`userId`);
--> statement-breakpoint
CREATE INDEX `SharedEntity_entityId_idx` ON `SharedEntities` (`entityId`);
--> statement-breakpoint
CREATE TABLE `Tags` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Tags_name_unique` ON `Tags` (`name`);
--> statement-breakpoint
CREATE UNIQUE INDEX `Tag_name_unique` ON `Tags` (`name`);
--> statement-breakpoint
CREATE TABLE `Users` (
  `id` text PRIMARY KEY NOT NULL,
  `name` text NOT NULL,
  `config` text,
  `email` text,
  `password` text,
  `emailVerified` numeric,
  `image` text,
  `isActive` integer NOT NULL DEFAULT 1,
  `createdAt` integer NOT NULL DEFAULT 1735950685000,
  `updatedAt` integer NOT NULL DEFAULT 1735950685000,
  `deletedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `User_email_key` ON `Users` (`email`);
--> statement-breakpoint
CREATE INDEX `User_name_idx` ON `Users` (`name`);
