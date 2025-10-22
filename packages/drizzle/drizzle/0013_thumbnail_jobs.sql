PRAGMA foreign_keys=OFF;
-- Create ThumbnailJobs table
CREATE TABLE IF NOT EXISTS `ThumbnailJobs` (
  `id` text PRIMARY KEY NOT NULL,
  `entityId` text NOT NULL,
  `version` text NOT NULL,
  `status` text NOT NULL DEFAULT 'pending',
  `attempts` integer NOT NULL DEFAULT 0,
  `nextRunAt` integer,
  `lastError` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  FOREIGN KEY (`entityId`) REFERENCES `Entities`(`id`) ON UPDATE cascade ON DELETE cascade
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS `ThumbnailJobs_entity_version_key` ON `ThumbnailJobs` (`entityId`,`version`);
CREATE INDEX IF NOT EXISTS `ThumbnailJobs_status_nextRunAt_idx` ON `ThumbnailJobs` (`status`,`nextRunAt`);

-- Alter Entities to add thumbnail tracking columns
ALTER TABLE `Entities` ADD COLUMN `thumbnailStatus` text DEFAULT 'pending';
ALTER TABLE `Entities` ADD COLUMN `thumbnailUpdatedAt` integer;
ALTER TABLE `Entities` ADD COLUMN `thumbnailVersion` text;

PRAGMA foreign_keys=ON;

