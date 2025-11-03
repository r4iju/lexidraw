CREATE TABLE IF NOT EXISTS `TtsJobs` (
  `id` text PRIMARY KEY NOT NULL,
  `documentId` text NOT NULL,
  `userId` text NOT NULL,
  `status` text NOT NULL,
  `manifestUrl` text,
  `stitchedUrl` text,
  `segmentCount` integer,
  `error` text,
  `ttsConfig` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  FOREIGN KEY (`documentId`) REFERENCES `Entities`(`id`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE cascade ON DELETE cascade
);

CREATE INDEX IF NOT EXISTS `TtsJobs_documentId_idx` ON `TtsJobs` (`documentId`);
CREATE INDEX IF NOT EXISTS `TtsJobs_status_idx` ON `TtsJobs` (`status`);
