DROP INDEX "Account_provider_providerAccountId_key";--> statement-breakpoint
DROP INDEX "Analytics_visitorId_idx";--> statement-breakpoint
DROP INDEX "CityCoordinates_city_key";--> statement-breakpoint
DROP INDEX "CityCoordinates_city_idx";--> statement-breakpoint
DROP INDEX "Entity_userId_idx";--> statement-breakpoint
DROP INDEX "Entity_parentId_idx";--> statement-breakpoint
DROP INDEX "Entity_unique_directory_name";--> statement-breakpoint
DROP INDEX "EntityTag_entityId_tagId_userId_key";--> statement-breakpoint
DROP INDEX "Permissions_name_unique";--> statement-breakpoint
DROP INDEX "Roles_name_unique";--> statement-breakpoint
DROP INDEX "Session_sessionToken_key";--> statement-breakpoint
DROP INDEX "SharedEntity_entityId_userId_key";--> statement-breakpoint
DROP INDEX "SharedEntity_userId_idx";--> statement-breakpoint
DROP INDEX "SharedEntity_entityId_idx";--> statement-breakpoint
DROP INDEX "Tags_name_unique";--> statement-breakpoint
DROP INDEX "Tag_name_unique";--> statement-breakpoint
DROP INDEX "UploadedImage_userId_idx";--> statement-breakpoint
DROP INDEX "UploadedVideos_requestId_unique";--> statement-breakpoint
DROP INDEX "UploadedVideo_userId_idx";--> statement-breakpoint
DROP INDEX "User_email_key";--> statement-breakpoint
DROP INDEX "VerificationToken_identifier_token_key";--> statement-breakpoint
DROP INDEX "VerificationToken_token_key";--> statement-breakpoint
DROP INDEX "WebRTCAnswer_createdBy_idx";--> statement-breakpoint
DROP INDEX "WebRTCAnswer_entityId_idx";--> statement-breakpoint
DROP INDEX "WebRTCOffer_createdBy_idx";--> statement-breakpoint
DROP INDEX "WebRTCOffer_entityId_idx";--> statement-breakpoint
ALTER TABLE `UploadedImages` ALTER COLUMN "signedUploadUrl" TO "signedUploadUrl" text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE UNIQUE INDEX `Account_provider_providerAccountId_key` ON `Accounts` (`provider`,`providerAccountId`);--> statement-breakpoint
CREATE INDEX `Analytics_visitorId_idx` ON `Analytics` (`visitorId`);--> statement-breakpoint
CREATE UNIQUE INDEX `CityCoordinates_city_key` ON `CityCoordinates` (`city`);--> statement-breakpoint
CREATE INDEX `CityCoordinates_city_idx` ON `CityCoordinates` (`city`);--> statement-breakpoint
CREATE INDEX `Entity_userId_idx` ON `Entities` (`userId`);--> statement-breakpoint
CREATE INDEX `Entity_parentId_idx` ON `Entities` (`parentId`);--> statement-breakpoint
CREATE UNIQUE INDEX `Entity_unique_directory_name` ON `Entities` (`title`,`parentId`) WHERE entityType = 'directory';--> statement-breakpoint
CREATE UNIQUE INDEX `EntityTag_entityId_tagId_userId_key` ON `EntityTags` (`entityId`,`tagId`,`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `Permissions_name_unique` ON `Permissions` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `Roles_name_unique` ON `Roles` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `Session_sessionToken_key` ON `Sessions` (`sessionToken`);--> statement-breakpoint
CREATE UNIQUE INDEX `SharedEntity_entityId_userId_key` ON `SharedEntities` (`entityId`,`userId`);--> statement-breakpoint
CREATE INDEX `SharedEntity_userId_idx` ON `SharedEntities` (`userId`);--> statement-breakpoint
CREATE INDEX `SharedEntity_entityId_idx` ON `SharedEntities` (`entityId`);--> statement-breakpoint
CREATE UNIQUE INDEX `Tags_name_unique` ON `Tags` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `Tag_name_unique` ON `Tags` (`name`);--> statement-breakpoint
CREATE INDEX `UploadedImage_userId_idx` ON `UploadedImages` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `UploadedVideos_requestId_unique` ON `UploadedVideos` (`requestId`);--> statement-breakpoint
CREATE INDEX `UploadedVideo_userId_idx` ON `UploadedVideos` (`userId`);--> statement-breakpoint
CREATE UNIQUE INDEX `User_email_key` ON `Users` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `VerificationToken_identifier_token_key` ON `VerificationTokens` (`identifier`,`token`);--> statement-breakpoint
CREATE UNIQUE INDEX `VerificationToken_token_key` ON `VerificationTokens` (`token`);--> statement-breakpoint
CREATE INDEX `WebRTCAnswer_createdBy_idx` ON `WebRTCAnswers` (`createdBy`);--> statement-breakpoint
CREATE INDEX `WebRTCAnswer_entityId_idx` ON `WebRTCAnswers` (`entityId`);--> statement-breakpoint
CREATE INDEX `WebRTCOffer_createdBy_idx` ON `WebRTCOffers` (`createdBy`);--> statement-breakpoint
CREATE INDEX `WebRTCOffer_entityId_idx` ON `WebRTCOffers` (`entityId`);--> statement-breakpoint
ALTER TABLE `UploadedVideos` ALTER COLUMN "signedUploadUrl" TO "signedUploadUrl" text NOT NULL DEFAULT '';