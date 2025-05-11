ALTER TABLE `UploadedImages` RENAME COLUMN "fileUrl" TO "signedDownloadUrl";--> statement-breakpoint
ALTER TABLE `UploadedVideos` RENAME COLUMN "fileUrl" TO "signedDownloadUrl";--> statement-breakpoint
ALTER TABLE `UploadedImages` ADD `signedUploadUrl` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `UploadedVideos` ADD `requestId` text;--> statement-breakpoint
ALTER TABLE `UploadedVideos` ADD `signedUploadUrl` text NOT NULL DEFAULT '';--> statement-breakpoint
CREATE UNIQUE INDEX `UploadedVideos_requestId_unique` ON `UploadedVideos` (`requestId`);