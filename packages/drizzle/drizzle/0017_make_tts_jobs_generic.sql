-- Rename documentId to entityId to support both documents and articles
ALTER TABLE `TtsJobs` RENAME COLUMN `documentId` TO `entityId`;

-- Rename index to match new column name
DROP INDEX IF EXISTS `TtsJobs_documentId_idx`;
CREATE INDEX `TtsJobs_entityId_idx` ON `TtsJobs` (`entityId`);
