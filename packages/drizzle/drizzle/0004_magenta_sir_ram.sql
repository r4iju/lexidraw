ALTER TABLE `Account` RENAME TO `Accounts`;--> statement-breakpoint
ALTER TABLE `Entity` RENAME TO `Entities`;--> statement-breakpoint
ALTER TABLE `permissions` RENAME TO `Permissions`;--> statement-breakpoint
ALTER TABLE `Role` RENAME TO `Roles`;--> statement-breakpoint
ALTER TABLE `role_permissions` RENAME TO `RolePermissions`;--> statement-breakpoint
ALTER TABLE `Session` RENAME TO `Sessions`;--> statement-breakpoint
ALTER TABLE `SharedEntity` RENAME TO `SharedEntities`;--> statement-breakpoint
ALTER TABLE `UploadedImage` RENAME TO `UploadedImages`;--> statement-breakpoint
ALTER TABLE `User` RENAME TO `Users`;--> statement-breakpoint
ALTER TABLE `user_roles` RENAME TO `UserRoles`;--> statement-breakpoint
ALTER TABLE `VerificationToken` RENAME TO `VerificationTokens`;--> statement-breakpoint
ALTER TABLE `WebRTCAnswer` RENAME TO `WebRTCAnswers`;--> statement-breakpoint
ALTER TABLE `WebRTCOffer` RENAME TO `WebRTCOffers`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_Accounts` (
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
	`createdAt` integer DEFAULT 1735950685000 NOT NULL,
	`updatedAt` integer DEFAULT 1735950685000 NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_Accounts`("id", "userId", "type", "provider", "providerAccountId", "refresh_token", "access_token", "expires_at", "token_type", "scope", "id_token", "session_state", "refresh_token_expires_in", "createdAt", "updatedAt", "deletedAt") SELECT "id", "userId", "type", "provider", "providerAccountId", "refresh_token", "access_token", "expires_at", "token_type", "scope", "id_token", "session_state", "refresh_token_expires_in", "createdAt", "updatedAt", "deletedAt" FROM `Accounts`;--> statement-breakpoint
DROP TABLE `Accounts`;--> statement-breakpoint
ALTER TABLE `__new_Accounts` RENAME TO `Accounts`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `Account_provider_providerAccountId_key` ON `Accounts` (`provider`,`providerAccountId`);--> statement-breakpoint
CREATE TABLE `__new_Entities` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`elements` text NOT NULL,
	`appState` text,
	`entityType` text DEFAULT 'drawing' NOT NULL,
	`screenShotLight` text DEFAULT '' NOT NULL,
	`screenShotDark` text DEFAULT '' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	`userId` text NOT NULL,
	`publicAccess` text NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_Entities`("id", "title", "elements", "appState", "entityType", "screenShotLight", "screenShotDark", "createdAt", "updatedAt", "deletedAt", "userId", "publicAccess") SELECT "id", "title", "elements", "appState", "entityType", "screenShotLight", "screenShotDark", "createdAt", "updatedAt", "deletedAt", "userId", "publicAccess" FROM `Entities`;--> statement-breakpoint
DROP TABLE `Entities`;--> statement-breakpoint
ALTER TABLE `__new_Entities` RENAME TO `Entities`;--> statement-breakpoint
CREATE INDEX `Entity_userId_idx` ON `Entities` (`userId`);--> statement-breakpoint
DROP INDEX `permissions_name_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `Permissions_name_unique` ON `Permissions` (`name`);--> statement-breakpoint
DROP INDEX `Role_name_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX `Roles_name_unique` ON `Roles` (`name`);--> statement-breakpoint
CREATE TABLE `__new_RolePermissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`roleId` integer NOT NULL,
	`permissionId` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`roleId`) REFERENCES `Roles`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`permissionId`) REFERENCES `Permissions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_RolePermissions`("id", "roleId", "permissionId", "createdAt", "updatedAt", "deletedAt") SELECT "id", "roleId", "permissionId", "createdAt", "updatedAt", "deletedAt" FROM `RolePermissions`;--> statement-breakpoint
DROP TABLE `RolePermissions`;--> statement-breakpoint
ALTER TABLE `__new_RolePermissions` RENAME TO `RolePermissions`;--> statement-breakpoint
CREATE TABLE `__new_Sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`sessionToken` text NOT NULL,
	`userId` text NOT NULL,
	`expires` numeric NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_Sessions`("id", "sessionToken", "userId", "expires", "createdAt", "updatedAt", "deletedAt") SELECT "id", "sessionToken", "userId", "expires", "createdAt", "updatedAt", "deletedAt" FROM `Sessions`;--> statement-breakpoint
DROP TABLE `Sessions`;--> statement-breakpoint
ALTER TABLE `__new_Sessions` RENAME TO `Sessions`;--> statement-breakpoint
CREATE UNIQUE INDEX `Session_sessionToken_key` ON `Sessions` (`sessionToken`);--> statement-breakpoint
CREATE TABLE `__new_SharedEntities` (
	`id` text PRIMARY KEY NOT NULL,
	`entityId` text NOT NULL,
	`userId` text NOT NULL,
	`accessLevel` text NOT NULL,
	`createdAt` integer DEFAULT 1735950685000 NOT NULL,
	`updatedAt` integer DEFAULT 1735950685000 NOT NULL,
	FOREIGN KEY (`entityId`) REFERENCES `Entities`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_SharedEntities`("id", "entityId", "userId", "accessLevel", "createdAt", "updatedAt") SELECT "id", "entityId", "userId", "accessLevel", "createdAt", "updatedAt" FROM `SharedEntities`;--> statement-breakpoint
DROP TABLE `SharedEntities`;--> statement-breakpoint
ALTER TABLE `__new_SharedEntities` RENAME TO `SharedEntities`;--> statement-breakpoint
CREATE UNIQUE INDEX `SharedEntity_entityId_userId_key` ON `SharedEntities` (`entityId`,`userId`);--> statement-breakpoint
CREATE INDEX `SharedEntity_userId_idx` ON `SharedEntities` (`userId`);--> statement-breakpoint
CREATE INDEX `SharedEntity_entityId_idx` ON `SharedEntities` (`entityId`);--> statement-breakpoint
CREATE TABLE `__new_UploadedImages` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`entityId` text NOT NULL,
	`fileName` text NOT NULL,
	`fileUrl` text NOT NULL,
	`kind` text DEFAULT 'attachment' NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`deletedAt` integer,
	FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`entityId`) REFERENCES `Entities`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_UploadedImages`("id", "userId", "entityId", "fileName", "fileUrl", "kind", "createdAt", "updatedAt", "deletedAt") SELECT "id", "userId", "entityId", "fileName", "fileUrl", "kind", "createdAt", "updatedAt", "deletedAt" FROM `UploadedImages`;--> statement-breakpoint
DROP TABLE `UploadedImages`;--> statement-breakpoint
ALTER TABLE `__new_UploadedImages` RENAME TO `UploadedImages`;--> statement-breakpoint
CREATE INDEX `UploadedImage_userId_idx` ON `UploadedImages` (`userId`);--> statement-breakpoint
DROP INDEX "Account_provider_providerAccountId_key";--> statement-breakpoint
DROP INDEX "Analytics_visitorId_idx";--> statement-breakpoint
DROP INDEX "CityCoordinates_city_key";--> statement-breakpoint
DROP INDEX "CityCoordinates_city_idx";--> statement-breakpoint
DROP INDEX "Entity_userId_idx";--> statement-breakpoint
DROP INDEX "Permissions_name_unique";--> statement-breakpoint
DROP INDEX "Roles_name_unique";--> statement-breakpoint
DROP INDEX "Session_sessionToken_key";--> statement-breakpoint
DROP INDEX "SharedEntity_entityId_userId_key";--> statement-breakpoint
DROP INDEX "SharedEntity_userId_idx";--> statement-breakpoint
DROP INDEX "SharedEntity_entityId_idx";--> statement-breakpoint
DROP INDEX "UploadedImage_userId_idx";--> statement-breakpoint
DROP INDEX "User_email_key";--> statement-breakpoint
DROP INDEX "VerificationToken_identifier_token_key";--> statement-breakpoint
DROP INDEX "VerificationToken_token_key";--> statement-breakpoint
DROP INDEX "WebRTCAnswer_createdBy_idx";--> statement-breakpoint
DROP INDEX "WebRTCAnswer_entityId_idx";--> statement-breakpoint
DROP INDEX "WebRTCOffer_createdBy_idx";--> statement-breakpoint
DROP INDEX "WebRTCOffer_entityId_idx";--> statement-breakpoint
ALTER TABLE `Users` ALTER COLUMN "createdAt" TO "createdAt" integer NOT NULL DEFAULT 1735950685000;--> statement-breakpoint
CREATE INDEX `Analytics_visitorId_idx` ON `Analytics` (`visitorId`);--> statement-breakpoint
CREATE UNIQUE INDEX `CityCoordinates_city_key` ON `CityCoordinates` (`city`);--> statement-breakpoint
CREATE INDEX `CityCoordinates_city_idx` ON `CityCoordinates` (`city`);--> statement-breakpoint
CREATE UNIQUE INDEX `User_email_key` ON `Users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `VerificationToken_identifier_token_key` ON `VerificationTokens` (`identifier`,`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `VerificationToken_token_key` ON `VerificationTokens` (`token`);--> statement-breakpoint
CREATE INDEX `WebRTCAnswer_createdBy_idx` ON `WebRTCAnswers` (`createdBy`);--> statement-breakpoint
CREATE INDEX `WebRTCAnswer_entityId_idx` ON `WebRTCAnswers` (`entityId`);--> statement-breakpoint
CREATE INDEX `WebRTCOffer_createdBy_idx` ON `WebRTCOffers` (`createdBy`);--> statement-breakpoint
CREATE INDEX `WebRTCOffer_entityId_idx` ON `WebRTCOffers` (`entityId`);--> statement-breakpoint
ALTER TABLE `Users` ALTER COLUMN "updatedAt" TO "updatedAt" integer NOT NULL DEFAULT 1735950685000;--> statement-breakpoint
CREATE TABLE `__new_UserRoles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`userId` integer NOT NULL,
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
CREATE TABLE `__new_WebRTCAnswers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`answer` text NOT NULL,
	`entityId` text NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`entityId`) REFERENCES `Entities`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_WebRTCAnswers`("id", "answer", "entityId", "createdBy", "createdAt", "updatedAt") SELECT "id", "answer", "entityId", "createdBy", "createdAt", "updatedAt" FROM `WebRTCAnswers`;--> statement-breakpoint
DROP TABLE `WebRTCAnswers`;--> statement-breakpoint
ALTER TABLE `__new_WebRTCAnswers` RENAME TO `WebRTCAnswers`;--> statement-breakpoint
CREATE TABLE `__new_WebRTCOffers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`offer` text NOT NULL,
	`entityId` text NOT NULL,
	`createdBy` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`entityId`) REFERENCES `Entities`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_WebRTCOffers`("id", "offer", "entityId", "createdBy", "createdAt", "updatedAt") SELECT "id", "offer", "entityId", "createdBy", "createdAt", "updatedAt" FROM `WebRTCOffers`;--> statement-breakpoint
DROP TABLE `WebRTCOffers`;--> statement-breakpoint
ALTER TABLE `__new_WebRTCOffers` RENAME TO `WebRTCOffers`;