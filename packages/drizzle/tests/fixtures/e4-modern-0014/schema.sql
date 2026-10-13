-- Modeled relational 0014 checkpoint, not replay of migrations 0..14.
CREATE TABLE `Accounts` (
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
  `createdAt` integer NOT NULL DEFAULT 1735950685000,
  `updatedAt` integer NOT NULL DEFAULT 1735950685000,
  `deletedAt` integer,
  FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Account_provider_providerAccountId_key` ON `Accounts` (`provider`, `providerAccountId`);
--> statement-breakpoint
CREATE TABLE `AdminAuditEvents` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `createdAt` integer NOT NULL,
  `adminUserId` text NOT NULL,
  `action` text NOT NULL,
  `targetType` text NOT NULL,
  `targetId` text NOT NULL,
  `data` text,
  FOREIGN KEY (`adminUserId`) REFERENCES `Users` (`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `AdminAuditEvents_createdAt_idx` ON `AdminAuditEvents` (`createdAt`);
--> statement-breakpoint
CREATE INDEX `AdminAuditEvents_target_idx` ON `AdminAuditEvents` (`targetType`, `targetId`);
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
CREATE INDEX `Analytics_visitorId_idx` ON `Analytics` (`visitorId`);
--> statement-breakpoint
CREATE TABLE `CityCoordinates` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `city` text NOT NULL,
  `latitude` real NOT NULL,
  `longitude` real NOT NULL,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `CityCoordinates_city_key` ON `CityCoordinates` (`city`);
--> statement-breakpoint
CREATE INDEX `CityCoordinates_city_idx` ON `CityCoordinates` (`city`);
--> statement-breakpoint
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
CREATE TABLE `LLMAuditEvents` (
  `id` text PRIMARY KEY NOT NULL,
  `createdAt` integer NOT NULL,
  `requestId` text NOT NULL,
  `userId` text NOT NULL,
  `entityId` text,
  `mode` text NOT NULL,
  `route` text NOT NULL,
  `provider` text NOT NULL,
  `modelId` text NOT NULL,
  `temperature` real NOT NULL,
  `maxOutputTokens` integer NOT NULL,
  `promptTokens` integer,
  `completionTokens` integer,
  `totalTokens` integer,
  `latencyMs` integer NOT NULL,
  `stream` integer NOT NULL,
  `toolCalls` text,
  `promptLen` integer,
  `messagesCount` integer,
  `errorCode` text,
  `errorMessage` text,
  `httpStatus` integer,
  FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`entityId`) REFERENCES `Entities` (`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `LLMAudit_user_createdAt_idx` ON `LLMAuditEvents` (`userId`, `createdAt`);
--> statement-breakpoint
CREATE INDEX `LLMAudit_entity_createdAt_idx` ON `LLMAuditEvents` (`entityId`, `createdAt`);
--> statement-breakpoint
CREATE INDEX `LLMAudit_mode_createdAt_idx` ON `LLMAuditEvents` (`mode`, `createdAt`);
--> statement-breakpoint
CREATE INDEX `LLMAudit_route_createdAt_idx` ON `LLMAuditEvents` (`route`, `createdAt`);
--> statement-breakpoint
CREATE TABLE `LLMPolicies` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `mode` text NOT NULL,
  `provider` text NOT NULL,
  `modelId` text NOT NULL,
  `temperature` real NOT NULL,
  `maxOutputTokens` integer NOT NULL,
  `allowedModels` text NOT NULL,
  `enforcedCaps` text NOT NULL,
  `extraConfig` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `LLMPolicies_mode_unique` ON `LLMPolicies` (`mode`);
--> statement-breakpoint
CREATE TABLE `Permissions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  `deletedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Permissions_name_unique` ON `Permissions` (`name`);
--> statement-breakpoint
CREATE TABLE `RolePermissions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `roleId` integer NOT NULL,
  `permissionId` integer NOT NULL,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  `deletedAt` integer,
  FOREIGN KEY (`roleId`) REFERENCES `Roles` (`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`permissionId`) REFERENCES `Permissions` (`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `Roles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `description` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  `deletedAt` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Roles_name_unique` ON `Roles` (`name`);
--> statement-breakpoint
CREATE TABLE `Sessions` (
  `id` text PRIMARY KEY NOT NULL,
  `sessionToken` text NOT NULL,
  `userId` text NOT NULL,
  `expires` numeric NOT NULL,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  `deletedAt` integer,
  FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Session_sessionToken_key` ON `Sessions` (`sessionToken`);
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
CREATE TABLE `ThumbnailJobs` (
  `id` text PRIMARY KEY NOT NULL,
  `entityId` text NOT NULL,
  `version` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `attempts` integer NOT NULL DEFAULT 0,
  `nextRunAt` integer,
  `lastError` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  FOREIGN KEY (`entityId`) REFERENCES `Entities` (`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ThumbnailJobs_entity_version_key` ON `ThumbnailJobs` (`entityId`, `version`);
--> statement-breakpoint
CREATE INDEX `ThumbnailJobs_status_nextRunAt_idx` ON `ThumbnailJobs` (`status`, `nextRunAt`);
--> statement-breakpoint
CREATE TABLE `UploadedImages` (
  `id` text PRIMARY KEY NOT NULL,
  `userId` text NOT NULL,
  `entityId` text NOT NULL,
  `fileName` text NOT NULL,
  `signedUploadUrl` text NOT NULL DEFAULT '',
  `signedDownloadUrl` text NOT NULL,
  `kind` text NOT NULL DEFAULT 'attachment',
  `status` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  `deletedAt` integer,
  FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`entityId`) REFERENCES `Entities` (`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `UploadedImage_userId_idx` ON `UploadedImages` (`userId`);
--> statement-breakpoint
CREATE TABLE `UploadedVideos` (
  `id` text PRIMARY KEY NOT NULL,
  `userId` text NOT NULL,
  `entityId` text NOT NULL,
  `fileName` text NOT NULL,
  `requestId` text,
  `signedUploadUrl` text NOT NULL DEFAULT '',
  `signedDownloadUrl` text NOT NULL,
  `status` text,
  `errorMessage` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  `deletedAt` integer,
  FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`entityId`) REFERENCES `Entities` (`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UploadedVideos_requestId_unique` ON `UploadedVideos` (`requestId`);
--> statement-breakpoint
CREATE INDEX `UploadedVideo_userId_idx` ON `UploadedVideos` (`userId`);
--> statement-breakpoint
CREATE TABLE `UserEntityPrefs` (
  `userId` text NOT NULL,
  `entityId` text NOT NULL,
  `favoritedAt` integer,
  `archivedAt` integer,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`entityId`) REFERENCES `Entities` (`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `UserEntityPrefs_user_entity_unique` ON `UserEntityPrefs` (`userId`, `entityId`);
--> statement-breakpoint
CREATE INDEX `UserEntityPrefs_userId_idx` ON `UserEntityPrefs` (`userId`);
--> statement-breakpoint
CREATE INDEX `UserEntityPrefs_entityId_idx` ON `UserEntityPrefs` (`entityId`);
--> statement-breakpoint
CREATE TABLE `UserRoles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `userId` text NOT NULL,
  `roleId` integer NOT NULL,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  `deletedAt` integer,
  FOREIGN KEY (`userId`) REFERENCES `Users` (`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`roleId`) REFERENCES `Roles` (`id`) ON UPDATE no action ON DELETE no action
);
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
--> statement-breakpoint
CREATE TABLE `VerificationTokens` (
  `identifier` text NOT NULL,
  `token` text NOT NULL,
  `expires` numeric NOT NULL,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `VerificationToken_identifier_token_key` ON `VerificationTokens` (`identifier`, `token`);
--> statement-breakpoint
CREATE UNIQUE INDEX `VerificationToken_token_key` ON `VerificationTokens` (`token`);
--> statement-breakpoint
CREATE TABLE `WebRTCAnswers` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `answer` text NOT NULL,
  `entityId` text NOT NULL,
  `createdBy` text NOT NULL,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  FOREIGN KEY (`entityId`) REFERENCES `Entities` (`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `WebRTCAnswer_createdBy_idx` ON `WebRTCAnswers` (`createdBy`);
--> statement-breakpoint
CREATE INDEX `WebRTCAnswer_entityId_idx` ON `WebRTCAnswers` (`entityId`);
--> statement-breakpoint
CREATE TABLE `WebRTCOffers` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `offer` text NOT NULL,
  `entityId` text NOT NULL,
  `createdBy` text NOT NULL,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  FOREIGN KEY (`entityId`) REFERENCES `Entities` (`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `WebRTCOffer_createdBy_idx` ON `WebRTCOffers` (`createdBy`);
--> statement-breakpoint
CREATE INDEX `WebRTCOffer_entityId_idx` ON `WebRTCOffers` (`entityId`);
