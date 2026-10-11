CREATE TABLE IF NOT EXISTS `TtsJobs` (
  `id` text PRIMARY KEY NOT NULL,
  `entityId` text NOT NULL,
  `userId` text NOT NULL,
  `status` text NOT NULL,
  `manifestUrl` text,
  `stitchedUrl` text,
  `segmentCount` integer,
  `error` text,
  `ttsConfig` text,
  `createdAt` integer NOT NULL,
  `updatedAt` integer NOT NULL,
  `plannedCount` integer,
  `runId` text,
  FOREIGN KEY (`entityId`) REFERENCES `Entities`(`id`) ON UPDATE cascade ON DELETE cascade,
  FOREIGN KEY (`userId`) REFERENCES `Users`(`id`) ON UPDATE cascade ON DELETE cascade
);

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `TtsJobs_entityId_idx` ON `TtsJobs` (`entityId`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `TtsJobs_status_idx` ON `TtsJobs` (`status`);
